import { describe, expect, it } from 'vitest';
import { renderCut } from '@/src/catstudio/director/cut';
import { interpret } from '@/src/catstudio/director/interpret';
import { findLandmarks } from '@/src/catstudio/director/landmarks';
import {
  DEFAULT_DEPTH,
  DEFAULT_THICKNESS,
  defaultRecipe,
  describeRecipe,
  sanitizeRecipe,
  type Recipe,
} from '@/src/catstudio/director/recipe';
import {
  styleForWindow,
  transfer,
  viewDirection,
} from '@/src/catstudio/director/render3d';
import { HERNIA, axialPhantom, pixelOf } from './phantom';

const vol = axialPhantom(2);
const lm = findLandmarks(vol);
const recipe = (extra: Partial<Recipe>): Recipe => ({
  ...defaultRecipe(),
  projecao: '3d',
  espessura: DEFAULT_DEPTH,
  ...extra,
});

/** Cor [r, g, b] do pixel onde cai o ponto do paciente. */
function colorAt(cut: ReturnType<typeof renderCut>, point: number[]) {
  const o = 4 * pixelOf(cut, point).index;
  return Array.from(cut.image.rgba!.slice(o, o + 3));
}
const brightness = (c: number[]) => (c[0] + c[1] + c[2]) / 3;

describe('diretor: reconstrução 3D recortada', () => {
  // sagital pelo pulmão esquerdo e pela hérnia (x = 85)
  const cut = renderCut(
    vol,
    recipe({ plano: 'sagital', referencia: 'ponto', ponto: HERNIA[0] }),
    lm,
    260
  );

  it('olha para dentro da imagem, do lado que foi retirado', () => {
    // sagital: observador à esquerda do paciente, olhando para a direita (−x)
    expect(viewDirection(cut.frame)).toEqual([-1, 0, 0]);
    const coronal = renderCut(vol, recipe({ plano: 'coronal' }), lm, 60);
    // (o produto vetorial dá −0 nos eixos nulos)
    expect(viewDirection(coronal.frame).map((c) => c + 0)).toEqual([0, 1, 0]);
  });

  it('a face do corte mostra o tecido pela cor: músculo avermelhado, cálcio claro', () => {
    const muscle = colorAt(cut, [HERNIA[0], 60, 60]); // 40 UH
    expect(muscle[0]).toBeGreaterThan(muscle[1] + 30);
    expect(muscle[0]).toBeGreaterThan(muscle[2] + 30);
    const dense = colorAt(cut, HERNIA); // 300 UH
    expect(brightness(dense)).toBeGreaterThan(brightness(muscle) + 30);
    expect(dense[1]).toBeGreaterThan(muscle[1] + 40);
  });

  it('através do pulmão se vê o que está atrás, mais escuro que a face', () => {
    // no plano é ar (pulmão esquerdo); o raio segue até o mediastino
    const behind = colorAt(cut, [HERNIA[0], 0, 280]);
    const face = colorAt(cut, [HERNIA[0], 60, 60]);
    expect(brightness(behind)).toBeGreaterThan(15); // não é o fundo
    expect(brightness(behind)).toBeLessThan(brightness(face));
    expect(behind[0]).toBeGreaterThan(behind[2]); // ainda é cor de tecido
  });

  it('a profundidade limita até onde se vê', () => {
    const shallow = renderCut(
      vol,
      recipe({
        plano: 'sagital',
        referencia: 'ponto',
        ponto: HERNIA[0],
        espessura: 20,
        fundo: '#102030',
      }),
      lm,
      260
    );
    // 20 mm de pulmão não chegam à parede: aparece o fundo
    expect(colorAt(shallow, [HERNIA[0], 0, 280])).toEqual([16, 32, 48]);
  });

  it('fora do corpo aparece a cor de fundo pedida', () => {
    const white = renderCut(
      vol,
      recipe({
        plano: 'axial',
        referencia: 'ponto',
        ponto: 500,
        fundo: '#ffffff',
      }),
      lm,
      60
    );
    // corte acima da cabeça, olhando para cima: só ar
    // (o início de cada raio varia um pouco por pixel: tolera 1–2 tons)
    colorAt(white, [0, 0, 420]).forEach((c) => expect(c).toBeGreaterThan(250));
  });

  it('estilo "só osso" deixa as partes moles transparentes', () => {
    const bone = renderCut(
      vol,
      recipe({
        plano: 'sagital',
        referencia: 'ponto',
        ponto: HERNIA[0],
        janela: 'osso',
        fundo: '#000000',
      }),
      lm,
      260
    );
    expect(brightness(colorAt(bone, [HERNIA[0], 60, 60]))).toBeLessThan(8);
    expect(brightness(colorAt(bone, HERNIA))).toBeGreaterThan(60);
  });

  it('função de transferência: ar transparente, densidade crescente mais opaca', () => {
    const out = new Float32Array(4);
    transfer('tecidos', -1000, out);
    expect(out[3]).toBe(0);
    transfer('tecidos', -800, out);
    expect(out[3]).toBe(0); // parênquima pulmonar
    transfer('tecidos', 40, out);
    const muscle = out[3];
    transfer('tecidos', 1500, out);
    expect(out[3]).toBeGreaterThan(muscle);
    expect(styleForWindow('osso')).toBe('osso');
    expect(styleForWindow('angio')).toBe('vasos');
    expect(styleForWindow('pulmao')).toBe('tecidos');
  });
});

