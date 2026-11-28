/**
 * CatStudio — volume de cavidade (VE, VD): a partir de um ponto dentro do
 * sangue contrastado, cresce por tudo o que está ligado e acima do limiar,
 * sem atravessar os planos-limite (plano valvar, via de saída). As contas,
 * sem tela nem vtk.
 */
export type Vec3 = [number, number, number];

/**
 * Plano em coordenadas de voxel: a·i + b·j + c·k + d. O lado do ponto de
 * partida é o que vale.
 */
export type Wall = [number, number, number, number];

export interface CavityInput {
  dims: Vec3;
  scalars: ArrayLike<number>;
  /** voxel de partida */
  seed: Vec3;
  /** limiar (UH): entra o que está neste valor ou acima */
  low: number;
  walls: Wall[];
  /** para de crescer aqui (vazou) */
  maxVoxels: number;
}

export interface CavityResult {
  voxels: number;
  /** bateu no teto: o crescimento vazou para fora da cavidade */
  leaked: boolean;
}

/** Miocárdio e partes moles ficam abaixo disto mesmo com contraste. */
export const TISSUE_HU = 100;
/** Abaixo disto no ponto de partida, não há contraste para separar a cavidade. */
export const MIN_BLOOD_HU = 150;

const inside = (dims: Vec3, p: Vec3) =>
  p.every((value, axis) => value >= 0 && value < dims[axis]);

const side = (wall: Wall, i: number, j: number, k: number) =>
  wall[0] * i + wall[1] * j + wall[2] * k + wall[3];

/** Média (UH) da vizinhança 5×5×5 do ponto: a densidade do sangue ali. */
export function bloodAt(
  grid: Pick<CavityInput, 'dims' | 'scalars'>,
  seed: Vec3
): number {
  const { dims, scalars } = grid;
  let sum = 0;
  let count = 0;
  for (let n = 0; n < 125; n++) {
    const p: Vec3 = [
      seed[0] + (n % 5) - 2,
      seed[1] + (Math.floor(n / 5) % 5) - 2,
      seed[2] + Math.floor(n / 25) - 2,
    ];
    if (!inside(dims, p)) continue;
    sum += scalars[p[0] + dims[0] * (p[1] + dims[1] * p[2])];
    count += 1;
  }
  return count ? sum / count : -1000;
}

/** Limiar sugerido: a meio caminho entre o sangue e o miocárdio. */
export const suggestLow = (blood: number) =>
  Math.round((blood + TISSUE_HU) / 2);

/** Os planos, virados para o lado do ponto de partida ficar positivo. */
function facing(walls: Wall[], seed: Vec3): Wall[] {
  return walls.map((wall) => {
    const sign = side(wall, seed[0], seed[1], seed[2]) < 0 ? -1 : 1;
    return wall.map((value) => value * sign) as Wall;
  });
}

/** Fila de voxels que cresce quando enche. */
class Queue {
  data = new Int32Array(1 << 16);

  length = 0;

  push(index: number) {
    if (this.length === this.data.length) {
      const bigger = new Int32Array(this.data.length * 2);
      bigger.set(this.data);
      this.data = bigger;
    }
    this.data[this.length] = index;
    this.length += 1;
  }
}

/**
 * Cresce a cavidade e escreve `label` em `out` (que tem um byte por voxel;
 * o que já tem outro rótulo não é tomado).
 */
export function growCavity(
  input: CavityInput,
  out: Uint8Array,
  label: number
): CavityResult {
  const { dims, scalars, seed, low, maxVoxels } = input;
  const [nx, ny, nz] = dims;
  if (!inside(dims, seed)) return { voxels: 0, leaked: false };
  const walls = facing(input.walls, seed);
  const open = (i: number, j: number, k: number) => {
    const index = i + nx * (j + ny * k);
    if (out[index] || scalars[index] < low) return -1;
    return walls.every((wall) => side(wall, i, j, k) >= 0) ? index : -1;
  };
  const queue = new Queue();
  const visit = (i: number, j: number, k: number) => {
    if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) return;
    const index = open(i, j, k);
    if (index < 0) return;
    out[index] = label;
    queue.push(index);
  };
  visit(seed[0], seed[1], seed[2]);
  for (let head = 0; head < queue.length && queue.length < maxVoxels; head++) {
    const index = queue.data[head];
    const i = index % nx;
    const j = Math.floor(index / nx) % ny;
    const k = Math.floor(index / (nx * ny));
    visit(i - 1, j, k);
    visit(i + 1, j, k);
    visit(i, j - 1, k);
    visit(i, j + 1, k);
    visit(i, j, k - 1);
    visit(i, j, k + 1);
  }
  return { voxels: queue.length, leaked: queue.length >= maxVoxels };
}

/**
 * Plano-limite a partir de uma régua desenhada num corte: contém a linha da
 * régua e a direção em que se olha o corte. `toWorld` é a matriz 4×4
 * (por colunas) de voxel para mm.
 */
export function wallFromLine(
  line: { first: Vec3; second: Vec3; viewNormal: Vec3 },
  toWorld: ArrayLike<number>
): Wall | null {
  const along = line.second.map((v, axis) => v - line.first[axis]);
  const [ax, ay, az] = along;
  const [vx, vy, vz] = line.viewNormal;
  const n: Vec3 = [ay * vz - az * vy, az * vx - ax * vz, ax * vy - ay * vx];
  const length = Math.hypot(n[0], n[1], n[2]);
  if (length < 1e-6) return null;
  const dot = (offset: number) =>
    (n[0] * toWorld[offset] +
      n[1] * toWorld[offset + 1] +
      n[2] * toWorld[offset + 2]) /
    length;
  const origin =
    (n[0] * line.first[0] + n[1] * line.first[1] + n[2] * line.first[2]) /
    length;
  return [dot(0), dot(4), dot(8), dot(12) - origin];
}

/** Superfície corpórea (m²), Mosteller; 0 se faltar altura ou peso. */
export function bodySurface(heightCm: number, weightKg: number): number {
  if (!(heightCm > 0) || !(weightKg > 0)) return 0;
  return Math.sqrt((heightCm * weightKg) / 3600);
}
