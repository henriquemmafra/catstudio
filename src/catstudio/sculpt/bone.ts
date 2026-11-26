/**
 * CatStudio — escultura do 3D: detectar osso.
 *
 * Heurística, não segmentação de verdade. Junta os voxels densos em
 * estruturas ligadas e chama de osso as que são heterogêneas: cortical muito
 * densa junto com medular menos densa. Um vaso contrastado é denso mas
 * homogêneo, então fica de fora — a não ser que encoste no osso, caso em que
 * os dois formam uma estrutura só. Por isso existe o clique para corrigir.
 */
import { type Fill, type Grid, flood, newFill } from './mask';

/** Rótulos: 0 = não é osso, 1 = osso, 2 = franja (borda de volume parcial) */
export type BoneLabel = Uint8Array;

export interface BoneOptions {
  /** a partir de que valor um voxel conta como denso (HU) */
  low: number;
  /** estruturas menores que isto não são avaliadas (calcificações, clipes) */
  minVoxels: number;
}

export const BONE_LOW = 200;
/** percentil 95 pelo menos este tanto acima do limiar… */
export const BONE_PEAK = 300;
/** …e pelo menos esta distância entre os percentis 25 e 95 */
export const BONE_SPREAD = 250;

const BINS = 64;
const BIN_WIDTH = 25;

function percentile(histogram: Uint32Array, total: number, fraction: number) {
  let seen = 0;
  for (let bin = 0; bin < BINS; bin++) {
    seen += histogram[bin];
    if (seen >= total * fraction) return bin * BIN_WIDTH;
  }
  return BINS * BIN_WIDTH;
}

/** A estrutura que está na fila de `fill` tem cara de osso? */
function looksLikeBone(fill: Fill, count: number, low: number): boolean {
  const histogram = new Uint32Array(BINS);
  const { data } = fill.queue;
  for (let n = 0; n < count; n++) {
    const above = (fill.grid.scalars[data[n]] - low) / BIN_WIDTH;
    histogram[Math.min(BINS - 1, Math.max(0, Math.floor(above)))] += 1;
  }
  const p25 = percentile(histogram, count, 0.25);
  const p95 = percentile(histogram, count, 0.95);
  return p95 >= BONE_PEAK && p95 - p25 >= BONE_SPREAD;
}

function setLabel(fill: Fill, count: number, label: BoneLabel, value: number) {
  for (let n = 0; n < count; n++) label[fill.queue.data[n]] = value;
}

/** Os até seis vizinhos de face de um voxel. */
function neighbours(grid: Grid, index: number): number[] {
  const [nx, ny, nz] = grid.dims;
  const slice = nx * ny;
  const i = index % nx;
  const j = Math.floor(index / nx) % ny;
  const k = Math.floor(index / slice);
  const out: number[] = [];
  if (i > 0) out.push(index - 1);
  if (i < nx - 1) out.push(index + 1);
  if (j > 0) out.push(index - nx);
  if (j < ny - 1) out.push(index + nx);
  if (k > 0) out.push(index - slice);
  if (k < nz - 1) out.push(index + slice);
  return out;
}

/** Uma camada de franja: os vizinhos livres e pouco densos do que já é osso. */
function fringePass(grid: Grid, label: BoneLabel, low: number) {
  const found: number[] = [];
  const free = (near: number) =>
    !label[near] && !grid.hidden[near] && grid.scalars[near] < low;
  // parte do osso (poucos voxels), não do volume inteiro
  for (let index = 0; index < label.length; index++)
    if (label[index]) found.push(...neighbours(grid, index).filter(free));
  found.forEach((index) => {
    label[index] = 2;
  });
}

/**
 * Refaz a franja: duas camadas de voxels menos densos em volta do osso (o
 * volume parcial da borda). Sem ela, esconder o osso deixa uma casca.
 */
export function refringe(grid: Grid, label: BoneLabel, low: number) {
  for (let index = 0; index < label.length; index++)
    if (label[index] === 2) label[index] = 0;
  fringePass(grid, label, low);
  fringePass(grid, label, low);
}

export interface BoneResult {
  label: BoneLabel;
  /** estruturas marcadas como osso */
  components: number;
  /** voxels de osso, sem a franja */
  voxels: number;
}

export function detectBone(grid: Grid, options: BoneOptions): BoneResult {
  const fill = newFill(grid, options.low);
  const result: BoneResult = {
    label: new Uint8Array(grid.hidden.length),
    components: 0,
    voxels: 0,
  };
  for (let index = 0; index < grid.hidden.length; index++) {
    const count = flood(fill, index);
    if (count < options.minVoxels) continue;
    if (!looksLikeBone(fill, count, options.low)) continue;
    setLabel(fill, count, result.label, 1);
    result.components += 1;
    result.voxels += count;
  }
  refringe(grid, result.label, options.low);
  return result;
}

/**
 * Correção manual: a estrutura ligada ao voxel `seed` passa a ser osso, ou
 * deixa de ser. Devolve quantos voxels mudaram (positivo: virou osso;
 * negativo: deixou de ser; zero: não havia estrutura ali).
 */
export function toggleBone(
  grid: Grid,
  label: BoneLabel,
  seed: number,
  low: number
): number {
  const fill = newFill(grid, low);
  const count = flood(fill, seed);
  if (!count) return 0;
  const wasBone = label[seed] === 1;
  setLabel(fill, count, label, wasBone ? 0 : 1);
  refringe(grid, label, low);
  return wasBone ? -count : count;
}

export function countBone(label: BoneLabel): number {
  let total = 0;
  for (let index = 0; index < label.length; index++)
    if (label[index] === 1) total += 1;
  return total;
}