describe('diretor: pedir o 3D por texto', () => {
  const current: Recipe = {
    ...defaultRecipe(),
    plano: 'sagital',
    referencia: 'ponto',
    ponto: 30,
  };

  it('"mas em 3d" transforma o corte atual em reconstrução 3D', () => {
    const { recipe: next, understood, notes } = interpret('mas em 3d', current);
    expect(understood).toBe(true);
    expect(notes).toEqual([]);
    expect(next).toEqual({
      ...current,
      projecao: '3d',
      espessura: DEFAULT_DEPTH,
    });
  });

  it('entende as outras formas de pedir', () => {
    [
      'em 3D',
      'reconstrução 3 d',
      'tridimensional',
      'faz a reconstrução',
    ].forEach((text) =>
      expect(interpret(text, current).recipe.projecao).toBe('3d')
    );
    expect(
      interpret('sagital na hemiclavicular esquerda em 3d', null).recipe
    ).toMatchObject({
      plano: 'sagital',
      referencia: 'hemiclavicular-esquerda',
      projecao: '3d',
      espessura: DEFAULT_DEPTH,
    });
  });

  it('a profundidade pode ser dita, e os estilos vêm da janela', () => {
    const deep = interpret('3d com 8 cm de profundidade', current).recipe;
    expect(deep).toMatchObject({ projecao: '3d', espessura: 80 });
    expect(interpret('janela de osso', deep).recipe).toMatchObject({
      projecao: '3d',
      janela: 'osso',
    });
  });

  it('voltar do 3D para MIP ou corte fino não herda a profundidade', () => {
    const solid = interpret('em 3d', current).recipe;
    expect(interpret('mip', solid).recipe).toMatchObject({
      projecao: 'mip',
      espessura: DEFAULT_THICKNESS,
    });
    expect(interpret('corte fino', solid).recipe.projecao).toBe('fina');
  });

  it('descreve o 3D e aceita a projeção em receitas vindas de fora', () => {
    const text = describeRecipe({ ...current, projecao: '3d', espessura: 160 });
    expect(text).toContain(
      'reconstrução 3D recortada no plano, 160 mm de profundidade'
    );
    expect(text).toContain('cores: tecidos');
    expect(sanitizeRecipe({ projecao: '3d', espessura: 5000 })).toMatchObject({
      projecao: '3d',
      espessura: 300,
    });
  });
});
