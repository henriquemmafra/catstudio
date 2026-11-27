/**
 * CatStudio — tirar o granulado do 3D.
 *
 * O "granulado" é o ruído da TC: voxels de um tecido homogêneo variam dezenas
 * de UH, e onde a curva de opacidade sobe (pulmão, gordura) eles acendem e
 * apagam um a um. Uma suavização leve (média ponderada 1-2-1 nos três eixos)
 * reduz o ruído a cerca de um quarto e quase não mexe nas bordas. Vale só para
 * o 3D: as vistas 2D e o exame não mudam.
 */
import { reactive, watch } from 'vue';
import type { TypedArray } from '@kitware/vtk.js/types';
import type { Dims } from './mask';

const STORAGE_KEY = 'catstudio.3d.suavizar';

function stored(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== '0';
  } catch {
    return true;
  }
}

/** Ligado por padrão: o granulado sempre polui. */
export const smoothing = reactive({ enabled: stored() });

watch(
  () => smoothing.enabled,
  (on) => {
    try {
      localStorage.setItem(STORAGE_KEY, on ? '1' : '0');
    } catch {
      // vale só nesta aba
    }
  }
);

/** Suaviza uma linha (de `count` valores, passo `stride`) no lugar. */
function smoothLine(data: TypedArray, line: Float32Array, at: number[]) {
  const [start, count, stride, round] = at;
  for (let n = 0; n < count; n++) line[n] = data[start + n * stride];
  for (let n = 0; n < count; n++) {
    const before = line[n > 0 ? n - 1 : n];
    const after = line[n < count - 1 ? n + 1 : n];
    const value = 0.25 * before + 0.5 * line[n] + 0.25 * after;
    data[start + n * stride] = round ? Math.round(value) : value;
  }
}

/** Suavização 1-2-1 nos três eixos, no lugar. */
export function smooth3(data: TypedArray, dims: Dims) {
  const [nx, ny, nz] = dims;
  const slice = nx * ny;
  const round =
    data instanceof Float32Array || data instanceof Float64Array ? 0 : 1;
  const line = new Float32Array(Math.max(nx, ny, nz));
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      smoothLine(data, line, [nx * j + slice * k, nx, 1, round]);
  for (let k = 0; k < nz; k++)
    for (let i = 0; i < nx; i++)
      smoothLine(data, line, [i + slice * k, ny, nx, round]);
  if (nz > 2)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++)
        smoothLine(data, line, [i + nx * j, nz, slice, round]);
}
