/**
 * CatStudio — modo Valvas (parte pura, sem Vue nem DOM).
 *
 * A partir de três pontos marcados no anel, recorta um cubo pequeno em volta
 * da valva (no sistema do anel: x e y no plano, z ao longo do eixo) e extrai
 * dele a superfície entre o sangue contrastado e o tecido, como malha de
 * triângulos com posição subvoxel (a superfície passa onde a densidade cruza
 * o limiar, não no centro do voxel). Cada vértice é classificado como parede,
 * folheto (estrutura fina, com sangue dos dois lados) ou cálcio. É isso que
 * o holograma e a reconstrução 3D desenham; nada vem de modelo pronto, só
 * dos voxels do exame.
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
export const CUBE_STEP = 0.5;

/** Reamostra o cubo em volta do anel (76 × 76 × 64 mm, voxel de 0,5 mm). */
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

export interface ValveMesh {
  /** x, y, z em mm no sistema do anel (z = eixo da valva). */
  positions: Float32Array;
  /** Normal unitária, apontando para o sangue. */
  normals: Float32Array;
  kinds: Uint8Array;
  /** Três índices por triângulo. */
  indices: Uint32Array;
}

/**
 * Campo usado para a superfície: a própria densidade, mas com o cálcio
 * "dobrado" para baixo do limiar — senão ele se confundiria com o sangue
 * (os dois são mais densos que o tecido) e sumiria da superfície.
 */
function foldedField(cube: Cube, calcium: number): Float32Array {
  const out = new Float32Array(cube.data.length);
  for (let i = 0; i < out.length; i++) {
    const h = cube.data[i];
    out[i] = h <= calcium ? h : calcium - (h - calcium) * 8;
  }
  return out;
}

/** Suavização binomial (1-2-1) nos três eixos: só para as normais. */
function blurred(field: Float32Array, size: number, depth: number) {
  const strides = [1, size, size * size];
  const lengths = [size, size, depth];
  let src = field;
  for (let axis = 0; axis < 3; axis++) {
    const dst = new Float32Array(src.length);
    const st = strides[axis];
    const len = lengths[axis];
    for (let o = 0; o < src.length; o++) {
      const pos = Math.floor(o / st) % len;
      const lo = pos > 0 ? src[o - st] : src[o];
      const hi = pos < len - 1 ? src[o + st] : src[o];
      dst[o] = 0.25 * lo + 0.5 * src[o] + 0.25 * hi;
    }
    src = dst;
  }
  return src;
}

/** Amostra trilinear de um campo do cubo, em coordenadas de voxel. */
function sampleField(
  field: Float32Array,
  size: number,
  depth: number,
  x: number,
  y: number,
  z: number
): number {
  const cx = Math.max(0, Math.min(size - 1.001, x));
  const cy = Math.max(0, Math.min(size - 1.001, y));
  const cz = Math.max(0, Math.min(depth - 1.001, z));
  const i = Math.floor(cx);
  const j = Math.floor(cy);
  const k = Math.floor(cz);
  const fx = cx - i;
  const fy = cy - j;
  const fz = cz - k;
  const o = i + size * (j + size * k);
  const row = (q: number) => field[q] + (field[q + 1] - field[q]) * fx;
  const face = (q: number) => row(q) + (row(q + size) - row(q)) * fy;
  const lo = face(o);
  return lo + (face(o + size * size) - lo) * fz;
}

// cantos de uma célula e as 12 arestas entre eles
const CORNERS: Vec3[] = [
  [0, 0, 0],
  [1, 0, 0],
  [0, 1, 0],
  [1, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [0, 1, 1],
  [1, 1, 1],
];
const EDGES: Array<[number, number]> = [
  [0, 1],
  [2, 3],
  [4, 5],
  [6, 7],
  [0, 2],
  [1, 3],
  [4, 6],
  [5, 7],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7],
];

/**
 * Superfície sangue × tecido dentro do cilindro, por "surface nets": um
 * vértice por célula cortada pela superfície, na média dos pontos em que as
 * arestas cruzam o limiar, e um quadrilátero por aresta cortada.
 */
