import { describe, expect, it } from 'vitest';
import {
  HEMICLAVICULAR_RATIO,
  coarseStepFor,
  findLandmarks,
} from '@/src/catstudio/director/landmarks';
import {
  cutPosition,
  defaultRecipe,
  describeRecipe,
  referencePosition,
  sanitizeRecipe,
  type Recipe,
} from '@/src/catstudio/director/recipe';
import {
  frameOf,
  lineOnLocator,
  locatorRecipe,
  positionFromPixel,
  renderCut,
  slabOffsets,
  toGray,
} from '@/src/catstudio/director/cut';
import {
  OUTSIDE,
  bounds,
  sample,
  sampleNearest,
  volumeFromImage,
} from '@/src/catstudio/director/volume';
import {
  APEX_Z,
  BASE_Z,
  HERNIA,
  LUNG_EDGE,
  axialPhantom,
  density,
  pixelOf,
  rotatedPhantom,
} from './phantom';

const recipe = (extra: Partial<Recipe>): Recipe => ({
  ...defaultRecipe(),
  ...extra,
});

describe('diretor: volume no espaço do paciente', () => {
  const vol = axialPhantom(4);

  it('devolve o voxel no centro dele e interpola entre vizinhos', () => {
    expect(sample(vol, 75, 0, 280)).toBe(-850); // dentro do pulmão esquerdo
    expect(sample(vol, 0, 0, 280)).toBe(40); // mediastino
    // a grade tem voxels em x = 18 (tecido) e x = 22 (pulmão): no meio, a média
    expect(density([18, 2, 280])).toBe(40);
    expect(density([22, 2, 280])).toBe(-850);
    expect(sample(vol, 20, 2, 280)).toBeCloseTo(-405);
  });

  it('fora do volume é ar', () => {
    expect(sample(vol, 1000, 0, 0)).toBe(OUTSIDE);
    expect(sampleNearest(vol, 0, 0, -500)).toBe(OUTSIDE);
  });

  it('a orientação da grade não muda o que há em cada ponto do paciente', () => {
    const rotated = rotatedPhantom(4);
    const points: Array<[number, number, number]> = [
      [75, 0, 280],
      [-75, 0, 280],
      HERNIA,
      [0, -20, 100],
      [0, 0, 200],
      [160, 0, 100],
    ];
    points.forEach(([x, y, z]) =>
      expect(sample(rotated, x, y, z)).toBe(sample(vol, x, y, z))
    );
    expect(bounds(rotated)).toEqual(bounds(vol));
  });

  it('monta a geometria a partir de indexToWorld', () => {
    const image = {
      indexToWorld: ([i, j, k]: number[]) => [
        10 + 2 * i,
        20 + 2 * j,
        30 - 3 * k,
      ],
    };
    const data = new Int16Array(8).map((_, o) => o);
    const built = volumeFromImage(image, data, [2, 2, 2]);
    expect(sample(built, 12, 20, 30)).toBe(1); // voxel (1, 0, 0)
    expect(sample(built, 10, 20, 27)).toBe(4); // voxel (0, 0, 1), k para baixo
    expect(built.minSpacing).toBe(2);
  });
});

