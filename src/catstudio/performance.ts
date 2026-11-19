/**
 * CatStudio — desempenho da renderização 3D.
 *
 * O VolView ligava a renderização cinematográfica completa (sombras e
 * oclusão ambiente com 75 amostras extras por ponto) sobre o volume inteiro
 * (uma TC de 512×512×600 são 157 milhões de voxels numa textura 3D). Em
 * notebook sem placa de vídeo dedicada isso trava a página.
 *
 * Aqui há três modos. O modo limita o que é efetivamente usado, sem apagar
 * os ajustes da pessoa:
 *  - leve: 3D clássico (sem sombras), volume reduzido a ~24 M de voxels;
 *  - equilibrado: sombras, sem oclusão ambiente, até ~64 M de voxels;
 *  - maximo: tudo como configurado no painel, volume inteiro.
 * As vistas 2D usam sempre o volume original.
 */
import { reactive } from 'vue';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import type { TypedArray } from '@kitware/vtk.js/types';

export type PerformanceMode = 'leve' | 'equilibrado' | 'maximo';

export const PERFORMANCE_MODES: Array<{
  value: PerformanceMode;
  title: string;
  hint: string;
}> = [
  {
    value: 'leve',
    title: 'Leve',
    hint: '3D clássico, sem sombras, com o volume reduzido. Para notebook sem placa de vídeo.',
  },
  {
    value: 'equilibrado',
    title: 'Equilibrado',
    hint: 'Sombras ligadas, sem oclusão ambiente. Para placa de vídeo dedicada.',
  },
  {
    value: 'maximo',
    title: 'Máximo',
    hint: 'Cinematográfico completo no volume inteiro. Pode travar em exames grandes.',
  },
];

const VOXEL_BUDGET: Record<PerformanceMode, number> = {
  leve: 24e6,
  equilibrado: 64e6,
  maximo: Infinity,
};

const STORAGE_KEY = 'catstudio.desempenho';

export function gpuName(): string {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (!gl) return '';
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const name = info
      ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL))
      : '';
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return name;
  } catch {
    return '';
  }
}

/** Placas dedicadas (e Apple Silicon) começam no equilibrado; o resto, no leve. */
export function modeForGpu(name: string): PerformanceMode {
  if (/swiftshader|llvmpipe|software|basic render/i.test(name)) return 'leve';
  return /nvidia|geforce|rtx|gtx|quadro|radeon (rx|pro)|radeon\(tm\) rx|apple m\d|\barc\b/i.test(
    name
  )
    ? 'equilibrado'
    : 'leve';
}

function initialMode(): PerformanceMode {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'leve' || saved === 'equilibrado' || saved === 'maximo')
      return saved;
  } catch {
    // sem armazenamento local: segue pela detecção
  }
  return typeof document === 'undefined' ? 'leve' : modeForGpu(gpuName());
}

export const performanceSettings = reactive({ mode: initialMode() });

export function setPerformanceMode(mode: PerformanceMode) {
  performanceSettings.mode = mode;
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // preferência vale só nesta aba
  }
}

export interface CvrLike {
  enabled: boolean;
  volumeQuality: number;
  useLocalAmbientOcclusion: boolean;
  useVolumetricScatteringBlending: boolean;
}

/** Ajustes cinematográficos efetivos para o modo (sem alterar os salvos). */
export function limitCvr<C extends CvrLike>(cvr: C, mode: PerformanceMode): C {
  if (mode === 'maximo') return cvr;
  if (mode === 'equilibrado')
    return {
      ...cvr,
      volumeQuality: Math.min(cvr.volumeQuality, 2),
      useLocalAmbientOcclusion: false,
      useVolumetricScatteringBlending: false,
    };
  return {
    ...cvr,
    enabled: false,
    volumeQuality: 1,
    useLocalAmbientOcclusion: false,
    useVolumetricScatteringBlending: false,
  };
}

export type Factors = [number, number, number];

/**
 * Fatores inteiros de redução por eixo para caber no orçamento de voxels.
 * Reduz sempre o eixo de voxel mais fino, o que aproxima o volume de
 * isotrópico (cortes de 1 mm com pixel de 0,4 mm reduzem primeiro no plano).
 */
export function reductionFactors(
  dims: ArrayLike<number>,
  spacing: ArrayLike<number>,
  mode: PerformanceMode
): Factors {
  return factorsForBudget(dims, spacing, VOXEL_BUDGET[mode]);
}

/** Miniaturas de preset (80 px) não precisam de mais que isto. */
export const THUMBNAIL_VOXEL_BUDGET = 2e6;

