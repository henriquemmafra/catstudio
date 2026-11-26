import { describe, it, expect } from 'vitest';
import {
  type PhotoInput,
  type Vec3,
  cameraBasis,
  emptyBlocks,
  growBlocks,
  markSlice,
  maskWeight,
  pixelRay,
  rayInterval,
  sampleAt,
  skipEmpty,
} from '../raycast';
import { gradientAt, newJob, renderRows, traceRay } from '../trace';
import { correctAlpha, LUT_SIZE } from '../collect';
import { photoSize } from '../run';

/** Volume N³ de 1 mm, origem 0: esfera de "osso" (1000) no centro, ar (-1000). */
function sphereInput(n = 40, extra: Partial<PhotoInput> = {}): PhotoInput {
  const data = new Int16Array(n * n * n).fill(-1000);
  const c = (n - 1) / 2;
  for (let k = 0; k < n; k++)
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++)
        if ((i - c) ** 2 + (j - c) ** 2 + (k - c) ** 2 < (n / 4) ** 2)
          data[i + n * (j + n * k)] = 1000;
  const rgb = new Float32Array(3 * LUT_SIZE);
  const alpha = new Float32Array(LUT_SIZE);
  const shadowAlpha = new Float32Array(LUT_SIZE);
  for (let e = 0; e < LUT_SIZE; e++) {
    const value = -1000 + (2000 * e) / (LUT_SIZE - 1);
    if (value > 300) {
      rgb.set([1, 0.5, 0.2], 3 * e);
      alpha[e] = 0.6;
      shadowAlpha[e] = 0.9;
    }
  }
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  return {
    volume: {
      data,
      dims: [n, n, n],
      worldToIndex: identity,
      axes: [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
    },
    transfer: {
      rgb,
      alpha,
      shadowAlpha,
      min: -1000,
      scale: (LUT_SIZE - 1) / 2000,
    },
    mask: null,
    camera: {
      position: [c, c, -200],
      focalPoint: [c, c, c],
      viewUp: [0, -1, 0],
      viewAngle: 30,
      parallel: true,
      parallelScale: n / 2,
    },
    planes: [],
    lighting: {
      direction: [0, 0, -1],
      intensity: 1,
      ambient: 0.2,
      diffuse: 0.8,
      specular: 0,
      specularPower: 10,
      shadow: 0,
    },
    background: [0, 0, 1],
    width: 32,
    height: 32,
    step: 0.5,
    ...extra,
  };
}

function blocksFor(input: PhotoInput) {
  const blocks = emptyBlocks(input.volume);
  for (let k = 0; k < input.volume.dims[2]; k++)
    markSlice(input.volume, input.transfer, blocks, k);
  growBlocks(blocks);
  return blocks;
}

const pixel = (rgba: Uint8ClampedArray, w: number, x: number, y: number) =>
  Array.from(rgba.slice(4 * (x + w * y), 4 * (x + w * y) + 3));

