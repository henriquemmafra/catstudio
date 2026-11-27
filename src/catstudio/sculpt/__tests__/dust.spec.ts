import { describe, it, expect, beforeEach } from 'vitest';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import { fragments } from '../tools';
import {
  forgetSculpts,
  setLayerVisible,
  setLayers,
  sculptSummary,
} from '../state';
import { LAYERS, LAYER_CODE, type LayerSet } from '../layers';

const N = 20;
const at = (i: number, j: number, k: number) => i + N * (j + N * k);

/** Bloco grande de osso (300), um grão de 2 voxels e uma ponte de músculo. */
function scene() {
  const values = new Int16Array(N * N * N).fill(-1000);
  for (let k = 2; k < 12; k++)
    for (let j = 2; j < 12; j++)
      for (let i = 2; i < 12; i++) values[at(i, j, k)] = 300;
  values[at(15, 6, 6)] = 300;
  values[at(16, 6, 6)] = 300;
  for (let i = 12; i < 15; i++) values[at(i, 6, 6)] = 40; // ponte de músculo
  const base = vtkImageData.newInstance();
  base.setDimensions([N, N, N]);
  base.setSpacing([1, 1, 1]);
  base
    .getPointData()
    .setScalars(
      vtkDataArray.newInstance({ name: 's', values, numberOfComponents: 1 })
    );
  const labels = new Uint8Array(N * N * N);
  for (let i = 12; i < 15; i++) labels[at(i, 6, 6)] = LAYER_CODE.moles;
  const counts = Object.fromEntries(
    LAYERS.map((l) => [l, 1])
  ) as LayerSet['counts'];
  const set: LayerSet = {
    dims: [N, N, N],
    labels,
    counts,
    bone: new Uint8Array(N * N * N),
    boneVoxels: 0,
  };
  return { base, set };
}

describe('limpar poeira com camadas escondidas', () => {
  beforeEach(forgetSculpts);
  const target = (base: vtkImageData) =>
    ({ view: null as never, imageID: 'p', base, aspect: 1 }) as const;

  it('com a ponte visível, o grão faz parte do bloco: nada sai', () => {
    const { base, set } = scene();
    setLayers('p', set);
    expect(fragments(target(base), 20, 0.01)).toContain('Não achei');
    expect(sculptSummary('p').hiddenVoxels).toBe(0);
  });

  it('escondendo os músculos, o grão fica solto e sai como poeira', () => {
    const { base, set } = scene();
    setLayers('p', set);
    setLayerVisible('p', 'moles', false);
    expect(fragments(target(base), 20, 0.01)).toContain('Tirei 1');
    // só o grão entra na escultura; a ponte continua sendo da camada
    expect(sculptSummary('p').hiddenVoxels).toBe(2);
  });
});
