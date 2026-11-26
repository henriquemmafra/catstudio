/**
 * CatStudio — diretor de arte: referências anatômicas estimadas no próprio
 * navegador, sem segmentação por IA.
 *
 * O que dá para achar com segurança numa TC só pela densidade são os pulmões
 * (ar dentro do corpo). Deles saem a linha média, a largura de cada
 * hemitórax, o ápice e a base. As linhas de superfície (hemiclavicular,
 * paraesternal) são ESTIMADAS a partir dessas medidas, por proporção
 * anatômica média; não são a clavícula medida. Por isso todo corte mostra o
 * localizador com a linha desenhada, para conferir e corrigir.
 */
import { dilate, erode } from '@/src/catstudio/sculpt/body';
import {
  bounds,
  sampleNearest,
  type Vec3,
  type WorldVolume,
} from '@/src/catstudio/director/volume';

/** Passo máximo da grade grosseira, em mm (adulto). */
export const COARSE_STEP = 4;
/** Passo mínimo: num lactente a parede torácica tem poucos milímetros. */
const FINEST_STEP = 1.5;
/** A grade grosseira não passa deste número de voxels. */
const MAX_COARSE_VOXELS = 4e6;

/**
 * Passo da grade conforme o tamanho do exame: fino o bastante para a parede
 * do tórax de uma criança pequena não "vazar" (um buraco na grade ligaria o
 * pulmão ao ar de fora), sem passar do limite de voxels.
 */
export function coarseStepFor(vol: WorldVolume): number {
  const [min, max] = bounds(vol);
  const size = [0, 1, 2].map((a) => max[a] - min[a]);
  const byWidth = Math.min(size[0], size[1]) / 110;
  const byCount = Math.cbrt((size[0] * size[1] * size[2]) / MAX_COARSE_VOXELS);
  return Math.max(
    byCount,
    Math.min(COARSE_STEP, Math.max(FINEST_STEP, byWidth))
  );
}

/**
 * Onde fica a linha hemiclavicular, como fração da distância entre a linha
 * média e a borda lateral do pulmão. A clavícula adulta vai de ~2 cm da linha
 * média até ~15 cm (projeção frontal); o ponto médio fica a ~8,5–9 cm, e a
 * borda lateral do pulmão a ~13 cm: razão ≈ 0,65.
 */
export const HEMICLAVICULAR_RATIO = 0.65;
/** A linha paraesternal passa a ~2,5 cm da linha média. */
export const PARASTERNAL_MM = 25;

export interface Landmarks {
  /** de onde vieram as medidas: pulmões achados, ou só o contorno do corpo */
  basis: 'pulmoes' | 'corpo';
  /** caixa do corpo (pele), [mínimo, máximo] em x, y, z */
  body: [Vec3, Vec3];
  /** x da linha média */
  midlineX: number;
  /** distância (mm) da linha média à borda lateral, de cada lado */
  halfWidthLeft: number;
  halfWidthRight: number;
  /** plano coronal médio do tórax (linha axilar média), em y */
  midCoronalY: number;
  /** z do ápice e da base dos pulmões (sem pulmões: topo e fundo do corpo) */
  apexZ: number;
  baseZ: number;
  /** centro do tórax (ou do corpo), para os localizadores */
  center: Vec3;
  /** avisos para mostrar ao usuário */
  notes: string[];
}

interface Grid {
  n: Vec3;
  min: Vec3;
  step: number;
  hu: Int16Array;
}

function coarseGrid(vol: WorldVolume, step: number): Grid {
  const [min, max] = bounds(vol);
  const n = [0, 1, 2].map((a) =>
    Math.max(1, Math.floor((max[a] - min[a]) / step) + 1)
  ) as Vec3;
  const hu = new Int16Array(n[0] * n[1] * n[2]);
  let o = 0;
  for (let k = 0; k < n[2]; k++)
    for (let j = 0; j < n[1]; j++)
      for (let i = 0; i < n[0]; i++) {
        hu[o] = sampleNearest(
          vol,
          min[0] + i * step,
          min[1] + j * step,
          min[2] + k * step
        );
        o += 1;
      }
  return { n, min, step, hu };
}

