import { describe, it, expect } from 'vitest';
import type { Dims } from '../mask';
import {
  LAYER_CODE,
  allVisible,
  available,
  classify,
  hiddenByLayers,
} from '../layers';
import { growLayers, startGrow } from '../grow';

const N = 48;
const DIMS: Dims = [N, N, N];
const at = (i: number, j: number, k: number) => i + N * (j + N * k);

/**
 * Corpo (cilindro de raio 18, 1 mm/voxel): pele e músculo 40 UH, anel de
 * gordura −100, um "osso" com casca de 900 e miolo de 250, um vaso com
 * contraste de 300 e uma mesa embaixo, separada do corpo.
 */
function body(contrast = true) {
  const scalars = new Int16Array(N * N * N).fill(-1000);
  for (let k = 4; k < 44; k++)
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const r = Math.hypot(i - 24, j - 22);
        const index = at(i, j, k);
        if (j >= 44) scalars[index] = 150; // mesa
        if (r >= 18) continue;
        scalars[index] = r > 12 && r < 15 ? -100 : 40;
        const bone = Math.hypot(i - 18, j - 22);
        if (bone < 4) scalars[index] = bone > 2.5 ? 900 : 250;
        if (contrast && Math.hypot(i - 30, j - 22) < 2) scalars[index] = 300;
        // um "pulmão" de ar com um nódulo cálcico solto dentro
        const lung = Math.hypot(i - 24, j - 15);
        if (lung < 5) scalars[index] = lung < 1.5 && k === 20 ? 400 : -850;
      }
  return { dims: DIMS, scalars };
}

describe('camadas de tecido', () => {
  const set = classify(body(), 1);
  const code = (i: number, j: number, k: number) => set.labels[at(i, j, k)];

  it('separa cada tecido', () => {
    expect(code(24, 46, 20)).toBe(LAYER_CODE.fora); // mesa
    expect(code(2, 2, 20)).toBe(LAYER_CODE.fora); // ar
    expect(code(24, 39, 20)).toBe(LAYER_CODE.pele);
    expect(code(24, 22 + 13, 20)).toBe(LAYER_CODE.gordura);
    expect(code(24, 22, 20)).toBe(LAYER_CODE.moles);
    expect(code(30, 22, 20)).toBe(LAYER_CODE.vasos);
    expect(code(18, 22, 20)).toBe(LAYER_CODE.osso);
    expect(code(15, 22, 20)).toBe(LAYER_CODE.osso); // casca
    expect(code(24, 15, 20)).toBe(LAYER_CODE.vasos); // nódulo no ar: dentro
    expect(code(26, 15, 20)).toBe(0); // ar do pulmão: sem camada
    LAYERS_ALL.forEach((layer) => expect(available(set, layer)).toBe(true));
  });

  it('sem contraste não há botão de vasos', () => {
    expect(available(classify(body(false), 1), 'vasos')).toBe(false);
  });

  it('esconde só as camadas desligadas', () => {
    expect(hiddenByLayers(set, allVisible())).toBeNull();
    const hidden = hiddenByLayers(set, {
      ...allVisible(),
      pele: false,
      moles: false,
    })!;
    expect(hidden[at(24, 39, 20)]).toBe(1);
    expect(hidden[at(24, 22, 20)]).toBe(1);
    expect(hidden[at(18, 22, 20)]).toBe(0);
    expect(hidden[at(30, 22, 20)]).toBe(0);
  });
});

const LAYERS_ALL = [
  'fora',
  'pele',
  'gordura',
  'moles',
  'vasos',
  'osso',
] as const;

describe('crescer: destacar', () => {
  it('pinta o destaque e deixa o escondido como estava', () => {
    const scalars = new Int16Array(N * N * N).fill(-1000);
    for (let i = 4; i < 30; i++) scalars[at(i, 10, 10)] = 300;
    const hidden = new Uint8Array(N * N * N);
    hidden[at(20, 10, 10)] = 1;
    const into = new Uint8Array(N * N * N);
    const grower = startGrow({ dims: DIMS, scalars, hidden }, at(4, 10, 10), {
      threshold: 150,
      keep: false,
      into,
    })!;
    expect(growLayers(grower, 100)).toBe(16); // para no escondido
    expect(into[at(19, 10, 10)]).toBe(1);
    expect(into[at(21, 10, 10)]).toBe(0);
    expect(hidden.reduce((a, b) => a + b, 0)).toBe(1);
  });
});