export function factorsForBudget(
  dims: ArrayLike<number>,
  spacing: ArrayLike<number>,
  budget: number
): Factors {
  const f: Factors = [1, 1, 1];
  const count = () =>
    Math.ceil(dims[0] / f[0]) *
    Math.ceil(dims[1] / f[1]) *
    Math.ceil(dims[2] / f[2]);
  while (count() > budget) {
    let axis = -1;
    for (let a = 0; a < 3; a++) {
      if (dims[a] / f[a] < 2) continue;
      if (axis < 0 || spacing[a] * f[a] < spacing[axis] * f[axis] - 1e-9)
        axis = a;
    }
    if (axis < 0) break;
    f[axis] += 1;
  }
  return f;
}

export const isReduced = (f: Factors) => f[0] * f[1] * f[2] > 1;

interface Block {
  src: TypedArray;
  dims: [number, number, number];
  f: Factors;
  row: Float64Array;
  hits: Uint32Array;
}

/** Soma os blocos da linha de saída (oj, ok) em `row`/`hits`. */
function accumulateRow(b: Block, oj: number, ok: number) {
  const [nx, ny, nz] = b.dims;
  b.row.fill(0);
  b.hits.fill(0);
  const k1 = Math.min(nz, (ok + 1) * b.f[2]);
  const j1 = Math.min(ny, (oj + 1) * b.f[1]);
  for (let k = ok * b.f[2]; k < k1; k++)
    for (let j = oj * b.f[1]; j < j1; j++) addLine(b, nx * (j + ny * k));
}

function addLine(b: Block, base: number) {
  const nx = b.dims[0];
  const fx = b.f[0];
  for (let oi = 0; oi < b.row.length; oi++) {
    const i0 = oi * fx;
    const i1 = Math.min(nx, i0 + fx);
    let sum = 0;
    for (let i = i0; i < i1; i++) sum += b.src[base + i];
    b.row[oi] += sum;
    b.hits[oi] += i1 - i0;
  }
}

/**
 * Média de blocos (fx × fy × fz) de um volume escalar. Devolve os valores no
 * mesmo tipo da entrada. `pause` é chamado entre fatias para a página não
 * congelar; se devolver false, a redução é abandonada (null).
 */
export async function reduceScalars(
  src: TypedArray,
  dims: ArrayLike<number>,
  f: Factors,
  pause?: () => Promise<boolean>
): Promise<{ data: TypedArray; dims: Factors } | null> {
  const size: [number, number, number] = [dims[0], dims[1], dims[2]];
  const out: Factors = [
    Math.ceil(size[0] / f[0]),
    Math.ceil(size[1] / f[1]),
    Math.ceil(size[2] / f[2]),
  ];
  const Ctor = src.constructor as new (n: number) => TypedArray;
  const data = new Ctor(out[0] * out[1] * out[2]);
  const integer = !(src instanceof Float32Array || src instanceof Float64Array);
  const acc: Block = {
    src,
    dims: size,
    f,
    row: new Float64Array(out[0]),
    hits: new Uint32Array(out[0]),
  };
  let lastPause = Date.now();

  for (let ok = 0; ok < out[2]; ok++) {
    for (let oj = 0; oj < out[1]; oj++) {
      accumulateRow(acc, oj, ok);
      const off = out[0] * (oj + out[1] * ok);
      for (let oi = 0; oi < out[0]; oi++) {
        const mean = acc.row[oi] / acc.hits[oi];
        data[off + oi] = integer ? Math.round(mean) : mean;
      }
    }
    const due = pause && Date.now() - lastPause > 30;
    if (due && !(await pause!())) return null;
    if (due) lastPause = Date.now();
  }
  return { data, dims: out };
}

/**
 * Cópia reduzida de um volume para a vista 3D, na mesma posição do espaço
 * (origem deslocada para o centro do primeiro bloco, espaçamento multiplicado).
 */
export async function reduceImage(
  image: vtkImageData,
  f: Factors,
  pause?: () => Promise<boolean>
): Promise<vtkImageData | null> {
  const scalars = image.getPointData().getScalars();
  if (!scalars || scalars.getNumberOfComponents() !== 1) return null;
  const reduced = await reduceScalars(
    scalars.getData() as TypedArray,
    image.getDimensions(),
    f,
    pause
  );
  if (!reduced) return null;

  const spacing = image.getSpacing();
  const out = vtkImageData.newInstance();
  out.setDimensions(reduced.dims);
  out.setSpacing([spacing[0] * f[0], spacing[1] * f[1], spacing[2] * f[2]]);
  out.setDirection(image.getDirection());
  out.setOrigin(
    image.indexToWorld([(f[0] - 1) / 2, (f[1] - 1) / 2, (f[2] - 1) / 2]) as [
      number,
      number,
      number,
    ]
  );
  out.getPointData().setScalars(
    vtkDataArray.newInstance({
      name: scalars.getName(),
      numberOfComponents: 1,
      values: reduced.data,
    })
  );
  return out;
}
