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

/** Bloco de voxels (recorte do cubo em volta da região de interesse). */
interface Grid {
  nx: number;
  ny: number;
  nz: number;
}

/**
 * Campo usado para a superfície: a própria densidade, mas com o cálcio
 * "dobrado" para baixo do limiar — senão ele se confundiria com o sangue
 * (os dois são mais densos que o tecido) e sumiria da superfície.
 */
function foldedField(raw: Float32Array, calcium: number): Float32Array {
  const out = new Float32Array(raw.length);
  for (let i = 0; i < out.length; i++) {
    const h = raw[i];
    out[i] = h <= calcium ? h : calcium - (h - calcium) * 8;
  }
  return out;
}

/** Aplica um filtro 1D (janela de raio r) ao longo de cada eixo, em sequência. */
function separable(
  field: Float32Array,
  g: Grid,
  r: number,
  op: (window: Float32Array, count: number) => number
): Float32Array {
  const strides = [1, g.nx, g.nx * g.ny];
  const lengths = [g.nx, g.ny, g.nz];
  const window = new Float32Array(2 * r + 1);
  let src = field;
  for (let axis = 0; axis < 3; axis++) {
    const dst = new Float32Array(src.length);
    const st = strides[axis];
    const len = lengths[axis];
    for (let o = 0; o < src.length; o++) {
      const pos = Math.floor(o / st) % len;
      let count = 0;
      for (let d = -r; d <= r; d++) {
        const q = Math.max(0, Math.min(len - 1, pos + d));
        window[count++] = src[o + (q - pos) * st];
      }
      dst[o] = op(window, count);
    }
    src = dst;
  }
  return src;
}

const opBlur = (w: Float32Array) => 0.25 * w[0] + 0.5 * w[1] + 0.25 * w[2];
const opMax = (w: Float32Array, n: number) => {
  let m = w[0];
  for (let i = 1; i < n; i++) if (w[i] > m) m = w[i];
  return m;
};
const opMin = (w: Float32Array, n: number) => {
  let m = w[0];
  for (let i = 1; i < n; i++) if (w[i] < m) m = w[i];
  return m;
};

/** Suavização binomial (1-2-1) nos três eixos. */
const blurred = (field: Float32Array, g: Grid) =>
  separable(field, g, 1, opBlur);

/**
 * Realce dos folhetos. Um folheto é mais fino que o voxel: por volume
 * parcial, sua densidade cai só um pouco em relação ao sangue e, onde não
 * chega a cruzar o limiar, a superfície abria um furo que não existe. Aqui
 * se mede essa queda diretamente — quanto o ponto é mais escuro do que o
 * sangue a até 1,5 mm dele (fechamento morfológico menos o campo) — e toda
 * lâmina fina com queda acima do ruído do próprio exame é levada abaixo do
 * limiar. Onde não há queda nenhuma (orifício de verdade), nada muda.
 */
function enhanceLeaflets(
  field: Float32Array,
  g: Grid,
  threshold: number,
  step: number
): Float32Array {
  const smooth = blurred(field, g);
  const r = Math.max(1, Math.round(1.5 / step));
  const closed = separable(separable(smooth, g, r, opMax), g, r, opMin);
  // ruído: a "queda" típica dentro do sangue homogêneo
  const BIN = 2;
  const hist = new Uint32Array(128);
  let total = 0;
  for (let o = 0; o < field.length; o += 3) {
    if (smooth[o] < threshold) continue;
    const dip = closed[o] - smooth[o];
    hist[Math.min(127, Math.floor(dip / BIN))] += 1;
    total += 1;
  }
  let acc = 0;
  let medianDip = 0;
  for (let b = 0; b < 128 && acc < total / 2; b++) {
    acc += hist[b];
    medianDip = (b + 0.5) * BIN;
  }
  const floor = Math.max(18, Math.min(70, 3 * medianDip));
  const out = new Float32Array(field.length);
  const low = threshold - 40;
  for (let o = 0; o < field.length; o++) {
    const h = field[o];
    out[o] = h;
    if (h < threshold || closed[o] < threshold) continue;
    const dip = closed[o] - smooth[o];
    if (dip <= floor) continue;
    const t = Math.min(1, (dip - floor) / floor);
    out[o] = h - (h - low) * t * t * (3 - 2 * t);
  }
  return out;
}

