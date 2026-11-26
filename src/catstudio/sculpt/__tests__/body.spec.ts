import { describe, it, expect, beforeEach } from 'vitest';
import type { Dims, Grid } from '../mask';
import {
  bodyMask,
  dilateWithin,
  erode,
  largestComponent,
  outsideOf,
  removeOutsideBody,
} from '../body';
import {
  autoTable,
  forgetAutoCuts,
  setAutoTable,
  shouldAutoCut,
} from '../autoTable';
import { draggedCurve } from '../../useWindowDrag';
import { hideBall } from '../mask';
import {
  cropRotations,
  dragTurn,
  forgetBoxRotations,
  isRotated,
  resetBoxRotation,
  rotateBox,
  rotatePlane,
  rotationAbout,
  rotationOf,
} from '../../cropRotation';

const N = 40;
const DIMS: Dims = [N, N, N];
const at = (i: number, j: number, k: number) => i + N * (j + N * k);

interface Options {
  /** a mesa encosta no corpo por uma ponte fina (roupa, lençol) */
  touching?: boolean;
  /** a traqueia chega ao primeiro corte (ar ligado à borda de cima) */
  openTrachea?: boolean;
}

/**
 * Tronco: elipse de tecido com dois pulmões de ar, traqueia, uma mesa plana
 * embaixo (j alto = posterior) separada por 3 voxels de colchão, e um cabo
 * solto ao lado.
 */
function torso(options: Options = {}): Grid {
  const scalars = new Int16Array(N * N * N).fill(-1000);
  const inEllipse = (i: number, j: number, c: number[], r: number[]) =>
    ((i - c[0]) / r[0]) ** 2 + ((j - c[1]) / r[1]) ** 2 < 1;
  for (let k = 0; k < N; k++)
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const index = at(i, j, k);
        if (inEllipse(i, j, [20, 16], [15, 11])) scalars[index] = 40;
        if (inEllipse(i, j, [13, 16], [4, 6])) scalars[index] = -850;
        if (inEllipse(i, j, [27, 16], [4, 6])) scalars[index] = -850;
        if (j >= 30 && j < 33 && i >= 3 && i < 37) scalars[index] = 120;
        if (i === 2 && j === 10) scalars[index] = 300;
      }
  for (let k = 0; k < (options.openTrachea ? N : 0); k++)
    scalars[at(20, 12, k)] = -950;
  if (options.touching)
    for (let j = 27; j < 30; j++) scalars[at(20, j, 20)] = 0;
  return { dims: DIMS, scalars, hidden: new Uint8Array(N * N * N) };
}

const MESA = at(20, 31, 20);
const CABO = at(2, 10, 20);
const PULMAO = at(13, 16, 20);
const CORPO = at(20, 20, 20);
const PELE = at(20, 26, 20);
const AR_FORA = at(1, 1, 20);

describe('morfologia', () => {
  it('a erosão tira uma camada e a dilatação a devolve', () => {
    const cube = new Uint8Array(N * N * N);
    for (let k = 10; k < 20; k++)
      for (let j = 10; j < 20; j++)
        for (let i = 10; i < 20; i++) cube[at(i, j, k)] = 1;
    const eroded = erode(cube, DIMS);
    expect(eroded.reduce((a, b) => a + b, 0)).toBe(8 ** 3);
    expect(eroded[at(10, 15, 15)]).toBe(0);
    const back = dilateWithin(eroded, cube, DIMS);
    expect(back[at(10, 15, 15)]).toBe(1);
    expect(back[at(9, 15, 15)]).toBe(0);
  });

  it('fica com a maior estrutura', () => {
    const mask = new Uint8Array(N * N * N);
    for (let i = 0; i < 10; i++) mask[at(i, 0, 0)] = 1;
    for (let i = 0; i < 4; i++) mask[at(i, 5, 5)] = 1;
    const largest = largestComponent(mask, DIMS);
    expect(largest.reduce((a, b) => a + b, 0)).toBe(10);
    expect(largestComponent(new Uint8Array(8), [2, 2, 2]).some(Boolean)).toBe(
      false
    );
  });
});

