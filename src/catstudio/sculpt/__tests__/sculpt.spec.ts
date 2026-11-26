import { describe, it, expect, beforeEach } from 'vitest';
import {
  type Dims,
  type Grid,
  firstHit,
  keepStructure,
  lassoCut,
  packMask,
  rasterPolygon,
  removeFragments,
  removeStructure,
  unpackMask,
  visibleThreshold,
} from '../mask';
import {
  UNDO_LEVELS,
  beginStroke,
  boneModeFor,
  boneOf,
  boneViews,
  clearBone,
  editSculpt,
  sculptVersions,
  setBone,
  setBoneOpacity,
  forgetSculpts,
  resetSculpt,
  sculptOf,
  sculptSummary,
  undoSculpt,
} from '../state';
import { applyHidden, applySplit } from '../useSculptedImage';
import { shouldRecover, useGlRecovery } from '../../glRecovery';
import { grownVoxels, growLayers, startGrow } from '../grow';
import { countBone, detectBone, toggleBone } from '../bone';
import {
  DEFAULT_LOOK,
  LIGHT_PRESETS,
  choosePreset,
  lightLook,
  lightPosition,
  parseBackground,
  sanitizeLook,
} from '../../lightLook';
import { exportScale } from '../../capture';

const DIMS: Dims = [20, 20, 20];
const at = (i: number, j: number, k: number) => i + 20 * (j + 20 * k);

/** Um bloco grande (2..9)³ e um grão solto de 2 voxels em (15..16, 15, 15). */
function phantom(): Grid {
  const scalars = new Int16Array(8000).fill(-1000);
  for (let k = 2; k < 10; k++)
    for (let j = 2; j < 10; j++)
      for (let i = 2; i < 10; i++) scalars[at(i, j, k)] = 300;
  scalars[at(15, 15, 15)] = 400;
  scalars[at(16, 15, 15)] = 400;
  return { dims: DIMS, scalars, hidden: new Uint8Array(8000) };
}

/** Vista de frente, ortográfica: o voxel (i, j) cai em (i/20, j/20) da tela. */
const FRONT = [0.1, 0, 0, 0, 0, 0.1, 0, 0, 0, 0, 0, 0, -1, -1, 0, 1];
const hiddenCount = (grid: Grid) => grid.hidden.reduce((a, b) => a + b, 0);

describe('máscara em bits', () => {
  it('guarda e devolve a mesma máscara', () => {
    const mask = Uint8Array.from([1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 1]);
    const back = new Uint8Array(mask.length);
    unpackMask(packMask(mask), back);
    expect([...back]).toEqual([...mask]);
    expect(packMask(mask).length).toBe(2);
  });
});

describe('laço', () => {
  const leftHalf = rasterPolygon(
    [
      [0, 0],
      [0.5, 0],
      [0.5, 1],
      [0, 1],
    ],
    64
  );

  it('preenche o polígono pela regra par-ímpar', () => {
    expect(leftHalf.bits[10 * 64 + 5]).toBe(1);
    expect(leftHalf.bits[10 * 64 + 40]).toBe(0);
    expect(rasterPolygon([[0, 0]], 8).bits.some(Boolean)).toBe(false);
  });

  it('apaga o que está dentro, em toda a profundidade', () => {
    const grid = phantom();
    const changed = lassoCut(grid, {
      toClip: FRONT,
      shape: leftHalf,
      keepInside: false,
    });
    expect(changed).toBe(10 * 20 * 20);
    expect(grid.hidden[at(3, 3, 3)]).toBe(1);
    expect(grid.hidden[at(3, 3, 19)]).toBe(1);
    expect(grid.hidden[at(15, 15, 15)]).toBe(0);
  });

  it('manter: sobra só o que está dentro', () => {
    const grid = phantom();
    lassoCut(grid, { toClip: FRONT, shape: leftHalf, keepInside: true });
    expect(grid.hidden[at(3, 3, 3)]).toBe(0);
    expect(grid.hidden[at(15, 15, 15)]).toBe(1);
  });

  it('ignora o que está atrás da câmera', () => {
    const grid = phantom();
    const behind = [...FRONT];
    behind[15] = -1;
    const changed = lassoCut(grid, {
      toClip: behind,
      shape: leftHalf,
      keepInside: false,
    });
    expect(changed).toBe(0);
  });
});

