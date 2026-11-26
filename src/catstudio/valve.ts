/**
 * CatStudio — modo Valvas (parte pura, sem Vue nem DOM).
 *
 * A partir de três pontos marcados no anel, recorta um cubo pequeno em volta
 * da valva (no sistema do anel: x e y no plano, z ao longo do eixo) e extrai
 * dele a superfície entre o sangue contrastado e o tecido. Cada ponto da
 * superfície é classificado como parede, folheto (estrutura fina, com sangue
 * dos dois lados) ou cálcio. É isso que o holograma e a reconstrução 3D
 * desenham; nada vem de modelo pronto, só dos voxels do exame.
 *
 * Coordenadas "mm" aqui são índice × espaçamento do volume (a orientação do
 * paciente não importa para a extração).
 */

export type Vec3 = [number, number, number];

export type ValveKey = 'aortica' | 'mitral' | 'tricuspide' | 'pulmonar';

export const VALVES: Record<
  ValveKey,
  { name: string; radius: number; below: number; above: number; hint: string }
> = {
  aortica: {
    name: 'Aórtica',
    radius: 20,
    below: 8,
    above: 22,
    hint: 'Marque o ponto mais baixo de cada uma das três cúspides.',
  },
  mitral: {
    name: 'Mitral',
    radius: 26,
    below: 22,
    above: 10,
    hint: 'Marque três pontos do anel mitral (anterior, posterior e lateral).',
  },
  tricuspide: {
    name: 'Tricúspide',
    radius: 28,
    below: 22,
    above: 10,
    hint: 'Marque três pontos do anel tricúspide. Precisa de contraste nas câmaras direitas.',
  },
  pulmonar: {
    name: 'Pulmonar',
    radius: 18,
    below: 8,
    above: 20,
    hint: 'Marque três pontos na base das cúspides pulmonares. Precisa de contraste no tronco pulmonar.',
  },
};

export interface Volume {
  data: ArrayLike<number>;
  dims: Vec3;
  spacing: Vec3;
}

export interface Plane {
  center: Vec3;
  u: Vec3;
  v: Vec3;
  n: Vec3;
}

/** Cubo no sistema do anel. Origem no centro do anel, no meio do cubo. */
export interface Cube {
  data: Int16Array;
  size: number;
  depth: number;
  step: number;
}

export const POINT_STRIDE = 7;
export const KIND = { wall: 0, leaflet: 1, calcium: 2 } as const;

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Plano por três pontos; centro no baricentro. Null se estão alinhados. */
export function planeFromPoints(a: Vec3, b: Vec3, c: Vec3): Plane | null {
  const raw = cross(sub(b, a), sub(c, a));
  if (Math.hypot(raw[0], raw[1], raw[2]) < 1e-3) return null;
  const n = norm(raw);
  const u = norm(sub(b, a));
  return {
    center: [
      (a[0] + b[0] + c[0]) / 3,
      (a[1] + b[1] + c[1]) / 3,
      (a[2] + b[2] + c[2]) / 3,
    ],
    u,
    v: cross(n, u),
    n,
  };
}

/** Amostra trilinear em mm (índice × espaçamento). Fora do volume: ar. */
export function sampleVolume(vol: Volume, p: Vec3): number {
  const [nx, ny, nz] = vol.dims;
  const x = p[0] / vol.spacing[0];
  const y = p[1] / vol.spacing[1];
  const z = p[2] / vol.spacing[2];
  const i = Math.floor(x);
  const j = Math.floor(y);
  const k = Math.floor(z);
  const inside = i >= 0 && j >= 0 && k >= 0;
  if (!inside || i >= nx - 1 || j >= ny - 1 || k >= nz - 1) return -1000;
  const fx = x - i;
  const fy = y - j;
  const fz = z - k;
  const d = vol.data;
  const o = i + nx * (j + ny * k);
  const row = (q: number) => d[q] + (d[q + 1] - d[q]) * fx;
  const face = (q: number) => row(q) + (row(q + nx) - row(q)) * fy;
  const lo = face(o);
  return lo + (face(o + nx * ny) - lo) * fz;
}

export const CUBE_HALF = 38;
export const CUBE_HALF_DEPTH = 32;
export const CUBE_STEP = 0.6;

/** Reamostra o cubo em volta do anel (76 × 76 × 64 mm, voxel de 0,6 mm). */
export function sampleCube(vol: Volume, plane: Plane): Cube {
  const step = CUBE_STEP;
  const size = Math.round((2 * CUBE_HALF) / step);
  const depth = Math.round((2 * CUBE_HALF_DEPTH) / step);
  const data = new Int16Array(size * size * depth);
  const { center: c, u, v, n } = plane;
  for (let k = 0; k < depth; k++) {
    const z = (k + 0.5) * step - CUBE_HALF_DEPTH;
    for (let j = 0; j < size; j++) {
      const y = (j + 0.5) * step - CUBE_HALF;
      const bx = c[0] + v[0] * y + n[0] * z;
      const by = c[1] + v[1] * y + n[1] * z;
      const bz = c[2] + v[2] * y + n[2] * z;
      const o = size * (j + size * k);
      for (let i = 0; i < size; i++) {
        const x = (i + 0.5) * step - CUBE_HALF;
        data[o + i] = sampleVolume(vol, [
          bx + u[0] * x,
          by + u[1] * x,
          bz + u[2] * x,
        ]);
      }
    }
  }
  return { data, size, depth, step };
}