const AIR = -400;

/**
 * Marca o ar de fora do corpo: em cada corte axial, o ar ligado à borda do
 * corte. O que sobra de ar é interno (pulmão, via aérea, gás intestinal).
 */
function outsideAir({ n, hu }: Grid): Uint8Array {
  const [nx, ny, nz] = n;
  const out = new Uint8Array(hu.length);
  const stack = new Int32Array(nx * ny);
  for (let k = 0; k < nz; k++) {
    const base = k * nx * ny;
    let top = 0;
    const push = (i: number, j: number) => {
      const o = base + i + nx * j;
      if (out[o] || hu[o] >= AIR) return;
      out[o] = 1;
      stack[top] = i + nx * j;
      top += 1;
    };
    for (let i = 0; i < nx; i++) {
      push(i, 0);
      push(i, ny - 1);
    }
    for (let j = 0; j < ny; j++) {
      push(0, j);
      push(nx - 1, j);
    }
    while (top) {
      top -= 1;
      const p = stack[top];
      const i = p % nx;
      const j = (p - i) / nx;
      if (i > 0) push(i - 1, j);
      if (i < nx - 1) push(i + 1, j);
      if (j > 0) push(i, j - 1);
      if (j < ny - 1) push(i, j + 1);
    }
  }
  return out;
}

/**
 * Componentes conexos (6 vizinhos) dos voxels que passam em `wanted`; devolve
 * o rótulo de cada voxel (0 = fora) e o tamanho de cada componente.
 */
function components(grid: Grid, wanted: (o: number) => boolean) {
  const [nx, ny, nz] = grid.n;
  const slice = nx * ny;
  const labels = new Int32Array(grid.hu.length);
  const sizes: number[] = [0];
  const stack = new Int32Array(grid.hu.length);
  let top = 0;
  const visit = (q: number, label: number) => {
    if (labels[q] || !wanted(q)) return;
    labels[q] = label;
    stack[top] = q;
    top += 1;
  };
  const spread = (o: number, label: number) => {
    const i = o % nx;
    const j = Math.floor(o / nx) % ny;
    const k = Math.floor(o / slice);
    if (i > 0) visit(o - 1, label);
    if (i < nx - 1) visit(o + 1, label);
    if (j > 0) visit(o - nx, label);
    if (j < ny - 1) visit(o + nx, label);
    if (k > 0) visit(o - slice, label);
    if (k < nz - 1) visit(o + slice, label);
  };
  for (let seed = 0; seed < labels.length; seed++) {
    const label = sizes.length;
    visit(seed, label);
    let size = 0;
    while (top) {
      top -= 1;
      size += 1;
      spread(stack[top], label);
    }
    if (size) sizes.push(size);
  }
  return { labels, sizes };
}

/** Rótulo do maior componente (0 se não houver nenhum). */
const largestLabel = (sizes: number[]) =>
  sizes.reduce((best, size, label) => (size > sizes[best] ? label : best), 0);

const percentile = (sorted: number[], p: number) =>
  sorted.length
    ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]
    : 0;

/**
 * Estatística das coordenadas dos voxels escolhidos. `tail` é a fração
 * desprezada em cada ponta (ruído, um voxel solto).
 */
function extent(grid: Grid, keep: (o: number) => boolean, tail = 0.01) {
  const [nx, ny] = grid.n;
  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  for (let o = 0; o < grid.hu.length; o++) {
    if (!keep(o)) continue;
    const i = o % nx;
    const j = Math.floor(o / nx) % ny;
    const k = Math.floor(o / (nx * ny));
    xs.push(grid.min[0] + i * grid.step);
    ys.push(grid.min[1] + j * grid.step);
    zs.push(grid.min[2] + k * grid.step);
  }
  [xs, ys, zs].forEach((list) => list.sort((a, b) => a - b));
  const range = (list: number[]) =>
    [percentile(list, tail), percentile(list, 1 - tail)] as [number, number];
  const mean = (list: number[]) =>
    list.reduce((sum, v) => sum + v, 0) / (list.length || 1);
  return {
    count: xs.length,
    x: range(xs),
    y: range(ys),
    z: range(zs),
    mean: [mean(xs), mean(ys), mean(zs)] as Vec3,
  };
}

