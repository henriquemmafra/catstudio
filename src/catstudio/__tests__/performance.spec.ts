import { describe, expect, it } from 'vitest';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import {
  factorsForBudget,
  isReduced,
  limitCvr,
  modeForGpu,
  reduceImage,
  reduceScalars,
  reductionFactors,
} from '../performance';

describe('CatStudio — desempenho do 3D', () => {
  it('escolhe o modo pela placa de vídeo', () => {
    expect(modeForGpu('ANGLE (Intel, Intel(R) UHD Graphics 620)')).toBe('leve');
    expect(modeForGpu('ANGLE (Google, Vulkan (SwiftShader Device))')).toBe(
      'leve'
    );
    expect(modeForGpu('')).toBe('leve');
    expect(modeForGpu('ANGLE (NVIDIA, NVIDIA GeForce RTX 3060)')).toBe(
      'equilibrado'
    );
    expect(modeForGpu('ANGLE (Apple, ANGLE Metal Renderer: Apple M2)')).toBe(
      'equilibrado'
    );
  });

  it('limita os ajustes cinematográficos sem alterar o original', () => {
    const cvr = {
      enabled: true,
      volumeQuality: 3,
      useLocalAmbientOcclusion: true,
      useVolumetricScatteringBlending: true,
      ambient: 0.2,
    };
    expect(limitCvr(cvr, 'maximo')).toBe(cvr);
    expect(limitCvr(cvr, 'equilibrado')).toMatchObject({
      enabled: true,
      volumeQuality: 2,
      useLocalAmbientOcclusion: false,
      useVolumetricScatteringBlending: false,
      ambient: 0.2,
    });
    expect(limitCvr(cvr, 'leve')).toMatchObject({
      enabled: false,
      useLocalAmbientOcclusion: false,
    });
    expect(cvr.useLocalAmbientOcclusion).toBe(true);
  });

  it('volume pequeno fica inteiro; TC grande reduz primeiro no plano', () => {
    expect(
      isReduced(reductionFactors([256, 256, 200], [1, 1, 1], 'leve'))
    ).toBe(false);
    // angio-TC cardíaca típica: reduz só no plano
    expect(reductionFactors([512, 512, 300], [0.4, 0.4, 0.5], 'leve')).toEqual([
      2, 2, 1,
    ]);
    expect(reductionFactors([512, 512, 600], [0.4, 0.4, 0.6], 'leve')).toEqual([
      2, 2, 2,
    ]);
    expect(
      reductionFactors([512, 512, 600], [0.4, 0.4, 0.6], 'maximo')
    ).toEqual([1, 1, 1]);
    const tiny = factorsForBudget([512, 512, 400], [0.75, 0.75, 1], 2e6);
    expect(
      Math.ceil(512 / tiny[0]) *
        Math.ceil(512 / tiny[1]) *
        Math.ceil(400 / tiny[2])
    ).toBeLessThanOrEqual(2e6);
  });

  it('a redução é a média dos blocos, inclusive nos blocos incompletos', async () => {
    // 5×2×2: valores = i + 10 j + 100 k
    const dims = [5, 2, 2];
    const src = new Int16Array(20);
    for (let k = 0; k < 2; k++)
      for (let j = 0; j < 2; j++)
        for (let i = 0; i < 5; i++)
          src[i + 5 * (j + 2 * k)] = i + 10 * j + 100 * k;
    const out = await reduceScalars(src, dims, [2, 2, 2]);
    expect(out!.dims).toEqual([3, 1, 1]);
    expect(out!.data).toBeInstanceOf(Int16Array);
    // média de j e k: 5 + 50 = 55; média de i nos blocos: 0,5 | 2,5 | 4
    expect(Array.from(out!.data)).toEqual([56, 58, 59]);
  });

  it('a cópia reduzida ocupa o mesmo lugar no espaço', async () => {
    const image = vtkImageData.newInstance();
    image.setDimensions([8, 8, 4]);
    image.setSpacing([0.5, 0.5, 2]);
    image.setOrigin([10, -20, 30]);
    image.setDirection([0, 1, 0, -1, 0, 0, 0, 0, 1]);
    const values = new Int16Array(8 * 8 * 4);
    // campo linear no espaço: a média de um bloco é o valor no centro dele
    for (let k = 0; k < 4; k++)
      for (let j = 0; j < 8; j++)
        for (let i = 0; i < 8; i++) {
          const w = image.indexToWorld([i, j, k]);
          values[i + 8 * (j + 8 * k)] = 4 * w[0] + 8 * w[1] + 2 * w[2];
        }
    image
      .getPointData()
      .setScalars(
        vtkDataArray.newInstance({ numberOfComponents: 1, values, name: 'x' })
      );
    const out = (await reduceImage(image, [2, 2, 2]))!;
    expect(out.getDimensions()).toEqual([4, 4, 2]);
    expect(out.getSpacing()).toEqual([1, 1, 4]);
    const data = out.getPointData().getScalars().getData();
    for (const [i, j, k] of [
      [0, 0, 0],
      [3, 1, 1],
      [2, 3, 0],
    ]) {
      const w = out.indexToWorld([i, j, k]);
      expect(data[i + 4 * (j + 4 * k)]).toBeCloseTo(
        4 * w[0] + 8 * w[1] + 2 * w[2],
        0
      );
    }
  });

  it('abandona a redução quando é cancelada', async () => {
    const src = new Int16Array(64 * 64 * 64);
    const real = Date.now;
    let t = 0;
    Date.now = () => (t += 100);
    try {
      expect(
        await reduceScalars(src, [64, 64, 64], [2, 2, 2], async () => false)
      ).toBeNull();
    } finally {
      Date.now = real;
    }
  });
});
