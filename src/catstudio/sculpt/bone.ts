/**
 * CatStudio — escultura do 3D: detectar osso.
 *
 * Heurística, não segmentação de verdade. Junta os voxels densos em
 * estruturas ligadas e chama de osso as que são heterogêneas: cortical muito
 * densa junto com medular menos densa. Um vaso contrastado é denso mas
 * homogêneo, então fica de fora — a não ser que encoste no osso, caso em que
 * os dois formam uma estrutura só. Por isso existe o clique para corrigir.
 *
 * Dois reforços:
 *  - com os pulmões achados (`zone`), o que é denso na parede do tórax é
 *    osso mesmo sem cara de osso: costela fina, em volume reduzido, não tem
 *    cortical densa o bastante para passar no teste acima;
 *  - uma estrutura reprovada (coluna encostada na aorta contrastada, por
 *    exemplo) é afinada uma camada para desfazer o contato, e cada pedaço é
 *    avaliado de novo.
 */
import { type Fill, type Grid, flood, newFill } from './mask';
import { dilateWithin, erode } from './body';

/** Rótulos: 0 = não é osso, 1 = osso, 2 = franja (borda de volume parcial) */
export type BoneLabel = Uint8Array;

export interface BoneOptions {
  /** a partir de que valor um voxel conta como denso (HU) */
  low: number;
  /** estruturas menores que isto não são avaliadas (calcificações, clipes) */
  minVoxels: number;
  /** zona do voxel no tórax: 1 = parede (ver chest.ts); sem isto, não usa */
  zone?: (index: number) => number;
}

/** a partir desta fração de voxels na parede, a estrutura inteira é osso */
export const WALL_SHARE = 0.6;
const WALL = 1;

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

/** Quantos voxels da estrutura na fila estão na parede do tórax. */
function wallCount(fill: Fill, count: number, zone: BoneOptions['zone']) {
  if (!zone) return 0;
  let wall = 0;
  for (let n = 0; n < count; n++)
    if (zone(fill.queue.data[n]) === WALL) wall += 1;
  return wall;
}

/** Marca como osso só os voxels da estrutura que estão na parede. */
function labelWall(fill: Fill, count: number, pass: Pass): number {
  const { zone } = pass.options;
  if (!zone) return 0;
  let marked = 0;
  for (let n = 0; n < count; n++) {
    const index = fill.queue.data[n];
    if (zone(index) !== WALL) continue;
    pass.result.label[index] = 1;
    marked += 1;
  }
  return marked;
}

/** pedaço homogêneo a partir deste tamanho (× minVoxels) é vaso, não medular */
const SOFT_PIECE = 30;

interface Pass {
  options: BoneOptions;
  result: BoneResult;
  /** a que estrutura densa avaliada cada voxel pertence (0 = nenhuma) */
  owner: Int32Array;
  /** por estrutura: tem cara de osso? */
  boneLike: boolean[];
  /** por estrutura: algum pedaço dela, afinada, tem cara de osso? */
  hasHard: boolean[];
}

/** Avalia a estrutura que está na fila de `fill`. */
function judge(fill: Fill, count: number, pass: Pass) {
  const { options, result } = pass;
  const wall = wallCount(fill, count, options.zone);
  const mostlyWall = wall >= WALL_SHARE * count;
  // na parede, pedaços pequenos também contam (costela fragmentada)
  if (count < (mostlyWall ? options.minVoxels / 8 : options.minVoxels)) return;
  if (mostlyWall) {
    setLabel(fill, count, result.label, 1);
    result.components += 1;
    return;
  }
  labelWall(fill, count, pass);
  const id = pass.boneLike.length;
  for (let n = 0; n < count; n++) pass.owner[fill.queue.data[n]] = id;
  pass.boneLike.push(looksLikeBone(fill, count, options.low));
  pass.hasHard.push(false);
  if (pass.boneLike[id]) result.components += 1;
}

/**
 * Confere as estruturas densas por dentro: tira uma camada (desfaz os
 * contatos finos, como o da coluna com a aorta contrastada) e avalia cada
 * pedaço. Devolve os pedaços com cara de osso e os homogêneos grandes
 * (vasos), já com a camada de volta.
 */
function pieces(grid: Grid, pass: Pass) {
  const { options, owner } = pass;
  const dense = new Uint8Array(owner.length);
  for (let index = 0; index < dense.length; index++)
    dense[index] = owner[index] ? 1 : 0;
  const thin = erode(dense, grid.dims);
  const fill = newFill({ ...grid, scalars: thin }, 1);
  // a cara de osso é medida na densidade de verdade
  const real = { ...fill, grid };
  let hard: Uint8Array = new Uint8Array(dense.length);
  let soft: Uint8Array = new Uint8Array(dense.length);
  for (let index = 0; index < thin.length; index++) {
    const count = flood(fill, index);
    if (count < options.minVoxels / 2) continue;
    const isBone = looksLikeBone(real, count, options.low);
    if (isBone) pass.hasHard[owner[index]] = true;
    else if (count < SOFT_PIECE * options.minVoxels) continue;
    setLabel(fill, count, isBone ? hard : soft, 1);
  }
  for (let layer = 0; layer < 2; layer++) {
    hard = dilateWithin(hard, dense, grid.dims);
    soft = dilateWithin(soft, dense, grid.dims);
  }
  return { hard, soft };
}

/**
 * Osso = os pedaços duros, mais as estruturas com cara de osso, menos os
 * pedaços de vaso de uma estrutura que também tem pedaço duro (se nenhum
 * pedaço é duro, a estrutura fica como foi avaliada inteira).
 */
function settle(grid: Grid, pass: Pass) {
  const { label } = pass.result;
  const { hard, soft } = pieces(grid, pass);
  let voxels = 0;
  for (let index = 0; index < label.length; index++) {
    const id = pass.owner[index];
    const vessel = soft[index] && pass.hasHard[id];
    if (hard[index] || (pass.boneLike[id] && !vessel)) label[index] = 1;
    voxels += label[index];
  }
  pass.result.voxels = voxels;
}

export function detectBone(grid: Grid, options: BoneOptions): BoneResult {
  const fill = newFill(grid, options.low);
  const pass: Pass = {
    options,
    result: {
      label: new Uint8Array(grid.hidden.length),
      components: 0,
      voxels: 0,
    },
    owner: new Int32Array(grid.hidden.length),
    // a estrutura 0 é "nenhuma"
    boneLike: [false],
    hasHard: [false],
  };
  for (let index = 0; index < grid.hidden.length; index++) {
    const count = flood(fill, index);
    if (count) judge(fill, count, pass);
  }
  settle(grid, pass);
  refringe(grid, pass.result.label, options.low);
  return pass.result;
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