/**
 * Quais voxels da grade são pulmão: os dois pulmões costumam ser os dois
 * maiores bolsões de ar interno (ou um só, quando a traqueia os une nesta
 * resolução); gás intestinal é bem menor.
 */
function lungPredicate(grid: Grid, outside: Uint8Array, bodyCount: number) {
  const { labels, sizes } = components(
    grid,
    (o) => !outside[o] && grid.hu[o] < AIR - 100
  );
  const largest = Math.max(0, ...sizes);
  const lung = sizes.map(
    (size) => size > 0 && size >= 0.25 * largest && size >= 0.005 * bodyCount
  );
  return (o: number) => lung[labels[o]];
}

export interface LungMask {
  n: Vec3;
  min: Vec3;
  step: number;
  /** 1 = pulmão (com os vasos de dentro e a pleura) */
  mask: Uint8Array;
}

/**
 * Região dos pulmões, para a reconstrução 3D mostrar só eles. Os vasos e
 * brônquios de dentro do pulmão são buracos no ar: um fechamento (engorda e
 * emagrece duas camadas) os devolve. A parede do tórax fica de fora.
 */
export function findLungMask(vol: WorldVolume, step = coarseStepFor(vol)) {
  const grid = coarseGrid(vol, step);
  const outside = outsideAir(grid);
  const tissue = components(grid, (o) => !outside[o] && grid.hu[o] > -300);
  const patient = largestLabel(tissue.sizes);
  const bodyCount = patient ? tissue.sizes[patient] : 0;
  const isLung = lungPredicate(grid, outside, bodyCount);
  let mask: Uint8Array = new Uint8Array(grid.hu.length);
  for (let o = 0; o < mask.length; o++) mask[o] = isLung(o) ? 1 : 0;
  mask = dilate(dilate(mask, grid.n), grid.n);
  mask = erode(erode(mask, grid.n), grid.n);
  return { n: grid.n, min: grid.min, step, mask } as LungMask;
}

const maskAt = (lungs: LungMask, i: number, j: number, k: number) => {
  const [nx, ny, nz] = lungs.n;
  if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) return 0;
  return lungs.mask[i + nx * (j + ny * k)];
};

/**
 * Quanto o ponto (mm) está dentro da região dos pulmões, de 0 a 1,
 * interpolado entre as células da grade: a borda sai lisa, não em degraus.
 */
export function lungWeight(lungs: LungMask, x: number, y: number, z: number) {
  const fx = (x - lungs.min[0]) / lungs.step;
  const fy = (y - lungs.min[1]) / lungs.step;
  const fz = (z - lungs.min[2]) / lungs.step;
  const i = Math.floor(fx);
  const j = Math.floor(fy);
  const k = Math.floor(fz);
  const [a, b, c] = [fx - i, fy - j, fz - k];
  let sum = 0;
  for (let n = 0; n < 8; n++) {
    const di = n & 1;
    const dj = (n >> 1) & 1;
    const dk = (n >> 2) & 1;
    const w = (di ? a : 1 - a) * (dj ? b : 1 - b) * (dk ? c : 1 - c);
    sum += w * maskAt(lungs, i + di, j + dj, k + dk);
  }
  return sum;
}

/** O ponto (mm) cai dentro da região dos pulmões? */
export const inLungs = (lungs: LungMask, x: number, y: number, z: number) =>
  lungWeight(lungs, x, y, z) >= 0.5;

/**
 * Fração mínima do corpo ocupada por ar interno para ser tratada como pulmão.
 * É proporção, não litros: vale do lactente ao adulto (num tórax, os pulmões
 * passam de 10% do volume; gás intestinal num abdome fica bem abaixo de 3%).
 */