describe('diretor: referências anatômicas', () => {
  const lm = findLandmarks(axialPhantom(4));

  it('acha os pulmões, a linha média e as bordas', () => {
    expect(lm.basis).toBe('pulmoes');
    expect(lm.notes).toEqual([]);
    expect(Math.abs(lm.midlineX)).toBeLessThan(4);
    expect(Math.abs(lm.halfWidthLeft - LUNG_EDGE)).toBeLessThan(10);
    expect(Math.abs(lm.halfWidthRight - LUNG_EDGE)).toBeLessThan(10);
    expect(Math.abs(lm.apexZ - APEX_Z)).toBeLessThan(10);
    expect(Math.abs(lm.baseZ - BASE_Z)).toBeLessThan(10);
  });

  it('não confunde gás intestinal com pulmão', () => {
    // a bolha de gás fica em z = 100; a base dos pulmões, em 180
    expect(lm.baseZ).toBeGreaterThan(160);
  });

  it('a caixa do corpo é a pele, não o volume inteiro', () => {
    expect(Math.abs(lm.body[1][0] - 170)).toBeLessThan(8);
    expect(Math.abs(lm.body[0][1] + 110)).toBeLessThan(8);
    expect(Math.abs(lm.body[0][2])).toBeLessThan(8);
  });

  it('dá o mesmo resultado numa aquisição com outra orientação', () => {
    const other = findLandmarks(rotatedPhantom(4));
    expect(other.basis).toBe('pulmoes');
    expect(Math.abs(other.midlineX - lm.midlineX)).toBeLessThan(5);
    expect(Math.abs(other.halfWidthLeft - lm.halfWidthLeft)).toBeLessThan(5);
    expect(Math.abs(other.apexZ - lm.apexZ)).toBeLessThan(5);
  });

  it('sem pulmões avisa e usa o contorno do corpo', () => {
    const abdomen = findLandmarks(axialPhantom(4, { noLungs: true }));
    expect(abdomen.basis).toBe('corpo');
    expect(abdomen.notes[0]).toMatch(/Não achei os pulmões/);
    expect(Math.abs(abdomen.midlineX)).toBeLessThan(4);
    expect(abdomen.halfWidthLeft).toBeGreaterThan(120);
  });

  it('a mesa do tomógrafo, larga e fora de centro, não desloca a linha média', () => {
    const onTable = findLandmarks(axialPhantom(4, { table: true }));
    expect(onTable.basis).toBe('pulmoes');
    expect(Math.abs(onTable.midlineX)).toBeLessThan(5);
    expect(Math.abs(onTable.halfWidthLeft - LUNG_EDGE)).toBeLessThan(10);
    // a linha axilar média fica no meio dos pulmões, não puxada para a mesa
    expect(Math.abs(onTable.midCoronalY)).toBeLessThan(8);
  });

  it('acha os pulmões de um lactente (0,2 litro) e deixa a mesa solta de fora', () => {
    const scale = 0.4;
    const infant = findLandmarks(axialPhantom(2, { scale, looseTable: true }));
    expect(infant.basis).toBe('pulmoes');
    expect(Math.abs(infant.midlineX)).toBeLessThan(3);
    expect(Math.abs(infant.halfWidthLeft - LUNG_EDGE * scale)).toBeLessThan(5);
    expect(Math.abs(infant.apexZ - APEX_Z * scale)).toBeLessThan(6);
    expect(Math.abs(infant.baseZ - BASE_Z * scale)).toBeLessThan(6);
    // as costas ficam em y = 44; a mesa, em y = 60 a 66, não entra no corpo
    expect(infant.body[1][1]).toBeLessThan(50);
    expect(infant.body[1][1]).toBeGreaterThan(38);
  });

  it('o passo da grade acompanha o tamanho do exame', () => {
    // exame de 380 × 260 mm: 260 / 110 ≈ 2,4 mm
    expect(coarseStepFor(axialPhantom(8))).toBeCloseTo(260 / 110, 1);
  });

  it('pulmão colapsado de um lado não desloca a linha média', () => {
    const collapsed = findLandmarks(axialPhantom(4, { smallRightLung: true }));
    expect(Math.abs(collapsed.midlineX)).toBeLessThan(6);
    expect(collapsed.notes.join(' ')).toMatch(/assimétricos/);
    expect(Math.abs(collapsed.halfWidthRight - LUNG_EDGE)).toBeLessThan(10);
  });
});

