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
  editSculpt,
  forgetSculpts,
  resetSculpt,
  sculptOf,
  sculptSummary,
  undoSculpt,
} from '../state';
import { applyMask } from '../useSculptedImage';
import { shouldRecover, useGlRecovery } from '../../glRecovery';

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
    applyMask(source, Uint8Array.from([0, 1, 0]), target, -1024);
    expect([...target]).toEqual([10, -1024, 30]);
    expect([...source]).toEqual([10, 20, 30]);
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