const MIN_LUNG_FRACTION = 0.03;

export function findLandmarks(
  vol: WorldVolume,
  step = coarseStepFor(vol)
): Landmarks {
  const grid = coarseGrid(vol, step);
  const outside = outsideAir(grid);
  const notes: string[] = [];

  // o corpo é o maior bloco de tecido; a mesa e os suportes, quando não
  // encostam no paciente, ficam de fora
  const tissue = components(grid, (o) => !outside[o] && grid.hu[o] > -300);
  const patient = largestLabel(tissue.sizes);
  const isBody = (o: number) => patient > 0 && tissue.labels[o] === patient;
  const bodyStat = extent(grid, isBody, 0.001);
  const body: [Vec3, Vec3] = [
    [bodyStat.x[0], bodyStat.y[0], bodyStat.z[0]],
    [bodyStat.x[1], bodyStat.y[1], bodyStat.z[1]],
  ];

  const isLung = lungPredicate(grid, outside, bodyStat.count);
  const lungStat = extent(grid, isLung, 0.002);

  if (lungStat.count < MIN_LUNG_FRACTION * bodyStat.count) {
    notes.push(
      'Não achei os pulmões neste exame: as linhas foram estimadas só pelo contorno do corpo e são menos confiáveis.'
    );
    const midlineX = (bodyStat.x[0] + bodyStat.x[1]) / 2;
    return {
      basis: 'corpo',
      body,
      midlineX,
      // sem pulmões, a largura útil é a do corpo menos a parede (~15%)
      halfWidthLeft: 0.85 * (bodyStat.x[1] - midlineX),
      halfWidthRight: 0.85 * (midlineX - bodyStat.x[0]),
      midCoronalY: (bodyStat.y[0] + bodyStat.y[1]) / 2,
      apexZ: bodyStat.z[1],
      baseZ: bodyStat.z[0],
      center: bodyStat.mean,
      notes,
    };
  }

  // linha média: meio do contorno do corpo na altura dos pulmões. Não depende
  // do que há dentro (um pulmão colapsado ou com derrame deslocaria o centro
  // dos pulmões e o centro de massa). Só conta o que está à frente do limite
  // posterior dos pulmões: a mesa do tomógrafo fica atrás das costas e, se
  // entrasse, puxaria a linha média para o centro da mesa.
  const [nx, ny] = grid.n;
  const yOf = (o: number) =>
    grid.min[1] + (Math.floor(o / nx) % ny) * grid.step;
  const zOf = (o: number) =>
    grid.min[2] + Math.floor(o / (nx * ny)) * grid.step;
  const chest = extent(
    grid,
    (o) =>
      isBody(o) &&
      yOf(o) <= lungStat.y[1] &&
      zOf(o) >= lungStat.z[0] &&
      zOf(o) <= lungStat.z[1],
    0.002
  );
  const midlineX = (chest.x[0] + chest.x[1]) / 2;
  let left = lungStat.x[1] - midlineX;
  let right = midlineX - lungStat.x[0];
  if (Math.min(left, right) < 0.6 * Math.max(left, right)) {
    notes.push(
      'Os pulmões estão assimétricos; usei o lado maior como referência para os dois.'
    );
    left = Math.max(left, right);
    right = left;
  }

  const [min, max] = bounds(vol);
  if (lungStat.z[1] > max[2] - 2 * step)
    notes.push('O exame não inclui o ápice pulmonar.');
  if (lungStat.z[0] < min[2] + 2 * step)
    notes.push('O exame não inclui as bases pulmonares.');

  return {
    basis: 'pulmoes',
    body,
    midlineX,
    halfWidthLeft: left,
    halfWidthRight: right,
    midCoronalY: (lungStat.y[0] + lungStat.y[1]) / 2,
    apexZ: lungStat.z[1],
    baseZ: lungStat.z[0],
    center: [midlineX, lungStat.mean[1], lungStat.mean[2]],
    notes,
  };
}
