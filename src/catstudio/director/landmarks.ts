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
import {
  bounds,
  sampleNearest,
  type Vec3,
  type WorldVolume,
} from '@/src/catstudio/director/volume';

/** Passo da grade grosseira, em mm. */
export const COARSE_STEP = 4;

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

/** Componentes conexos (6 vizinhos) do ar interno; devolve o rótulo e o tamanho de cada um. */
function airComponents(grid: Grid, outside: Uint8Array) {
  const [nx, ny, nz] = grid.n;
  const labels = new Int32Array(grid.hu.length);
  const sizes: number[] = [0];
  const stack = new Int32Array(grid.hu.length);
  const isAir = (o: number) =>
    !outside[o] && !labels[o] && grid.hu[o] < AIR - 100;
  for (let seed = 0; seed < labels.length; seed++) {
    if (!isAir(seed)) continue;
    const label = sizes.length;
    let size = 0;
    let top = 0;
    labels[seed] = label;
    stack[top++] = seed;
    while (top) {
      const o = stack[--top];
      size += 1;
      const i = o % nx;
      const j = Math.floor(o / nx) % ny;
      const k = Math.floor(o / (nx * ny));
      const visit = (q: number) => {
        if (isAir(q)) {
          labels[q] = label;
          stack[top++] = q;
        }
      };
      if (i > 0) visit(o - 1);
      if (i < nx - 1) visit(o + 1);
      if (j > 0) visit(o - nx);
      if (j < ny - 1) visit(o + nx);
      if (k > 0) visit(o - nx * ny);
      if (k < nz - 1) visit(o + nx * ny);
    }
    sizes.push(size);
  }
  return { labels, sizes };
}

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

/** Volume mínimo de ar interno, em litros, para ser tratado como pulmão. */
const MIN_LUNG_LITERS = 0.5;

export function findLandmarks(vol: WorldVolume, step = COARSE_STEP): Landmarks {
  const grid = coarseGrid(vol, step);
  const outside = outsideAir(grid);
  const notes: string[] = [];

  const bodyStat = extent(grid, (o) => !outside[o] && grid.hu[o] > -300, 0.001);
  const body: [Vec3, Vec3] = [
    [bodyStat.x[0], bodyStat.y[0], bodyStat.z[0]],
    [bodyStat.x[1], bodyStat.y[1], bodyStat.z[1]],
  ];

  const { labels, sizes } = airComponents(grid, outside);
  const largest = Math.max(0, ...sizes);
  const liters = (voxels: number) => (voxels * step ** 3) / 1e6;
  // os dois pulmões costumam ser os dois maiores bolsões de ar (ou um só,
  // quando a traqueia os une nesta resolução); gás intestinal é bem menor
  const lung = sizes.map(
    (size) => size > 0 && size >= 0.25 * largest && liters(size) >= 0.15
  );
  const lungStat = extent(grid, (o) => lung[labels[o]], 0.002);

  if (liters(lungStat.count) < MIN_LUNG_LITERS) {
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
      !outside[o] &&
      grid.hu[o] > -300 &&
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