/** Densidade típica do sangue contrastado perto do anel (mediana > 150 UH). */
export function bloodLevel(cube: Cube): number | null {
  const { data, size, depth, step } = cube;
  const r = Math.round(12 / step);
  const c = size / 2;
  const kc = depth / 2;
  const vals: number[] = [];
  const side = Math.floor(r);
  const total = side * side * side;
  for (let q = 0; q < total; q++) {
    const i = Math.round(c - r) + 2 * (q % side);
    const j = Math.round(c - r) + 2 * (Math.floor(q / side) % side);
    const k = Math.round(kc - r) + 2 * Math.floor(q / (side * side));
    const h = data[i + size * (j + size * k)];
    if (h > 150 && h < 1200) vals.push(h);
  }
  if (vals.length < 50) return null;
  vals.sort((a, b) => a - b);
  return vals[Math.floor(vals.length / 2)];
}

export interface ExtractOptions {
  radius: number;
  /** Faixa ao longo do eixo, em mm a partir do plano do anel. */
  from: number;
  to: number;
  /** Limiar sangue × tecido (UH). */
  threshold: number;
  /** Acima disto é cálcio (UH). */
  calcium: number;
}

export function defaultThresholds(blood: number) {
  return {
    threshold: Math.round((blood + 60) / 2),
    calcium: Math.round(Math.max(blood + 280, 650)),
  };
}

const NEIGHBORS: Vec3[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

interface Ctx {
  cube: Cube;
  opt: ExtractOptions;
  at: (i: number, j: number, k: number) => number;
}

function gradient(ctx: Ctx, i: number, j: number, k: number): Vec3 {
  const { at } = ctx;
  return norm([
    at(i + 1, j, k) - at(i - 1, j, k),
    at(i, j + 1, k) - at(i, j - 1, k),
    at(i, j, k + 1) - at(i, j, k - 1),
  ]);
}

/** Folheto = tecido fino: andando para longe do sangue, o sangue volta em < 3,6 mm. */
function isThin(ctx: Ctx, p: Vec3, g: Vec3): boolean {
  const steps = Math.round(3.6 / ctx.cube.step);
  for (let s = 2; s <= steps; s++) {
    const h = ctx.at(
      Math.round(p[0] - g[0] * s),
      Math.round(p[1] - g[1] * s),
      Math.round(p[2] - g[2] * s)
    );
    if (h >= ctx.opt.threshold) return true;
  }
  return false;
}

/** -1 = não é superfície; senão, o tipo do ponto. */
function classify(ctx: Ctx, i: number, j: number, k: number): number {
  const h = ctx.at(i, j, k);
  const { threshold, calcium } = ctx.opt;
  const near = (test: (x: number) => boolean) =>
    NEIGHBORS.some((d) => test(ctx.at(i + d[0], j + d[1], k + d[2])));
  if (h >= calcium) return near((x) => x < calcium) ? KIND.calcium : -1;
  if (h >= threshold || h < -200) return -1;
  if (!near((x) => x >= threshold)) return -1;
  return isThin(ctx, [i, j, k], gradient(ctx, i, j, k))
    ? KIND.leaflet
    : KIND.wall;
}

/**
 * Pontos da superfície dentro do cilindro: [x, y, z, nx, ny, nz, tipo] em mm
 * no sistema do anel (z = eixo da valva).
 */
export function extractSurface(cube: Cube, opt: ExtractOptions): Float32Array {
  const { data, size, depth, step } = cube;
  const at = (i: number, j: number, k: number) => {
    const out = i < 0 || j < 0 || k < 0 || i >= size || j >= size;
    return out || k >= depth ? -1000 : data[i + size * (j + size * k)];
  };
  const ctx: Ctx = { cube, opt, at };
  const out: number[] = [];
  const half = (size * step) / 2;
  const halfDepth = (depth * step) / 2;
  const k0 = Math.max(1, Math.floor((opt.from + halfDepth) / step));
  const k1 = Math.min(depth - 1, Math.ceil((opt.to + halfDepth) / step));
  const visit = (i: number, j: number, k: number) => {
    const x = (i + 0.5) * step - half;
    const y = (j + 0.5) * step - half;
    if (x * x + y * y > opt.radius * opt.radius) return;
    const kind = classify(ctx, i, j, k);
    if (kind < 0) return;
    const g = gradient(ctx, i, j, k);
    out.push(x, y, (k + 0.5) * step - halfDepth, g[0], g[1], g[2], kind);
  };
  for (let k = k0; k < k1; k++)
    for (let j = 1; j < size - 1; j++)
      for (let i = 1; i < size - 1; i++) visit(i, j, k);
  return Float32Array.from(out);
}
