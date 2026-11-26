/**
 * CatStudio — escultura do 3D: operações puras sobre a máscara de voxels
 * escondidos.
 *
 * A escultura não altera o exame. Ela mantém uma máscara (1 = escondido) do
 * tamanho do volume que a vista 3D desenha; a vista troca os voxels escondidos
 * por ar. Aqui ficam só as contas, sem vtk nem tela, para poderem ser
 * testadas.
 */
export type Dims = [number, number, number];
export type Vec3 = [number, number, number];

export interface Grid {
  dims: Dims;
  scalars: ArrayLike<number>;
  /** 1 = voxel escondido */
  hidden: Uint8Array;
}

export const voxelCount = (dims: Dims) => dims[0] * dims[1] * dims[2];

// ---------- desfazer: a máscara guardada em bits (8× menor) ----------

export function packMask(hidden: Uint8Array): Uint8Array {
  const out = new Uint8Array(Math.ceil(hidden.length / 8));
  for (let i = 0; i < hidden.length; i++)
    if (hidden[i]) out[i >> 3] |= 1 << (i & 7);
  return out;
}

export function unpackMask(packed: Uint8Array, hidden: Uint8Array) {
  for (let i = 0; i < hidden.length; i++)
    hidden[i] = (packed[i >> 3] >> (i & 7)) & 1;
}

// ---------- laço ----------

export interface Shape {
  size: number;
  /** size × size, linha 0 = base da tela (y para cima) */
  bits: Uint8Array;
}

export type Point = [number, number];

function crossings(points: Point[], y: number): number[] {
  const xs: number[] = [];
  for (let a = 0; a < points.length; a++) {
    const [x0, y0] = points[a];
    const [x1, y1] = points[(a + 1) % points.length];
    if (y0 <= y !== y1 <= y) xs.push(x0 + ((y - y0) / (y1 - y0)) * (x1 - x0));
  }
  return xs.sort((p, q) => p - q);
}

/**
 * Preenche um polígono (regra par-ímpar). Pontos em coordenadas normalizadas
 * da vista: x de 0 (esquerda) a 1, y de 0 (base) a 1.
 */
export function rasterPolygon(points: Point[], size = 512): Shape {
  const bits = new Uint8Array(size * size);
  if (points.length < 3) return { size, bits };
  for (let row = 0; row < size; row++) {
    const xs = crossings(points, (row + 0.5) / size);
    for (let c = 0; c + 1 < xs.length; c += 2) {
      const from = Math.max(0, Math.ceil(xs[c] * size - 0.5));
      const to = Math.min(size - 1, Math.floor(xs[c + 1] * size - 0.5));
      if (to >= from) bits.fill(1, row * size + from, row * size + to + 1);
    }
  }
  return { size, bits };
}

function insideShape(shape: Shape, x: number, y: number, w: number) {
  if (w <= 0) return false;
  const u = (x / w) * 0.5 + 0.5;
  const v = (y / w) * 0.5 + 0.5;
  if (u < 0 || u >= 1 || v < 0 || v >= 1) return false;
  const { size } = shape;
  return shape.bits[Math.floor(v * size) * size + Math.floor(u * size)] === 1;
}

export interface Lasso {
  /** índice do voxel → coordenadas de recorte (mat4 do gl-matrix, por coluna) */
  toClip: ArrayLike<number>;
  shape: Shape;
  /** true: sobra só o que está dentro do laço; false: apaga o que está dentro */
  keepInside: boolean;
}

/**
 * Esconde os voxels que caem dentro (ou fora) do laço, em toda a profundidade
 * da vista. Devolve quantos voxels foram escondidos.
 */
export function lassoCut(grid: Grid, lasso: Lasso): number {
  const [nx, ny, nz] = grid.dims;
  const m = lasso.toClip;
  let changed = 0;
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++) {
      const row = nx * (j + ny * k);
      const x0 = m[4] * j + m[8] * k + m[12];
      const y0 = m[5] * j + m[9] * k + m[13];
      const w0 = m[7] * j + m[11] * k + m[15];
      changed += cutRow(grid, lasso, [row, x0, y0, w0]);
    }
  return changed;
}