describe('estruturas', () => {
  it('apaga a estrutura inteira ligada ao voxel clicado, e só ela', () => {
    const grid = phantom();
    expect(removeStructure(grid, at(5, 5, 5), 150)).toBe(512);
    expect(grid.hidden[at(2, 2, 2)]).toBe(1);
    expect(grid.hidden[at(15, 15, 15)]).toBe(0);
    expect(hiddenCount(grid)).toBe(512);
  });

  it('manter: fica só a estrutura clicada', () => {
    const grid = phantom();
    expect(keepStructure(grid, at(15, 15, 15), 150)).toBe(2);
    expect(hiddenCount(grid)).toBe(8000 - 2);
    expect(grid.hidden[at(16, 15, 15)]).toBe(0);
  });

  it('manter num ponto vazio não muda nada', () => {
    const grid = phantom();
    expect(keepStructure(grid, at(0, 0, 0), 150)).toBe(0);
    expect(hiddenCount(grid)).toBe(0);
  });

  it('tira os fragmentos pequenos e deixa a estrutura grande', () => {
    const grid = phantom();
    expect(removeFragments(grid, 150, 10)).toEqual({
      removed: 1,
      kept: 1,
      voxels: 2,
    });
    expect(grid.hidden[at(15, 15, 15)]).toBe(1);
    expect(grid.hidden[at(5, 5, 5)]).toBe(0);
  });

  it('não liga estruturas pela borda da linha', () => {
    const grid = phantom();
    (grid.scalars as Int16Array)[at(19, 0, 0)] = 400;
    (grid.scalars as Int16Array)[at(0, 1, 0)] = 400;
    expect(removeStructure(grid, at(19, 0, 0), 150)).toBe(1);
  });
});

describe('clique', () => {
  it('acha o primeiro voxel visível no raio', () => {
    const grid = phantom();
    const ray = { from: [5, 5, 19], to: [5, 5, 0], threshold: 150 } as const;
    expect(firstHit(grid, { ...ray, from: [5, 5, 19], to: [5, 5, 0] })).toBe(
      at(5, 5, 9)
    );
    removeStructure(grid, at(5, 5, 9), 150);
    expect(firstHit(grid, { ...ray, from: [5, 5, 19], to: [5, 5, 0] })).toBe(
      -1
    );
  });

  it('respeita a caixa de corte', () => {
    const grid = phantom();
    const hit = firstHit(grid, {
      from: [5, 5, 19],
      to: [5, 5, 0],
      threshold: 150,
      accept: (_i, _j, k) => k < 6,
    });
    expect(hit).toBe(at(5, 5, 5));
  });

  it('tira o limiar da curva de opacidade do preset', () => {
    const table = [0, 0, 0, 0.02, 0.5, 1];
    expect(visibleThreshold(table, [0, 500])).toBe(400);
    expect(visibleThreshold([0, 0], [-1000, 500])).toBe(-1000);
  });
});