describe('foto final: geometria', () => {
  it('câmera paralela: raios paralelos, um por pixel', () => {
    const input = sphereInput();
    const basis = cameraBasis(input.camera);
    const a = pixelRay(input, basis, [0, 0]);
    const b = pixelRay(input, basis, [31, 31]);
    expect(a.dir).toEqual(b.dir);
    expect(a.dir[2]).toBeCloseTo(1);
    expect(b.origin[0] - a.origin[0]).toBeCloseTo((40 * 31) / 32);
  });

  it('perspectiva: o raio do centro vai para o ponto focal', () => {
    const input = sphereInput(40, {
      camera: { ...sphereInput().camera, parallel: false },
      width: 33,
      height: 33,
    });
    const ray = pixelRay(input, cameraBasis(input.camera), [16, 16]);
    expect(ray.dir[2]).toBeCloseTo(1);
    expect(ray.dir[0]).toBeCloseTo(0);
  });

  it('o raio é cortado pela caixa do volume e pelos planos', () => {
    const input = sphereInput();
    const ray = { origin: [20, 20, -100] as Vec3, dir: [0, 0, 1] as Vec3 };
    const [t0, t1] = rayInterval(input, ray);
    expect(t0).toBeCloseTo(100);
    expect(t1).toBeCloseTo(139);
    const cut = rayInterval(
      { ...input, planes: [{ origin: [0, 0, 25], normal: [0, 0, -1] }] },
      ray
    );
    expect(cut[1]).toBeCloseTo(125);
    const gone = rayInterval(
      { ...input, planes: [{ origin: [0, 0, 0], normal: [1, 0, 0] }] },
      { origin: [-5, 20, -100], dir: [0, 0, 1] }
    );
    expect(gone[0]).toBeGreaterThanOrEqual(gone[1]);
  });

  it('interpola o volume e acha o gradiente no mundo', () => {
    const input = sphereInput();
    expect(sampleAt(input.volume, 19.5, 19.5, 19.5)).toBe(1000);
    expect(sampleAt(input.volume, 0, 0, 0)).toBe(-1000);
    const g = gradientAt(input, [19.5, 19.5, 9.5]);
    // borda de cima da esfera (k pequeno): a densidade sobe para +k
    expect(g[2]).toBeGreaterThan(100);
    // espaçamento de 2 mm no eixo k: o gradiente por mm cai à metade
    const stretched = {
      ...input,
      volume: {
        ...input.volume,
        axes: [
          [1, 0, 0],
          [0, 1, 0],
          [0, 0, 2],
        ] as [Vec3, Vec3, Vec3],
      },
    };
    expect(gradientAt(stretched, [19.5, 19.5, 9.5])[2]).toBeCloseTo(g[2] / 2);
  });
});

describe('foto final: espaço vazio', () => {
  it('marca só os blocos com algo visível, mais a borda', () => {
    const input = sphereInput();
    const blocks = emptyBlocks(input.volume);
    for (let k = 0; k < 40; k++)
      markSlice(input.volume, input.transfer, blocks, k);
    expect(blocks.visible[0]).toBe(0);
    expect(blocks.visible[2 + 5 * (2 + 5 * 2)]).toBe(1);
    const before = blocks.visible.reduce((a, b) => a + b, 0);
    growBlocks(blocks);
    expect(blocks.visible.reduce((a, b) => a + b, 0)).toBeGreaterThan(before);
  });

  it('pula o bloco vazio até a borda dele, e só ele', () => {
    const input = sphereInput();
    const blocks = emptyBlocks(input.volume);
    for (let k = 0; k < 40; k++)
      markSlice(input.volume, input.transfer, blocks, k);
    expect(skipEmpty(blocks, [1, 1, 1], [0, 0, 1], 5)).toBeCloseTo(12, 2);
    expect(skipEmpty(blocks, [20, 20, 20], [0, 0, 1], 5)).toBe(5);
  });
});