export function extractSurface(cube: Cube, opt: ExtractOptions): ValveMesh {
  const { size, depth, step } = cube;
  const field = foldedField(cube, opt.calcium);
  const smooth = blurred(field, size, depth);
  const T = opt.threshold;
  const half = (size * step) / 2;
  const halfDepth = (depth * step) / 2;
  const k0 = Math.max(1, Math.floor((opt.from + halfDepth) / step));
  const k1 = Math.min(depth - 2, Math.ceil((opt.to + halfDepth) / step));
  const sxy = size * size;
  const vertexOf = new Int32Array(size * size * depth).fill(-1);
  const pos: number[] = [];
  const nor: number[] = [];
  const kind: number[] = [];
  const value = new Float32Array(8);
  const thinSteps = Math.round(3.6 / step);
  const reach = Math.round(1 / step);

  for (let k = k0; k < k1; k++)
    for (let j = 1; j < size - 2; j++)
      for (let i = 1; i < size - 2; i++) {
        const o = i + size * (j + size * k);
        let bits = 0;
        let top = -Infinity;
        for (let c = 0; c < 8; c++) {
          const q =
            o + CORNERS[c][0] + size * CORNERS[c][1] + sxy * CORNERS[c][2];
          value[c] = field[q];
          if (value[c] >= T) bits |= 1 << c;
          if (cube.data[q] > top) top = cube.data[q];
        }
        if (bits === 0 || bits === 255) continue;
        const x = (i + 1) * step - half;
        const y = (j + 1) * step - half;
        if (x * x + y * y > opt.radius * opt.radius) continue;
        let px = 0;
        let py = 0;
        let pz = 0;
        let n = 0;
        for (const [a, b] of EDGES) {
          if (((bits >> a) & 1) === ((bits >> b) & 1)) continue;
          const t = (T - value[a]) / (value[b] - value[a]);
          px += CORNERS[a][0] + (CORNERS[b][0] - CORNERS[a][0]) * t;
          py += CORNERS[a][1] + (CORNERS[b][1] - CORNERS[a][1]) * t;
          pz += CORNERS[a][2] + (CORNERS[b][2] - CORNERS[a][2]) * t;
          n += 1;
        }
        const vx = i + px / n;
        const vy = j + py / n;
        const vz = k + pz / n;
        // normal = gradiente do campo suavizado (aponta para o sangue)
        const at = (dx: number, dy: number, dz: number) =>
          sampleField(smooth, size, depth, vx + dx, vy + dy, vz + dz);
        const g = norm([
          at(1, 0, 0) - at(-1, 0, 0),
          at(0, 1, 0) - at(0, -1, 0),
          at(0, 0, 1) - at(0, 0, -1),
        ]);
        // folheto = tecido fino: indo para longe do sangue, ele volta em < 3,6 mm
        // cálcio: algum voxel calcificado a até 1 mm (a borda do cálcio, por
        // volume parcial, tem densidade de sangue e não pode virar "folheto")
        let dense = top;
        for (let dk = -reach; dk <= reach + 1 && dense < opt.calcium; dk++)
          for (let dj = -reach; dj <= reach + 1 && dense < opt.calcium; dj++)
            for (let di = -reach; di <= reach + 1; di++) {
              const q = o + di + size * dj + sxy * dk;
              if (q >= 0 && q < cube.data.length && cube.data[q] > dense)
                dense = cube.data[q];
            }
        let type: number = dense >= opt.calcium ? KIND.calcium : KIND.wall;
        if (type === KIND.wall)
          for (let sIdx = 2; sIdx <= thinSteps; sIdx++) {
            const h = sampleField(
              field,
              size,
              depth,
              vx - g[0] * sIdx,
              vy - g[1] * sIdx,
              vz - g[2] * sIdx
            );
            if (h >= T) {
              type = KIND.leaflet;
              break;
            }
          }
        vertexOf[o] = kind.length;
        pos.push(
          (vx + 0.5) * step - half,
          (vy + 0.5) * step - half,
          (vz + 0.5) * step - halfDepth
        );
        nor.push(g[0], g[1], g[2]);
        kind.push(type);
      }

  // um quadrilátero (dois triângulos) por aresta cortada, ligando as quatro
  // células que a compartilham
  const idx: number[] = [];
  const quad = (a: number, b: number, c: number, d: number) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    idx.push(a, b, c, a, c, d);
  };
  for (let k = k0; k < k1; k++)
    for (let j = 1; j < size - 2; j++)
      for (let i = 1; i < size - 2; i++) {
        const o = i + size * (j + size * k);
        const here = field[o] >= T;
        if (here !== field[o + 1] >= T)
          quad(
            vertexOf[o],
            vertexOf[o - size],
            vertexOf[o - size - sxy],
            vertexOf[o - sxy]
          );
        if (here !== field[o + size] >= T)
          quad(
            vertexOf[o],
            vertexOf[o - 1],
            vertexOf[o - 1 - sxy],
            vertexOf[o - sxy]
          );
        if (here !== field[o + sxy] >= T)
          quad(
            vertexOf[o],
            vertexOf[o - 1],
            vertexOf[o - 1 - size],
            vertexOf[o - size]
          );
      }

  // parede × folheto por maioria entre vizinhos (tira o salpicado do ruído)
  const kinds = Uint8Array.from(kind);
  const votes = new Int16Array(kinds.length);
  for (let t = 0; t < idx.length; t += 3)
    for (let a = 0; a < 3; a++)
      for (let b = 0; b < 3; b++)
        votes[idx[t + a]] += kinds[idx[t + b]] === KIND.leaflet ? 1 : -1;
  for (let v = 0; v < kinds.length; v++)
    if (kinds[v] !== KIND.calcium)
      kinds[v] = votes[v] > 0 ? KIND.leaflet : KIND.wall;

  return {
    positions: Float32Array.from(pos),
    normals: Float32Array.from(nor),
    kinds,
    indices: Uint32Array.from(idx),
  };
}