describe('estado e desfazer', () => {
  beforeEach(forgetSculpts);

  const hideOne = (index: number) => (hidden: Uint8Array) => {
    hidden[index] = 1;
    return 1;
  };

  it('guarda cada edição e desfaz na ordem inversa', () => {
    editSculpt('a', DIMS, hideOne(1));
    editSculpt('a', DIMS, hideOne(2));
    expect(sculptSummary('a')).toEqual({ hiddenVoxels: 2, undoLevels: 2 });
    expect(undoSculpt('a')).toBe(true);
    expect(sculptOf('a', DIMS)!.hidden[2]).toBe(0);
    expect(sculptOf('a', DIMS)!.hidden[1]).toBe(1);
    undoSculpt('a');
    expect(undoSculpt('a')).toBe(false);
    expect(sculptSummary('a').hiddenVoxels).toBe(0);
  });

  it('edição que não muda nada não entra no desfazer', () => {
    expect(editSculpt('a', DIMS, () => 0)).toBe(0);
    expect(sculptSummary('a').undoLevels).toBe(0);
  });

  it('restaurar tudo pode ser desfeito', () => {
    editSculpt('a', DIMS, hideOne(7));
    expect(resetSculpt('a')).toBe(true);
    expect(sculptSummary('a').hiddenVoxels).toBe(0);
    undoSculpt('a');
    expect(sculptSummary('a').hiddenVoxels).toBe(1);
    expect(resetSculpt('outro')).toBe(false);
  });

  it('limita os níveis de desfazer', () => {
    for (let n = 0; n < UNDO_LEVELS + 5; n++) editSculpt('a', DIMS, hideOne(n));
    expect(sculptSummary('a').undoLevels).toBe(UNDO_LEVELS);
  });

  it('volume de outro tamanho começa do zero', () => {
    editSculpt('a', DIMS, hideOne(1));
    expect(sculptOf('a', [10, 10, 10])).toBeNull();
    editSculpt('a', [10, 10, 10], hideOne(0));
    expect(sculptSummary('a')).toEqual({ hiddenVoxels: 1, undoLevels: 1 });
  });

  it('troca os voxels escondidos por ar sem tocar no original', () => {
    const source = Int16Array.from([10, 20, 30]);
    const target = new Int16Array(3);
    applyHidden(
      source,
      { hidden: Uint8Array.from([0, 1, 0]), bone: null },
      target,
      -1024
    );
    expect([...target]).toEqual([10, -1024, 30]);
    expect([...source]).toEqual([10, 20, 30]);
  });
});

describe('crescer a partir de um ponto', () => {
  /** Um tubo de 1 voxel ao longo de i, de 2 a 17, em (j, k) = (10, 10). */
  function tube(): Grid {
    const scalars = new Int16Array(8000).fill(-1000);
    for (let i = 2; i < 18; i++) scalars[at(i, 10, 10)] = 350;
    return { dims: DIMS, scalars, hidden: new Uint8Array(8000) };
  }

  it('avança uma camada por vez ao longo do vaso', () => {
    const grid = tube();
    const grower = startGrow(grid, at(2, 10, 10), {
      threshold: 150,
      keep: false,
    })!;
    expect(grownVoxels(grower)).toBe(1);
    expect(growLayers(grower, 3)).toBe(4);
    expect(grid.hidden[at(5, 10, 10)]).toBe(1);
    expect(grid.hidden[at(6, 10, 10)]).toBe(0);
    expect(growLayers(grower, 100)).toBe(16);
  });

  it('manter: sobra só o que já cresceu', () => {
    const grid = tube();
    const grower = startGrow(grid, at(2, 10, 10), {
      threshold: 150,
      keep: true,
    })!;
    growLayers(grower, 2);
    expect(grid.hidden[at(4, 10, 10)]).toBe(0);
    expect(grid.hidden[at(5, 10, 10)]).toBe(1);
    expect(hiddenCount(grid)).toBe(8000 - 3);
  });

  it('não começa no vazio nem atravessa o que já estava escondido', () => {
    const grid = tube();
    expect(
      startGrow(grid, at(0, 0, 0), { threshold: 150, keep: true })
    ).toBeNull();
    expect(hiddenCount(grid)).toBe(0);
    grid.hidden[at(6, 10, 10)] = 1;
    const grower = startGrow(grid, at(2, 10, 10), {
      threshold: 150,
      keep: true,
    })!;
    expect(growLayers(grower, 100)).toBe(4);
  });

  it('o gesto inteiro vale um único desfazer', () => {
    forgetSculpts();
    const stroke = beginStroke('g', DIMS);
    stroke.hidden[3] = 1;
    stroke.update();
    stroke.hidden[4] = 1;
    stroke.update();
    expect(sculptSummary('g')).toEqual({ hiddenVoxels: 2, undoLevels: 1 });
    undoSculpt('g');
    expect(sculptSummary('g').hiddenVoxels).toBe(0);
    const again = beginStroke('g', DIMS);
    again.hidden[9] = 1;
    again.cancel();
    expect(sculptSummary('g')).toEqual({ hiddenVoxels: 0, undoLevels: 0 });
  });
});