describe('tirar a mesa', () => {
  it('esconde mesa, cabo e ar de fora; corpo, pele e pulmões ficam', () => {
    const grid = torso();
    const result = removeOutsideBody(grid);
    expect(grid.hidden[MESA]).toBe(1);
    expect(grid.hidden[CABO]).toBe(1);
    expect(grid.hidden[AR_FORA]).toBe(1);
    expect(grid.hidden[CORPO]).toBe(0);
    expect(grid.hidden[PELE]).toBe(0);
    expect(grid.hidden[PULMAO]).toBe(0);
    expect(result.tissue).toBe(3 * 34 * N + N);
    expect(result.body).toBeGreaterThan(10000);
  });

  it('solta a mesa mesmo encostada no corpo por um contato fino', () => {
    const grid = torso({ touching: true });
    removeOutsideBody(grid);
    expect(grid.hidden[MESA]).toBe(1);
    expect(grid.hidden[CORPO]).toBe(0);
  });

  it('a traqueia aberta no primeiro corte não esvazia os pulmões', () => {
    const grid = torso({ openTrachea: true });
    removeOutsideBody(grid);
    expect(grid.hidden[PULMAO]).toBe(0);
    expect(grid.hidden[at(20, 12, 0)]).toBe(0);
    expect(grid.hidden[at(20, 12, 20)]).toBe(0);
  });

  it('o corpo inclui a pele e o "fora" para no contorno', () => {
    const grid = torso();
    const body = bodyMask(grid);
    expect(body[PELE]).toBe(1);
    expect(body[MESA]).toBe(0);
    const outside = outsideOf(body, DIMS);
    expect(outside[AR_FORA]).toBe(1);
    expect(outside[PULMAO]).toBe(0);
  });

  it('sem corpo, não corta nada', () => {
    const grid: Grid = {
      dims: DIMS,
      scalars: new Int16Array(N * N * N).fill(-1000),
      hidden: new Uint8Array(N * N * N),
    };
    expect(removeOutsideBody(grid)).toEqual({ hidden: 0, tissue: 0, body: 0 });
    expect(grid.hidden.some(Boolean)).toBe(false);
  });

  it('respeita o que já foi apagado', () => {
    const grid = torso();
    grid.hidden[AR_FORA] = 1;
    const first = removeOutsideBody(grid).hidden;
    expect(removeOutsideBody(grid).hidden).toBe(0);
    expect(first).toBeGreaterThan(0);
  });
});

describe('tirar a mesa sozinho ao abrir', () => {
  beforeEach(() => {
    forgetAutoCuts();
    setAutoTable(false);
  });

  it('só roda se a pessoa ligou, uma vez por exame, e nunca sobre edição', () => {
    expect(shouldAutoCut('a', false)).toBe(false);
    setAutoTable(true);
    expect(autoTable.enabled).toBe(true);
    expect(shouldAutoCut('a', true)).toBe(false);
    expect(shouldAutoCut('a', false)).toBe(true);
    expect(shouldAutoCut('a', false)).toBe(false);
    expect(shouldAutoCut('b', false)).toBe(true);
  });
});

describe('janela do 3D com os dois botões', () => {
  const start = { shift: 0, shiftAlpha: 0 };

  it('para baixo sobe o nível; para a direita fica mais opaco', () => {
    expect(draggedCurve(start, 0, 150).shift).toBeCloseTo(0.1);
    expect(draggedCurve(start, 0, -150).shift).toBeCloseTo(-0.1);
    expect(draggedCurve(start, 100, 0).shiftAlpha).toBeCloseTo(-0.2);
    expect(draggedCurve(start, -100, 0).shiftAlpha).toBeCloseTo(0.2);
  });

  it('não sai dos limites', () => {
    expect(draggedCurve(start, 9999, 9999)).toEqual({
      shift: 1,
      shiftAlpha: -1,
    });
    expect(draggedCurve({ shift: 0.9, shiftAlpha: 0.9 }, -9999, -9999)).toEqual(
      { shift: -1, shiftAlpha: 1 }
    );
  });
});

