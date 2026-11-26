/**
 * CatStudio — diretor de arte: o volume do exame visto no espaço do paciente
 * (LPS, em mm: x cresce para a esquerda do paciente, y para trás, z para
 * cima). Tudo o que o diretor calcula passa por aqui, então a orientação da
 * aquisição (decúbito, gantry inclinado, série coronal) não muda o resultado.
 */
export type Vec3 = [number, number, number];

export interface WorldVolume {
  data: ArrayLike<number>;
  dims: Vec3;
  /** posição do voxel (0, 0, 0) */
  origin: Vec3;
  /** vetores, em mm, de um voxel para o vizinho em i, j e k */
  axes: [Vec3, Vec3, Vec3];
  /** inversa de `axes`: leva (mundo − origem) ao índice contínuo */
  inverse: number[];
  /** menor espaçamento entre voxels, em mm */
  minSpacing: number;
}

/** Valor devolvido fora do volume (ar). */
export const OUTSIDE = -1024;

interface IndexToWorld {
  indexToWorld(index: Vec3): ArrayLike<number>;
}

const sub = (a: ArrayLike<number>, b: ArrayLike<number>): Vec3 => [
  a[0] - b[0],
  a[1] - b[1],
  a[2] - b[2],
];

/** Inversa da matriz cujas colunas são a, b e c (em linha: 9 números). */
function invertColumns(a: Vec3, b: Vec3, c: Vec3): number[] {
  const det =
    a[0] * (b[1] * c[2] - c[1] * b[2]) -
    b[0] * (a[1] * c[2] - c[1] * a[2]) +
    c[0] * (a[1] * b[2] - b[1] * a[2]);
  if (!det) throw new Error('Geometria do volume degenerada');
  const d = 1 / det;
  return [
    (b[1] * c[2] - c[1] * b[2]) * d,
    (c[0] * b[2] - b[0] * c[2]) * d,
    (b[0] * c[1] - c[0] * b[1]) * d,
    (c[1] * a[2] - a[1] * c[2]) * d,
    (a[0] * c[2] - c[0] * a[2]) * d,
    (c[0] * a[1] - a[0] * c[1]) * d,
    (a[1] * b[2] - b[1] * a[2]) * d,
    (b[0] * a[2] - a[0] * b[2]) * d,
    (a[0] * b[1] - b[0] * a[1]) * d,
  ];
}

export function makeVolume(
  data: ArrayLike<number>,
  dims: Vec3,
  origin: Vec3,
  axes: [Vec3, Vec3, Vec3]
): WorldVolume {
  return {
    data,
    dims,
    origin,
    axes,
    inverse: invertColumns(axes[0], axes[1], axes[2]),
    minSpacing: Math.min(...axes.map((a) => Math.hypot(a[0], a[1], a[2]))),
  };
}

/** Monta o volume a partir de uma imagem do vtk.js (ou de algo equivalente). */
export function volumeFromImage(
  image: IndexToWorld,
  data: ArrayLike<number>,
  dims: Vec3
): WorldVolume {
  const origin = sub(image.indexToWorld([0, 0, 0]), [0, 0, 0]);
  const axis = (index: Vec3) => sub(image.indexToWorld(index), origin);
  return makeVolume(data, dims, origin, [
    axis([1, 0, 0]),
    axis([0, 1, 0]),
    axis([0, 0, 1]),
  ]);
}

/** Os oito cantos do volume, no espaço do paciente. */
export function corners(vol: WorldVolume): Vec3[] {
  const out: Vec3[] = [];
  for (let c = 0; c < 8; c++) {
    const idx = [0, 1, 2].map((a) => ((c >> a) & 1 ? vol.dims[a] - 1 : 0));
    out.push([
      vol.origin[0] +
        idx[0] * vol.axes[0][0] +
        idx[1] * vol.axes[1][0] +
        idx[2] * vol.axes[2][0],
      vol.origin[1] +
        idx[0] * vol.axes[0][1] +
        idx[1] * vol.axes[1][1] +
        idx[2] * vol.axes[2][1],
      vol.origin[2] +
        idx[0] * vol.axes[0][2] +
        idx[1] * vol.axes[1][2] +
        idx[2] * vol.axes[2][2],
    ]);
  }
  return out;
}

/** Caixa do volume alinhada ao paciente: [mínimo, máximo] em x, y e z. */
export function bounds(vol: WorldVolume): [Vec3, Vec3] {
  const pts = corners(vol);
  const pick = (fn: (...v: number[]) => number) =>
    [0, 1, 2].map((a) => fn(...pts.map((p) => p[a]))) as Vec3;
  return [pick(Math.min), pick(Math.max)];
}

// índice contínuo do último ponto consultado, e a célula que o contém
const index = new Float64Array(3);
const cell = new Int32Array(3);
const frac = new Float64Array(3);

function toIndex(vol: WorldVolume, x: number, y: number, z: number) {
  const m = vol.inverse;
  const dx = x - vol.origin[0];
  const dy = y - vol.origin[1];
  const dz = z - vol.origin[2];
  index[0] = m[0] * dx + m[1] * dy + m[2] * dz;
  index[1] = m[3] * dx + m[4] * dy + m[5] * dz;
  index[2] = m[6] * dx + m[7] * dy + m[8] * dz;
}

/** Voxel de baixo e fração até o seguinte, num eixo; falso se estiver fora. */
function locate(axis: number, count: number): boolean {
  const f = index[axis];
  if (f < -0.5 || f > count - 0.5) return false;
  const clamped = Math.min(count - 1, Math.max(0, f));
  const low = Math.max(0, Math.min(count - 2, Math.floor(clamped)));
  cell[axis] = low;
  frac[axis] = count > 1 ? clamped - low : 0;
  return true;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Valor no ponto (mm), com interpolação trilinear. Fora do volume: ar. */
export function sample(vol: WorldVolume, x: number, y: number, z: number) {
  const [ni, nj, nk] = vol.dims;
  toIndex(vol, x, y, z);
  if (!locate(0, ni) || !locate(1, nj) || !locate(2, nk)) return OUTSIDE;
  const si = ni > 1 ? 1 : 0;
  const sj = nj > 1 ? ni : 0;
  const sk = nk > 1 ? ni * nj : 0;
  const o = cell[0] + ni * (cell[1] + nj * cell[2]);
  const d = vol.data;
  const row = (at: number) => lerp(d[at], d[at + si], frac[0]);
  const low = lerp(row(o), row(o + sj), frac[1]);
  const high = lerp(row(o + sk), row(o + sk + sj), frac[1]);
  return lerp(low, high, frac[2]);
}

/** Valor do voxel mais próximo (mais rápido; para as grades grosseiras). */
export function sampleNearest(
  vol: WorldVolume,
  x: number,
  y: number,
  z: number
) {
  toIndex(vol, x, y, z);
  const i = Math.round(index[0]);
  const j = Math.round(index[1]);
  const k = Math.round(index[2]);
  const [ni, nj, nk] = vol.dims;
  const inside = Math.min(i, j, k) >= 0 && i < ni && j < nj && k < nk;
  return inside ? vol.data[i + ni * (j + nj * k)] : OUTSIDE;
}