describe('osso', () => {
  /**
   * Um "osso" (4..11)³ com casca de 900 e miolo de 250, um "vaso" homogêneo de
   * 350 em (14..17, 2..17, 14..17) e uma calcificação solta de 2 voxels.
   */
  function body(): Grid {
    const scalars = new Int16Array(8000).fill(40);
    const shell = (n: number) => n === 4 || n === 11;
    for (let k = 4; k < 12; k++)
      for (let j = 4; j < 12; j++)
        for (let i = 4; i < 12; i++)
          scalars[at(i, j, k)] = shell(i) || shell(j) || shell(k) ? 900 : 250;
    for (let k = 14; k < 18; k++)
      for (let j = 2; j < 18; j++)
        for (let i = 14; i < 18; i++) scalars[at(i, j, k)] = 350;
    scalars[at(1, 1, 1)] = 1200;
    scalars[at(2, 1, 1)] = 1200;
    return { dims: DIMS, scalars, hidden: new Uint8Array(8000) };
  }
  const OPTIONS = { low: 200, minVoxels: 20 };

  it('marca o osso e deixa o vaso contrastado e a calcificação', () => {
    const grid = body();
    const result = detectBone(grid, OPTIONS);
    expect(result.components).toBe(1);
    expect(result.voxels).toBe(512);
    expect(result.label[at(4, 4, 4)]).toBe(1);
    expect(result.label[at(8, 8, 8)]).toBe(1);
    expect(result.label[at(15, 10, 15)]).toBe(0);
    expect(result.label[at(1, 1, 1)]).toBe(0);
  });

  it('leva junto a franja de volume parcial, sem invadir o vaso', () => {
    const { label } = detectBone(body(), OPTIONS);
    expect(label[at(3, 8, 8)]).toBe(2);
    expect(label[at(2, 8, 8)]).toBe(2);
    expect(label[at(1, 8, 8)]).toBe(0);
    expect(label[at(14, 8, 14)]).toBe(0);
  });

  it('não procura no que já foi apagado', () => {
    const grid = body();
    removeStructure(grid, at(8, 8, 8), 200);
    expect(detectBone(grid, OPTIONS).voxels).toBe(0);
  });

  it('o clique corrige: vira osso e deixa de ser', () => {
    const grid = body();
    const { label } = detectBone(grid, OPTIONS);
    expect(toggleBone(grid, label, at(15, 10, 15), 200)).toBe(4 * 16 * 4);
    expect(label[at(15, 10, 15)]).toBe(1);
    expect(toggleBone(grid, label, at(8, 8, 8), 200)).toBe(-512);
    expect(label[at(8, 8, 8)]).toBe(0);
    expect(label[at(3, 8, 8)]).toBe(0);
    expect(countBone(label)).toBe(256);
    expect(toggleBone(grid, label, at(0, 19, 19), 200)).toBe(0);
  });

  it('esconder e translúcido montam o volume certo', () => {
    const source = Int16Array.from([10, 20, 30, 40]);
    const layers = {
      hidden: Uint8Array.from([0, 0, 0, 1]),
      bone: Uint8Array.from([0, 1, 2, 1]),
    };
    const hiddenOut = new Int16Array(4);
    applyHidden(source, layers, hiddenOut, -1024);
    expect([...hiddenOut]).toEqual([10, -1024, -1024, -1024]);
    const split = new Int16Array(8);
    applySplit(source, layers, split, -1024);
    expect([...split]).toEqual([10, -1024, -1024, 20, -1024, 30, -1024, -1024]);
  });

  it('a opacidade decide como o osso entra no volume', () => {
    forgetSculpts();
    expect(boneModeFor(1)).toBe('none');
    expect(boneModeFor(0)).toBe('hide');
    expect(boneModeFor(0.4)).toBe('split');
    setBone('b', { dims: DIMS, label: new Uint8Array(8000), voxels: 5 });
    const before = sculptVersions.b;
    setBoneOpacity('b', 0.5);
    expect(sculptVersions.b).toBe(before + 1);
    setBoneOpacity('b', 0.3);
    expect(sculptVersions.b).toBe(before + 1);
    setBoneOpacity('b', -2);
    expect(boneViews.b.opacity).toBe(0);
    expect(boneOf('b', [1, 1, 1])).toBeNull();
    clearBone('b');
    expect(boneViews.b).toBeUndefined();
  });
});