function cutRow(grid: Grid, lasso: Lasso, start: number[]): number {
  const [row, x0, y0, w0] = start;
  const m = lasso.toClip;
  const { hidden } = grid;
  let changed = 0;
  for (let i = 0; i < grid.dims[0]; i++) {
    if (hidden[row + i]) continue;
    const inside = insideShape(
      lasso.shape,
      x0 + m[0] * i,
      y0 + m[1] * i,
      w0 + m[3] * i
    );
    if (inside !== lasso.keepInside) {
      hidden[row + i] = 1;
      changed += 1;
    }
  }
  return changed;
}

// ---------- borracha ----------

export interface Ball {
  /** índice do voxel no centro */
  center: number;
  /** raio em voxels, por eixo (o voxel pode não ser cúbico) */
  radius: Vec3;
}

function hideBallRow(grid: Grid, ball: Ball, at: number[]): number {
  const [j, k, reach] = at;
  const [nx, ny] = grid.dims;
  const ci = ball.center % nx;
  const half = Math.floor(ball.radius[0] * Math.sqrt(reach));
  const row = nx * (j + ny * k);
  let changed = 0;
  for (let i = Math.max(0, ci - half); i <= Math.min(nx - 1, ci + half); i++) {
    changed += 1 - grid.hidden[row + i];
    grid.hidden[row + i] = 1;
  }
  return changed;
}

/** Esconde uma bola de voxels. Devolve quantos estavam visíveis. */
export function hideBall(grid: Grid, ball: Ball): number {
  const [nx, ny, nz] = grid.dims;
  const cj = Math.floor(ball.center / nx) % ny;
  const ck = Math.floor(ball.center / (nx * ny));
  const [, rj, rk] = ball.radius.map((r) => Math.max(r, 0.5));
  let changed = 0;
  for (
    let k = Math.max(0, Math.ceil(ck - rk));
    k <= Math.min(nz - 1, ck + rk);
    k++
  )
    for (
      let j = Math.max(0, Math.ceil(cj - rj));
      j <= Math.min(ny - 1, cj + rj);
      j++
    ) {
      const reach = 1 - ((j - cj) / rj) ** 2 - ((k - ck) / rk) ** 2;
      if (reach >= 0) changed += hideBallRow(grid, ball, [j, k, reach]);
    }
  return changed;
}

// ---------- estruturas ligadas ----------

/** Fila que cresce; depois de `flood`, guarda os voxels da estrutura. */
export interface Queue {
  data: Uint32Array;
  length: number;
}

export const newQueue = (): Queue => ({
  data: new Uint32Array(1 << 16),
  length: 0,
});

function push(queue: Queue, value: number) {
  if (queue.length === queue.data.length) {
    const bigger = new Uint32Array(queue.data.length * 2);
    bigger.set(queue.data);
    queue.data = bigger;
  }
  queue.data[queue.length] = value;
  queue.length += 1;
}

export interface Fill {
  grid: Grid;
  threshold: number;
  visited: Uint8Array;
  queue: Queue;
  /** voxels por onde a estrutura não passa (em geral, os escondidos) */
  blocked: Uint8Array;
}

function visit(fill: Fill, index: number) {
  const { grid, visited } = fill;
  if (visited[index] || fill.blocked[index]) return;
  if (grid.scalars[index] < fill.threshold) return;
  visited[index] = 1;
  push(fill.queue, index);
}

export function visitNeighbours(fill: Fill, index: number) {
  const [nx, ny, nz] = fill.grid.dims;
  const slice = nx * ny;
  const i = index % nx;
  const j = Math.floor(index / nx) % ny;
  const k = Math.floor(index / slice);
  if (i > 0) visit(fill, index - 1);
  if (i < nx - 1) visit(fill, index + 1);
  if (j > 0) visit(fill, index - nx);
  if (j < ny - 1) visit(fill, index + nx);
  if (k > 0) visit(fill, index - slice);
  if (k < nz - 1) visit(fill, index + slice);
}

/**
 * Enche `fill.queue` com a estrutura ligada (6 vizinhos) que contém `seed`:
 * voxels visíveis com valor ≥ limiar. Devolve o tamanho em voxels.
 */
export function flood(fill: Fill, seed: number): number {
  fill.queue.length = 0;
  visit(fill, seed);
  for (let head = 0; head < fill.queue.length; head++)
    visitNeighbours(fill, fill.queue.data[head]);
  return fill.queue.length;
}

export const newFill = (grid: Grid, threshold: number): Fill => ({
  grid,
  threshold,
  visited: new Uint8Array(grid.hidden.length),
  queue: newQueue(),
  blocked: grid.hidden,
});