describe('borracha', () => {
  const empty = (): Grid => ({
    dims: DIMS,
    scalars: new Int16Array(N * N * N),
    hidden: new Uint8Array(N * N * N),
  });

  it('apaga uma bola em volta do ponto', () => {
    const grid = empty();
    const erased = hideBall(grid, {
      center: at(20, 20, 20),
      radius: [4, 4, 4],
    });
    expect(grid.hidden[at(20, 20, 20)]).toBe(1);
    expect(grid.hidden[at(24, 20, 20)]).toBe(1);
    expect(grid.hidden[at(25, 20, 20)]).toBe(0);
    expect(grid.hidden[at(23, 23, 23)]).toBe(0);
    // perto do volume de uma esfera de raio 4
    expect(erased).toBeGreaterThan(200);
    expect(erased).toBeLessThan(340);
    expect(hideBall(grid, { center: at(20, 20, 20), radius: [4, 4, 4] })).toBe(
      0
    );
  });

  it('respeita voxel não cúbico e a borda do volume', () => {
    const grid = empty();
    hideBall(grid, { center: at(0, 0, 0), radius: [6, 2, 2] });
    expect(grid.hidden[at(6, 0, 0)]).toBe(1);
    expect(grid.hidden[at(0, 2, 0)]).toBe(1);
    expect(grid.hidden[at(0, 3, 0)]).toBe(0);
  });
});

describe('caixa de corte girada', () => {
  beforeEach(forgetBoxRotations);
  const close = (a: number[], b: number[]) =>
    a.forEach((value, n) => expect(value).toBeCloseTo(b[n]));

  it('gira o plano em torno do centro: a origem anda, a normal só gira', () => {
    const quarter = rotationAbout([10, 0, 0], [0, 0, 1], Math.PI / 2);
    const plane = rotatePlane(
      { origin: [12, 0, 0], normal: [1, 0, 0] },
      quarter
    );
    close(plane.origin, [10, 2, 0]);
    close(plane.normal, [0, 1, 0]);
  });

  it('os giros se acumulam e "alinhar" volta ao exame', () => {
    expect(isRotated('a')).toBe(false);
    const quarter = rotationAbout([0, 0, 0], [0, 0, 1], Math.PI / 2);
    rotateBox('a', quarter);
    rotateBox('a', quarter);
    expect(isRotated('a')).toBe(true);
    const plane = rotatePlane(
      { origin: [1, 0, 0], normal: [1, 0, 0] },
      rotationOf('a')
    );
    close(plane.origin, [-1, 0, 0]);
    close(plane.normal, [-1, 0, 0]);
    resetBoxRotation('a');
    expect(cropRotations.a).toBeUndefined();
    expect(rotationOf('a')[0]).toBe(1);
  });

  it('arrastar na horizontal gira em torno do "para cima" da câmera', () => {
    const camera = {
      up: [0, 0, 1] as [number, number, number],
      direction: [0, 1, 0] as [number, number, number],
    };
    const turn = dragTurn(camera, [0, 0, 0], {
      dx: 90,
      dy: 0,
      radiansPerPixel: Math.PI / 180,
    });
    const plane = rotatePlane({ origin: [1, 0, 0], normal: [1, 0, 0] }, turn);
    close(plane.normal, [0, 1, 0]);
    const tilt = dragTurn(camera, [0, 0, 0], {
      dx: 0,
      dy: 90,
      radiansPerPixel: Math.PI / 180,
    });
    // na vertical, o eixo é o "para a direita" da câmera (aqui, x)
    close(
      rotatePlane({ origin: [1, 0, 0], normal: [1, 0, 0] }, tilt).normal,
      [1, 0, 0]
    );
    expect(
      Math.abs(
        rotatePlane({ origin: [0, 0, 1], normal: [0, 0, 1] }, tilt).normal[1]
      )
    ).toBeCloseTo(1);
  });
});