describe('iluminação e exportação', () => {
  it('a luz padrão do estúdio vem de cima e da esquerda', () => {
    const [x, y, z] = lightPosition({ direction: -35, height: 35 });
    expect(x).toBeLessThan(0);
    expect(y).toBeGreaterThan(0);
    expect(z).toBeGreaterThan(0);
    expect(Math.hypot(x, y, z)).toBeCloseTo(1);
    expect(lightPosition({ direction: 0, height: 0 })).toEqual([0, 0, 1]);
  });

  it('aceita ajustes estragados do armazenamento', () => {
    const look = sanitizeLook({
      preset: 'neon',
      direction: 900,
      intensity: 'forte',
      background: 'vermelho',
    });
    expect(look.preset).toBe('padrao');
    expect(look.direction).toBe(90);
    expect(look.intensity).toBe(DEFAULT_LOOK.intensity);
    expect(look.background).toBe('#000000');
    expect(sanitizeLook(null)).toEqual(DEFAULT_LOOK);
    expect(parseBackground('#ffffff')).toEqual([1, 1, 1]);
  });

  it('escolher um preset troca luz e material de uma vez', () => {
    choosePreset('dramatico');
    expect(lightLook.preset).toBe('dramatico');
    expect(lightLook.ambient).toBe(LIGHT_PRESETS.dramatico.ambient);
    expect(lightLook.direction).toBe(60);
    choosePreset('padrao');
    expect(lightLook.direction).toBe(60);
  });

  it('a exportação não passa de 4096 px no maior lado', () => {
    expect(exportScale([1000, 800], 2)).toBe(2);
    expect(exportScale([1600, 900], 4)).toBeCloseTo(2.56);
    expect(exportScale([5000, 900], 4)).toBe(1);
  });
});

describe('recuperação do contexto de vídeo', () => {
  it('desiste depois de três quedas no mesmo minuto', () => {
    expect(shouldRecover([], 1000)).toBe(true);
    expect(shouldRecover([0, 100, 200], 1000)).toBe(false);
    expect(shouldRecover([0, 100, 200], 70_000)).toBe(true);
  });

  it('avisa quando para de insistir e volta com o botão', () => {
    let clock = 0;
    const gl = useGlRecovery(() => clock);
    for (let n = 0; n < 3; n++) {
      clock += 10;
      gl.recoverGl();
    }
    expect(gl.glGaveUp.value).toBe(false);
    gl.recoverGl();
    expect(gl.glGaveUp.value).toBe(true);
    const before = gl.glGeneration.value;
    gl.retryGl();
    expect(gl.glGaveUp.value).toBe(false);
    expect(gl.glGeneration.value).toBe(before + 1);
  });
});