describe('foto final: imagem', () => {
  it('esfera opaca e iluminada no meio, fundo nos cantos', () => {
    const input = sphereInput();
    const job = newJob(input, blocksFor(input));
    renderRows(job, 0, 32);
    expect(pixel(job.rgba, 32, 0, 0)).toEqual([0, 0, 255]);
    const [r, g, b] = pixel(job.rgba, 32, 16, 16);
    expect(r).toBeGreaterThan(200);
    expect(g).toBeGreaterThan(90);
    expect(b).toBeLessThan(80);
    // a borda da esfera, vista de lado, recebe menos luz que o centro
    expect(pixel(job.rgba, 32, 16, 6)[0]).toBeLessThan(r);
  });

  it('pular o espaço vazio não muda a imagem', () => {
    const input = sphereInput();
    const full = emptyBlocks(input.volume);
    full.visible.fill(1);
    const a = newJob(input, full);
    const b = newJob(input, blocksFor(input));
    renderRows(a, 0, 32);
    renderRows(b, 0, 32);
    let worst = 0;
    a.rgba.forEach((v, n) => {
      worst = Math.max(worst, Math.abs(v - b.rgba[n]));
    });
    expect(worst).toBeLessThanOrEqual(2);
  });

  it('a escultura esconde: máscara reduzida com fator 2', () => {
    const input = sphereInput();
    const hidden = new Uint8Array(20 * 20 * 20).fill(1);
    const mask = {
      dims: [20, 20, 20] as Vec3,
      factor: [2, 2, 2] as Vec3,
      hidden,
      bone: null,
      boneOpacity: 1,
    };
    expect(maskWeight(mask, [19.5, 19.5, 19.5])).toBe(0);
    const job = newJob({ ...input, mask }, blocksFor(input));
    renderRows(job, 16, 17);
    expect(pixel(job.rgba, 32, 16, 16)).toEqual([0, 0, 255]);
    expect(
      maskWeight(
        { ...mask, hidden: null, bone: hidden, boneOpacity: 0.3 },
        [3, 3, 3]
      )
    ).toBe(0.3);
  });

  it('a sombra escurece o que está atrás de outra coisa', () => {
    // luz vinda de trás da esfera (+z): a frente da esfera fica na sombra dela mesma
    const input = sphereInput(40, {
      lighting: { ...sphereInput().lighting, direction: [0, 0, 1], shadow: 1 },
    });
    const blocks = blocksFor(input);
    const ray = { origin: [19.5, 19.5, -100] as Vec3, dir: [0, 0, 1] as Vec3 };
    const lit = traceRay(
      { ...input, lighting: { ...input.lighting, direction: [0, 0, -1] } },
      blocks,
      ray
    );
    const shadowed = traceRay(input, blocks, ray);
    expect(shadowed[0]).toBeLessThan(lit[0] * 0.7);
  });

  it('opacidade corrigida pelo passo e tamanho da foto', () => {
    expect(correctAlpha(0.5, 1, 1)).toBeCloseTo(0.5);
    expect(correctAlpha(0.5, 2, 1)).toBeCloseTo(0.75);
    expect(correctAlpha(0, 2, 1)).toBe(0);
    expect(photoSize([551, 447], 2)).toEqual([1102, 894]);
    expect(photoSize([1600, 900], 4)).toEqual([4096, 2304]);
  });
});

describe('foto final: tempo', () => {
  it('uma foto de 1100 × 900 de um exame de 512 × 512 × 300 cabe em ~1 min', () => {
    const [nx, ny, nz] = [512, 512, 300];
    const data = new Int16Array(nx * ny * nz).fill(-1000);
    for (let k = 0; k < nz; k++)
      for (let j = 0; j < ny; j++)
        for (let i = 0; i < nx; i++) {
          const e = ((i - 256) / 220) ** 2 + ((j - 256) / 160) ** 2;
          if (e < 1) data[i + nx * (j + ny * k)] = e < 0.85 ? 40 : 60;
          if ((i - 256) ** 2 + (j - 330) ** 2 < 400)
            data[i + nx * (j + ny * k)] = 700;
        }
    const base = sphereInput();
    const s = 0.7;
    const input: PhotoInput = {
      ...base,
      volume: {
        data,
        dims: [nx, ny, nz],
        worldToIndex: [1 / s, 0, 0, 0, 0, 1 / s, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        axes: [
          [s, 0, 0],
          [0, s, 0],
          [0, 0, 1],
        ],
      },
      camera: {
        position: [180, -400, 150],
        focalPoint: [180, 180, 150],
        viewUp: [0, 0, -1],
        viewAngle: 30,
        parallel: false,
        parallelScale: 1,
      },
      lighting: { ...base.lighting, direction: [0.3, -0.8, -0.5], shadow: 0.7 },
      width: 1100,
      height: 900,
      step: 0.35,
    };
    const blocks = blocksFor(input);
    // com escultura (tirar mesa, por exemplo): a máscara entra em cada amostra
    const hidden = new Uint8Array(256 * 256 * 150);
    hidden.fill(1, 0, 256 * 20);
    const job = newJob(
      {
        ...input,
        mask: {
          dims: [256, 256, 150],
          factor: [2, 2, 2],
          hidden,
          bone: null,
          boneOpacity: 1,
        },
      },
      blocks
    );
    const start = performance.now();
    // um décimo das linhas, espalhadas
    for (let row = 0; row < 900; row += 10) renderRows(job, row, row + 1);
    const estimate = ((performance.now() - start) * 10) / 1000;
    console.log(`foto 1100×900 estimada em ${estimate.toFixed(1)} s`);
    expect(estimate).toBeLessThan(60);
  }, 120000);
});