describe('diretor: receita', () => {
  const lm = findLandmarks(axialPhantom(4));

  it('a hemiclavicular fica a 65% do caminho até a borda do pulmão, do lado certo', () => {
    const left = referencePosition(
      recipe({ plano: 'sagital', referencia: 'hemiclavicular-esquerda' }),
      lm
    );
    const right = referencePosition(
      recipe({ plano: 'sagital', referencia: 'hemiclavicular-direita' }),
      lm
    );
    expect(left).toBeCloseTo(
      lm.midlineX + HEMICLAVICULAR_RATIO * lm.halfWidthLeft
    );
    expect(left).toBeGreaterThan(70); // x positivo = esquerda do paciente
    expect(right).toBeLessThan(-70);
  });

  it('o deslocamento soma no eixo do paciente e o corte não sai do corpo', () => {
    const base = recipe({ plano: 'sagital', referencia: 'linha-media' });
    expect(cutPosition({ ...base, deslocamento: 20 }, lm)).toBeCloseTo(
      lm.midlineX + 20
    );
    expect(cutPosition({ ...base, deslocamento: 5000 }, lm)).toBe(
      lm.body[1][0]
    );
  });

  it('receita vinda de fora é conferida campo a campo', () => {
    const cleaned = sanitizeRecipe({
      plano: 'sagital',
      referencia: 'apice-pulmonar', // não existe no sagital
      deslocamento: 'muito',
      projecao: 'mip',
      espessura: 9999,
      janela: 'arco-íris',
      fundo: 'red; background:url(x)',
      titulo: 'x'.repeat(500),
      extra: '<script>',
    });
    expect(cleaned).toEqual({
      ...defaultRecipe(),
      plano: 'sagital',
      referencia: 'centro',
      projecao: 'mip',
      espessura: 300,
      titulo: 'x'.repeat(120),
    });
    expect(sanitizeRecipe('lixo')).toEqual(defaultRecipe());
  });

  it('descreve o que entendeu, marcando o que é estimado', () => {
    const text = describeRecipe(
      recipe({
        plano: 'sagital',
        referencia: 'hemiclavicular-esquerda',
        deslocamento: -20,
        projecao: 'mip',
        espessura: 20,
        janela: 'pulmao',
      }),
      lm
    );
    expect(text).toMatch(
      /Corte sagital na linha hemiclavicular esquerda \(estimada, a \d+ mm da linha média\)/
    );
    expect(text).toContain('20 mm para a direita');
    expect(text).toContain('MIP de 20 mm');
    expect(text).toContain('janela de pulmão');
  });
});