/** Semeia a fila sem enchê-la (para crescer aos poucos). */
export function seedFill(fill: Fill, seed: number): number {
  fill.queue.length = 0;
  visit(fill, seed);
  return fill.queue.length;
}

/** Esconde a estrutura ligada ao voxel `seed`. Devolve o tamanho dela. */
export function removeStructure(
  grid: Grid,
  seed: number,
  threshold: number
): number {
  const fill = newFill(grid, threshold);
  const count = flood(fill, seed);
  for (let n = 0; n < count; n++) grid.hidden[fill.queue.data[n]] = 1;
  return count;
}

/**
 * Deixa visível só a estrutura ligada ao voxel `seed`. Devolve o tamanho
 * dela; zero se o voxel não pertence a estrutura nenhuma (nada muda).
 */
export function keepStructure(
  grid: Grid,
  seed: number,
  threshold: number
): number {
  const fill = newFill(grid, threshold);
  const count = flood(fill, seed);
  if (!count) return 0;
  grid.hidden.fill(1);
  for (let n = 0; n < count; n++) grid.hidden[fill.queue.data[n]] = 0;
  return count;
}

export interface FragmentResult {
  /** estruturas escondidas */
  removed: number;
  /** estruturas que ficaram */
  kept: number;
  voxels: number;
}

/**
 * Esconde toda estrutura solta menor que `minVoxels` (a "poeira": pedaços de
 * mesa, calcificações soltas, ruído).
 */
export function removeFragments(
  grid: Grid,
  threshold: number,
  minVoxels: number
): FragmentResult {
  const fill = newFill(grid, threshold);
  const result: FragmentResult = { removed: 0, kept: 0, voxels: 0 };
  for (let index = 0; index < grid.hidden.length; index++) {
    const count = flood(fill, index);
    if (count >= minVoxels) result.kept += 1;
    else if (count) {
      for (let n = 0; n < count; n++) grid.hidden[fill.queue.data[n]] = 1;
      result.removed += 1;
      result.voxels += count;
    }
  }
  return result;
}

// ---------- clique: achar o que está sob o cursor ----------

export interface Ray {
  /** em coordenadas de índice do volume */
  from: Vec3;
  to: Vec3;
  threshold: number;
  /** recusa voxels invisíveis por outro motivo (fora da caixa de corte) */
  accept?: (i: number, j: number, k: number) => boolean;
}

function voxelAt(grid: Grid, ray: Ray, t: number): number {
  const [nx, ny, nz] = grid.dims;
  const i = Math.round(ray.from[0] + (ray.to[0] - ray.from[0]) * t);
  const j = Math.round(ray.from[1] + (ray.to[1] - ray.from[1]) * t);
  const k = Math.round(ray.from[2] + (ray.to[2] - ray.from[2]) * t);
  if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) return -1;
  if (ray.accept && !ray.accept(i, j, k)) return -1;
  return i + nx * (j + ny * k);
}

/**
 * Primeiro voxel visível com valor ≥ limiar ao longo do raio, ou -1.
 */
export function firstHit(grid: Grid, ray: Ray): number {
  const length = Math.hypot(
    ray.to[0] - ray.from[0],
    ray.to[1] - ray.from[1],
    ray.to[2] - ray.from[2]
  );
  const steps = Math.max(1, Math.ceil(length * 2));
  for (let s = 0; s <= steps; s++) {
    const index = voxelAt(grid, ray, s / steps);
    if (index < 0 || grid.hidden[index]) continue;
    if (grid.scalars[index] >= ray.threshold) return index;
  }
  return -1;
}

/**
 * Valor a partir do qual o preset começa a mostrar alguma coisa: o menor
 * ponto da curva de opacidade acima de 10% do pico. `table` é a curva
 * amostrada de `range[0]` a `range[1]`.
 */
export function visibleThreshold(
  table: ArrayLike<number>,
  range: [number, number]
): number {
  let peak = 0;
  for (let n = 0; n < table.length; n++) peak = Math.max(peak, table[n]);
  if (peak <= 0) return range[0];
  for (let n = 0; n < table.length; n++)
    if (table[n] >= peak * 0.1)
      return range[0] + (n / (table.length - 1)) * (range[1] - range[0]);
  return range[0];
}