/** Amostra trilinear de um campo, em coordenadas de voxel do bloco. */
function sampleField(
  field: Float32Array,
  g: Grid,
  x: number,
  y: number,
  z: number
): number {
  const cx = Math.max(0, Math.min(g.nx - 1.001, x));
  const cy = Math.max(0, Math.min(g.ny - 1.001, y));
  const cz = Math.max(0, Math.min(g.nz - 1.001, z));
  const i = Math.floor(cx);
  const j = Math.floor(cy);
  const k = Math.floor(cz);
  const fx = cx - i;
  const fy = cy - j;
  const fz = cz - k;
  const o = i + g.nx * (j + g.ny * k);
  const row = (q: number) => field[q] + (field[q + 1] - field[q]) * fx;
  const face = (q: number) => row(q) + (row(q + g.nx) - row(q)) * fy;
  const lo = face(o);
  return lo + (face(o + g.nx * g.ny) - lo) * fz;
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

/** Tira da malha os fragmentos soltos (ruído), menores que `minVertices`. */
function dropFragments(mesh: ValveMesh, minVertices: number): ValveMesh {
  const count = mesh.kinds.length;
  const parent = new Int32Array(count);
  for (let v = 0; v < count; v++) parent[v] = v;
  const find = (v: number) => {
    let root = v;
    while (parent[root] !== root) root = parent[root];
    let at = v;
    while (parent[at] !== root) {
      const next = parent[at];
      parent[at] = root;
      at = next;
    }
    return root;
  };
  const idx = mesh.indices;
  for (let t = 0; t < idx.length; t += 3) {
    const a = find(idx[t]);
    parent[find(idx[t + 1])] = a;
    parent[find(idx[t + 2])] = a;
  }
  const sizes = new Int32Array(count);
  const calcified = new Uint8Array(count);
  for (let v = 0; v < count; v++) {
    const root = find(v);
    sizes[root] += 1;
    if (mesh.kinds[v] === KIND.calcium) calcified[root] = 1;
  }
  // o cálcio fica mesmo pequeno: nódulo solto é achado, não ruído
  const keep = (v: number) => {
    const root = find(v);
    return sizes[root] >= minVertices || calcified[root] === 1;
  };
  const remap = new Int32Array(count).fill(-1);
  let kept = 0;
  for (let v = 0; v < count; v++) if (keep(v)) remap[v] = kept++;
  if (kept === count) return mesh;
  const positions = new Float32Array(kept * 3);
  const normals = new Float32Array(kept * 3);
  const kinds = new Uint8Array(kept);
  for (let v = 0; v < count; v++) {
    const w = remap[v];
    if (w < 0) continue;
    for (let c = 0; c < 3; c++) {
      positions[3 * w + c] = mesh.positions[3 * v + c];
      normals[3 * w + c] = mesh.normals[3 * v + c];
    }
    kinds[w] = mesh.kinds[v];
  }
  const indices: number[] = [];
  for (let t = 0; t < idx.length; t += 3)
    if (remap[idx[t]] >= 0)
      indices.push(remap[idx[t]], remap[idx[t + 1]], remap[idx[t + 2]]);
  return { positions, normals, kinds, indices: Uint32Array.from(indices) };
}

/**
 * Superfície sangue × tecido dentro do cilindro, por "surface nets": um
 * vértice por célula cortada pela superfície, na média dos pontos em que as
 * arestas cruzam o limiar, e um quadrilátero por aresta cortada. Trabalha
 * num recorte do cubo (só a região pedida, com uma margem).
 */
export function extractSurface(cube: Cube, opt: ExtractOptions): ValveMesh {
  const { size, depth, step } = cube;
  const T = opt.threshold;
  const half = (size * step) / 2;
  const halfDepth = (depth * step) / 2;
  const PAD = 6;
  const clampTo = (v: number, hi: number) => Math.max(0, Math.min(hi, v));
  const i0 = clampTo(Math.floor((half - opt.radius) / step) - PAD, size);
  const i1 = clampTo(Math.ceil((half + opt.radius) / step) + PAD, size);
  const z0 = clampTo(Math.floor((opt.from + halfDepth) / step) - PAD, depth);
  const z1 = clampTo(Math.ceil((opt.to + halfDepth) / step) + PAD, depth);
  const g: Grid = { nx: i1 - i0, ny: i1 - i0, nz: z1 - z0 };
  const empty: ValveMesh = {
    positions: new Float32Array(0),
    normals: new Float32Array(0),
    kinds: new Uint8Array(0),
    indices: new Uint32Array(0),
  };
  if (g.nx < 4 || g.nz < 4) return empty;
  const raw = new Float32Array(g.nx * g.ny * g.nz);
  for (let k = 0; k < g.nz; k++)
    for (let j = 0; j < g.ny; j++) {
      const from = i0 + size * (j + i0 + size * (k + z0));
      raw.set(cube.data.subarray(from, from + g.nx), g.nx * (j + g.ny * k));
    }

  const field = enhanceLeaflets(foldedField(raw, opt.calcium), g, T, step);
  const smooth = blurred(field, g);
  const { nx } = g;
  const sxy = g.nx * g.ny;
  // faixa pedida ao longo do eixo, em voxels do recorte
  const k0 = Math.max(1, Math.floor((opt.from + halfDepth) / step) - z0);
  const k1 = Math.min(g.nz - 2, Math.ceil((opt.to + halfDepth) / step) - z0);
  const vertexOf = new Int32Array(raw.length).fill(-1);
  const pos: number[] = [];
  const nor: number[] = [];
  const kind: number[] = [];
  const value = new Float32Array(8);
  const thinSteps = Math.round(3.6 / step);
  const reach = Math.round(1 / step);

  for (let k = k0; k < k1; k++)
    for (let j = 1; j < g.ny - 2; j++)
      for (let i = 1; i < g.nx - 2; i++) {
        const o = i + nx * (j + g.ny * k);
        let bits = 0;
        for (let c = 0; c < 8; c++) {
          value[c] =
            field[o + CORNERS[c][0] + nx * CORNERS[c][1] + sxy * CORNERS[c][2]];
          if (value[c] >= T) bits |= 1 << c;
        }
        if (bits === 0 || bits === 255) continue;
        const x = (i + i0 + 1) * step - half;
        const y = (j + i0 + 1) * step - half;
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
          sampleField(smooth, g, vx + dx, vy + dy, vz + dz);
        const grad = norm([
          at(1, 0, 0) - at(-1, 0, 0),
          at(0, 1, 0) - at(0, -1, 0),
          at(0, 0, 1) - at(0, 0, -1),
        ]);
        // cálcio: algum voxel calcificado a até 1 mm (a borda do cálcio, por
        // volume parcial, tem densidade de sangue e não pode virar "folheto")
        let dense = -Infinity;
        for (let dk = -reach; dk <= reach + 1 && dense < opt.calcium; dk++)
          for (let dj = -reach; dj <= reach + 1 && dense < opt.calcium; dj++)
            for (let di = -reach; di <= reach + 1; di++) {
              const q = o + di + nx * dj + sxy * dk;
              if (q >= 0 && q < raw.length && raw[q] > dense) dense = raw[q];
            }
        let type: number = dense >= opt.calcium ? KIND.calcium : KIND.wall;
        // folheto = tecido fino: indo para longe do sangue, ele volta em < 3,6 mm
        if (type === KIND.wall)
          for (let sIdx = 2; sIdx <= thinSteps; sIdx++) {
            const h = sampleField(
              field,
              g,
              vx - grad[0] * sIdx,
              vy - grad[1] * sIdx,
              vz - grad[2] * sIdx
            );
            if (h >= T) {
              type = KIND.leaflet;
              break;
            }
          }
        vertexOf[o] = kind.length;
        pos.push(
          (vx + i0 + 0.5) * step - half,
          (vy + i0 + 0.5) * step - half,
          (vz + z0 + 0.5) * step - halfDepth
        );
        nor.push(grad[0], grad[1], grad[2]);
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
    for (let j = 1; j < g.ny - 2; j++)
      for (let i = 1; i < g.nx - 2; i++) {
        const o = i + nx * (j + g.ny * k);
        const here = field[o] >= T;
        if (here !== field[o + 1] >= T)
          quad(
            vertexOf[o],
            vertexOf[o - nx],
            vertexOf[o - nx - sxy],
            vertexOf[o - sxy]
          );
        if (here !== field[o + nx] >= T)
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
            vertexOf[o - 1 - nx],
            vertexOf[o - nx]
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

  // fragmentos soltos com menos de ~12 mm² de superfície são ruído
  return dropFragments(
    {
      positions: Float32Array.from(pos),
      normals: Float32Array.from(nor),
      kinds,
      indices: Uint32Array.from(idx),
    },
    Math.round(12 / (step * step))
  );
}