describe('diretor: desenho do corte', () => {
  const vol = axialPhantom(2);
  const lm = findLandmarks(vol);
  /** valor da imagem no ponto do paciente (duas coordenadas do plano) */
  const at = (
    cut: ReturnType<typeof renderCut>,
    point: [number, number, number]
  ) => {
    const { col, row, index } = pixelOf(cut, point);
    return { col, row, value: cut.image.values[index] };
  };

  it('sagital pela hérnia: ela aparece, na frente (esquerda da imagem) e embaixo', () => {
    const cut = renderCut(
      vol,
      recipe({ plano: 'sagital', referencia: 'ponto', ponto: HERNIA[0] }),
      lm,
      400
    );
    expect(cut.frame.labels).toEqual({
      left: 'A',
      right: 'P',
      top: 'S',
      bottom: 'I',
    });
    const hernia = at(cut, HERNIA);
    expect(hernia.value).toBeGreaterThan(250);
    expect(hernia.col).toBeLessThan(cut.image.width / 2);
    expect(hernia.row).toBeGreaterThan(cut.image.height / 2);
    // o pulmão esquerdo aparece no mesmo corte, acima
    const lung = at(cut, [HERNIA[0], 0, 280]);
    expect(lung.value).toBeLessThan(-800);
    expect(lung.row).toBeLessThan(hernia.row);
  });

  it('a hemiclavicular esquerda estimada passa pelo pulmão esquerdo, não pelo direito', () => {
    const cut = renderCut(
      vol,
      recipe({ plano: 'sagital', referencia: 'hemiclavicular-esquerda' }),
      lm,
      300
    );
    expect(cut.frame.origin[0]).toBeGreaterThan(70);
    expect(at(cut, [cut.frame.origin[0], 0, 280]).value).toBeLessThan(-800);
  });

  it('coronal: a esquerda do paciente fica à direita da imagem', () => {
    const cut = renderCut(
      vol,
      recipe({ plano: 'coronal', referencia: 'ponto', ponto: HERNIA[1] }),
      lm,
      400
    );
    expect(cut.frame.labels.left).toBe('D');
    const hernia = at(cut, HERNIA);
    expect(hernia.value).toBeGreaterThan(250);
    expect(hernia.col).toBeGreaterThan(cut.image.width / 2);
  });

  it('axial: anterior no alto, esquerda do paciente à direita', () => {
    const cut = renderCut(
      vol,
      recipe({ plano: 'axial', referencia: 'ponto', ponto: HERNIA[2] }),
      lm,
      400
    );
    const hernia = at(cut, HERNIA);
    expect(hernia.value).toBeGreaterThan(250);
    expect(hernia.row).toBeLessThan(cut.image.height / 2);
    expect(hernia.col).toBeGreaterThan(cut.image.width / 2);
  });

  it('MIP alcança o que está fora do corte fino; MinIP apaga o que é denso', () => {
    // corte 20 mm ao lado do centro da hérnia (raio 12): fora dela
    const beside = {
      plano: 'sagital',
      referencia: 'ponto',
      ponto: HERNIA[0] + 20,
    } as const;
    const thin = renderCut(vol, recipe(beside), lm, 300);
    const mip = renderCut(
      vol,
      recipe({ ...beside, projecao: 'mip', espessura: 30 }),
      lm,
      300
    );
    const point: [number, number, number] = [
      HERNIA[0] + 20,
      HERNIA[1],
      HERNIA[2],
    ];
    expect(at(thin, point).value).toBeLessThan(100);
    expect(at(mip, point).value).toBeGreaterThan(250);

    const through = {
      plano: 'sagital',
      referencia: 'ponto',
      ponto: HERNIA[0],
    } as const;
    const minip = renderCut(
      vol,
      recipe({ ...through, projecao: 'minip', espessura: 40 }),
      lm,
      300
    );
    expect(at(minip, HERNIA).value).toBeLessThan(100);
    const mean = renderCut(
      vol,
      recipe({ ...through, projecao: 'media', espessura: 40 }),
      lm,
      300
    );
    const average = at(mean, HERNIA).value;
    expect(average).toBeGreaterThan(60);
    expect(average).toBeLessThan(280);
  });

  it('a fatia é centrada no corte e tem a espessura pedida', () => {
    const offsets = slabOffsets(
      recipe({ projecao: 'mip', espessura: 20 }),
      vol
    );
    expect(offsets[0]).toBeCloseTo(-10);
    expect(offsets.at(-1)).toBeCloseTo(10);
    expect(slabOffsets(recipe({ projecao: 'fina' }), vol)).toEqual([0]);
  });

  it('o campo "só o tórax" corta a imagem perto do ápice e da base', () => {
    const whole = frameOf(recipe({ plano: 'coronal' }), lm);
    const chest = frameOf(recipe({ plano: 'coronal', campo: 'torax' }), lm);
    expect(chest.height).toBeLessThan(whole.height - 80);
    expect(chest.origin[2]).toBeGreaterThan(lm.apexZ);
    expect(chest.origin[2] - chest.height).toBeLessThan(lm.baseZ);
  });

  it('não desenha além da resolução do exame', () => {
    const cut = renderCut(vol, recipe({ plano: 'axial' }), lm, 5000);
    expect(cut.image.pixel).toBe(vol.minSpacing);
  });

  it('a janela leva a densidade a tons de cinza', () => {
    const cut = renderCut(
      vol,
      recipe({
        plano: 'axial',
        referencia: 'ponto',
        ponto: 280,
        janela: 'pulmao',
      }),
      lm,
      200
    );
    const gray = toGray(cut.image, recipe({ janela: 'pulmao' }));
    const lung = at(cut, [75, 0, 280]);
    const tissue = at(cut, [0, 0, 280]);
    const value = (p: { col: number; row: number }) =>
      gray[4 * (p.col + cut.image.width * p.row)];
    expect(value(lung)).toBeGreaterThan(60); // −850 UH: cinza na janela de pulmão
    expect(value(lung)).toBeLessThan(120);
    expect(value(tissue)).toBeGreaterThan(225); // 40 UH: quase branco
  });

  it('localizador: a linha do corte cai onde o corte passa, e o clique devolve a posição', () => {
    const target = recipe({ plano: 'sagital', referencia: 'ponto', ponto: 60 });
    const locator = renderCut(vol, locatorRecipe(target, lm), lm, 200);
    const line = lineOnLocator(locator, target, lm);
    expect(line?.vertical).toBe(true);
    // à direita do centro da imagem: x positivo é a esquerda do paciente
    expect(line!.at).toBeGreaterThan(locator.image.width / 2);
    const back = positionFromPixel(locator, Math.floor(line!.at), 10, target);
    expect(Math.abs(back - 60)).toBeLessThan(locator.image.pixel);

    const axial = recipe({ plano: 'axial', referencia: 'ponto', ponto: 300 });
    const coronal = renderCut(vol, locatorRecipe(axial, lm), lm, 200);
    expect(coronal.frame.labels.top).toBe('S');
    expect(lineOnLocator(coronal, axial, lm)?.vertical).toBe(false);
  });
});
