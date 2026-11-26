/**
 * CatStudio — localização automática da valva (parte pura).
 *
 * Sem modelo treinado: usa só a anatomia que a angiotomografia mostra.
 *  1. Volume reduzido (~2 mm) nos eixos do paciente.
 *  2. Aorta ascendente: em cada corte axial, discos de sangue homogêneo e
 *     isolado; os discos empilhados formam tubos, e a ascendente é o tubo
 *     calibroso mais anterior que chega ao topo.
 *  3. Descendo pelo tubo, a área da luz perpendicular ao eixo cresce nos
 *     seios de Valsalva e estreita no anel, antes de abrir no ventrículo.
 *  4. O plano do anel é perpendicular ao eixo da raiz nesse ponto.
 *
 * Só a valva aórtica é localizada sozinha; as outras continuam por três
 * pontos (orientPlane garante o lado certo do plano).
 *
 * Coordenadas "mm" = índice × espaçamento, como em valve.ts.
 */
import { sampleVolume, type Plane, type Vec3, type Volume } from './valve';

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const add = (a: Vec3, b: Vec3, k = 1): Vec3 => [
  a[0] + b[0] * k,
  a[1] + b[1] * k,
  a[2] + b[2] * k,
];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Base ortonormal (u, v) do plano de normal n. */
export function basisOf(n: Vec3): { u: Vec3; v: Vec3 } {
  const ref: Vec3 = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const u = unit(cross(ref, n));
  return { u, v: cross(n, u) };
}

// ------------------------------------------------------------ eixos e redução

/**
 * Para cada eixo do paciente (esquerda, posterior, superior), qual eixo do
 * volume aponta para lá e se está invertido. `direction` é a matriz 3×3 do
 * vtkImageData (por colunas: direction[3a + c] = componente c, em LPS, do
 * eixo a do volume); ausente = identidade.
 */
export interface PatientAxes {
  perm: Vec3;
  flip: [boolean, boolean, boolean];
}

export function patientAxes(direction?: ArrayLike<number> | null): PatientAxes {
  const d = direction && direction.length === 9 ? direction : null;
  const perm: Vec3 = [0, 1, 2];
  const flip: [boolean, boolean, boolean] = [false, false, false];
  if (!d) return { perm, flip };
  const used = new Set<number>();
  for (let c = 0; c < 3; c++) {
    let best = -1;
    let bestAbs = -1;
    for (let a = 0; a < 3; a++) {
      const value = Math.abs(d[a * 3 + c]);
      if (!used.has(a) && value > bestAbs) {
        best = a;
        bestAbs = value;
      }
    }
    used.add(best);
    perm[c] = best;
    flip[c] = d[best * 3 + c] < 0;
  }
  return { perm, flip };
}

/** Volume reduzido, já nos eixos do paciente (x = esquerda, y = posterior, z = superior). */
export interface LowVolume {
  data: Int16Array;
  dims: Vec3;
  /** mm por voxel em cada eixo do paciente. */
  step: Vec3;
  axes: PatientAxes;
  factor: Vec3;
  source: Volume;
}

export function reduceVolume(
  vol: Volume,
  axes: PatientAxes,
  target = 2
): LowVolume {
  const f = [0, 1, 2].map((a) =>
    Math.max(1, Math.round(target / vol.spacing[a]))
  ) as Vec3;
  const n = [0, 1, 2].map((a) => Math.floor(vol.dims[a] / f[a])) as Vec3;
  const [nx, ny] = vol.dims;
  const src = vol.data;
  const tmp = new Float32Array(n[0] * n[1] * n[2]);
  const count = f[0] * f[1] * f[2];
  for (let k = 0; k < n[2]; k++)
    for (let j = 0; j < n[1]; j++)
      for (let i = 0; i < n[0]; i++) {
        let sum = 0;
        for (let dk = 0; dk < f[2]; dk++)
          for (let dj = 0; dj < f[1]; dj++) {
            const o = i * f[0] + nx * (j * f[1] + dj + ny * (k * f[2] + dk));
            for (let di = 0; di < f[0]; di++) sum += src[o + di];
          }
        tmp[i + n[0] * (j + n[1] * k)] = sum / count;
      }
  const dims = axes.perm.map((a) => n[a]) as Vec3;
  const step = axes.perm.map((a) => f[a] * vol.spacing[a]) as Vec3;
  const data = new Int16Array(dims[0] * dims[1] * dims[2]);
  const idx: Vec3 = [0, 0, 0];
  for (let z = 0; z < dims[2]; z++)
    for (let y = 0; y < dims[1]; y++)
      for (let x = 0; x < dims[0]; x++) {
        const c = [x, y, z];
        for (let q = 0; q < 3; q++)
          idx[axes.perm[q]] = axes.flip[q] ? dims[q] - 1 - c[q] : c[q];
        data[x + dims[0] * (y + dims[1] * z)] =
          tmp[idx[0] + n[0] * (idx[1] + n[1] * idx[2])];
      }
  return { data, dims, step, axes, factor: f, source: vol };
}

/** Centro de um voxel reduzido (pode ser fracionário) em mm do volume original. */
export function lowToMm(low: LowVolume, p: Vec3): Vec3 {
  const out: Vec3 = [0, 0, 0];
  for (let q = 0; q < 3; q++) {
    const a = low.axes.perm[q];
    const i = low.axes.flip[q] ? low.dims[q] - 1 - p[q] : p[q];
    out[a] =
      (i * low.factor[a] + (low.factor[a] - 1) / 2) * low.source.spacing[a];
  }
  return out;
}

/** Vetor nos eixos do paciente → vetor (unitário) em mm do volume original. */
export function lowDirToMm(low: LowVolume, d: Vec3): Vec3 {
  const out: Vec3 = [0, 0, 0];
  for (let q = 0; q < 3; q++)
    out[low.axes.perm[q]] = low.axes.flip[q] ? -d[q] : d[q];
  return unit(out);
}

// ------------------------------------------------------------------- sangue

/**
 * Densidades candidatas a "sangue contrastado": picos do histograma das
 * regiões homogêneas entre 150 e 800 UH (o osso, heterogêneo, fica de fora),
 * do mais denso para o menos denso. Há mais de um quando as câmaras direitas
 * estão lavadas; quem decide é a anatomia (ver detectAorticValve).
 */
export function bloodCandidates(low: LowVolume): number[] {
  const { data, dims } = low;
  const [nx, ny, nz] = dims;
  const BIN = 10;
  const hist = new Float64Array(82);
  const sxy = nx * ny;
  const FLAT = 45;
  for (let z = 1; z < nz - 1; z++)
    for (let y = 1; y < ny - 1; y++)
      for (let x = 1; x < nx - 1; x++) {
        const o = x + nx * (y + ny * z);
        const h = data[o];
        if (h < 150 || h >= 800) continue;
        const flat =
          Math.abs(data[o - 1] - h) < FLAT &&
          Math.abs(data[o + 1] - h) < FLAT &&
          Math.abs(data[o - nx] - h) < FLAT &&
          Math.abs(data[o + nx] - h) < FLAT &&
          Math.abs(data[o - sxy] - h) < FLAT &&
          Math.abs(data[o + sxy] - h) < FLAT;
        if (flat) hist[Math.floor(h / BIN)] += 1;
      }
  const smooth = (b: number) =>
    (hist[b - 2] ?? 0) +
    2 * (hist[b - 1] ?? 0) +
    3 * hist[b] +
    2 * (hist[b + 1] ?? 0) +
    (hist[b + 2] ?? 0);
  const voxel = low.step[0] * low.step[1] * low.step[2];
  const peaks: number[] = [];
  for (let b = 79; b >= 15; b--) {
    const c = smooth(b);
    let peak = c > 0;
    for (let q = 1; q <= 3 && peak; q++)
      peak = c >= smooth(b - q) && c >= smooth(b + q);
    // ≥ 5 mL em torno do pico
    if (peak && (c / 9) * 5 * voxel > 5000) peaks.push(b * BIN + BIN / 2);
  }
  return peaks;
}

// ------------------------------------------------------ discos e tubos axiais

export interface Disc {
  x: number;
  y: number;
  z: number;
  /** Raio em mm. */
  r: number;
  /** Densidade média do interior (UH). */
  hu: number;
}
export interface Tube {
  discs: Disc[];
}

const median = (values: number[]) => {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/** Distância (em voxels) até o fundo, por chamfer 3-4, num corte. */
function sliceDistance(mask: Uint8Array, nx: number, ny: number) {
  const d = new Float32Array(nx * ny);
  const BIG = 1e6;
  for (let i = 0; i < nx * ny; i++) d[i] = mask[i] ? BIG : 0;
  const relax = (i: number, j: number, w: number) => {
    if (d[j] + w < d[i]) d[i] = d[j] + w;
  };
  for (let y = 1; y < ny - 1; y++)
    for (let x = 1; x < nx - 1; x++) {
      const i = x + nx * y;
      if (!d[i]) continue;
      relax(i, i - 1, 3);
      relax(i, i - nx, 3);
      relax(i, i - nx - 1, 4);
      relax(i, i - nx + 1, 4);
    }
  for (let y = ny - 2; y > 0; y--)
    for (let x = nx - 2; x > 0; x--) {
      const i = x + nx * y;
      if (!d[i]) continue;
      relax(i, i + 1, 3);
      relax(i, i + nx, 3);
      relax(i, i + nx + 1, 4);
      relax(i, i + nx - 1, 4);
    }
  for (let i = 0; i < nx * ny; i++) d[i] = d[i] >= BIG ? 0 : d[i] / 3;
  return d;
}

/** Discos de sangue homogêneo e isolado (cercado por tecido) num corte axial. */
export function findDiscs(low: LowVolume, z: number, blood: number): Disc[] {
  const { data, dims, step } = low;
  const [nx, ny] = dims;
  const px = (step[0] + step[1]) / 2;
  const cut = 0.72 * blood + 15;
  const base = nx * ny * z;
  const mask = new Uint8Array(nx * ny);
  for (let i = 0; i < nx * ny; i++)
    mask[i] = data[base + i] >= cut && data[base + i] < blood * 1.6 ? 1 : 0;
  const dist = sliceDistance(mask, nx, ny);
  const minR = 7 / px;
  const peaks: Array<[number, number, number]> = [];
  for (let y = 2; y < ny - 2; y++)
    for (let x = 2; x < nx - 2; x++) {
      const v = dist[x + nx * y];
      if (v < minR) continue;
      let top = true;
      for (let dy = -1; dy <= 1 && top; dy++)
        for (let dx = -1; dx <= 1; dx++)
          if (dist[x + dx + nx * (y + dy)] > v) top = false;
      if (top) peaks.push([v, x, y]);
    }
  peaks.sort((a, b) => b[0] - a[0]);
  const out: Disc[] = [];
  const at = (x: number, y: number) =>
    x < 0 || y < 0 || x >= nx || y >= ny ? 0 : mask[x + nx * y];
  for (const [r, x, y] of peaks) {
    if (out.some((d) => Math.hypot(d.x - x, d.y - y) < d.r / px + r)) continue;
    // raios a partir do centro: a maioria tem de encontrar a parede perto
    // do raio do disco (tolera o contato com um vaso vizinho)
    const hits: number[] = [];
    for (let a = 0; a < 48; a++) {
      const c = Math.cos((a * Math.PI) / 24);
      const s = Math.sin((a * Math.PI) / 24);
      let q = r * 0.6;
      while (q < 2.2 * r && at(Math.round(x + c * q), Math.round(y + s * q)))
        q += 0.5;
      hits.push(q);
    }
    const closed = hits.filter((q) => q <= 1.4 * r + 1).length;
    if (closed < 30) continue;
    // interior homogêneo, com densidade de sangue
    let n = 0;
    let sum = 0;
    let sq = 0;
    const ri = Math.max(1, Math.floor(r * 0.7));
    for (let dy = -ri; dy <= ri; dy++)
      for (let dx = -ri; dx <= ri; dx++) {
        if (dx * dx + dy * dy > ri * ri) continue;
        const h = data[base + x + dx + nx * (y + dy)];
        n += 1;
        sum += h;
        sq += h * h;
      }
    const mean = sum / n;
    const sd = Math.sqrt(Math.max(0, sq / n - mean * mean));
    if (mean < 0.7 * blood || mean > 1.4 * blood || sd > 0.16 * blood) continue;
    out.push({ x, y, z, r: median(hits) * px, hu: mean });
  }
  return out;
}

/** Empilha os discos de cortes vizinhos em tubos (de cima para baixo). */
export function findTubes(low: LowVolume, blood: number): Tube[] {
  const px = (low.step[0] + low.step[1]) / 2;
  const open: Tube[] = [];
  const all: Tube[] = [];
  for (let z = low.dims[2] - 2; z >= 1; z--) {
    const discs = findDiscs(low, z, blood);
    for (const d of discs) {
      let best: Tube | null = null;
      let bestDist = Infinity;
      for (const t of open) {
        const last = t.discs[t.discs.length - 1];
        if (last.z - z > 2 || last.z === z) continue;
        const dist = Math.hypot(last.x - d.x, last.y - d.y) * px;
        const ratio = d.r / last.r;
        if (dist < 0.5 * last.r + px && ratio > 0.65 && ratio < 1.5)
          if (dist < bestDist) {
            best = t;
            bestDist = dist;
          }
      }
      if (best) best.discs.push(d);
      else {
        const t = { discs: [d] };
        open.push(t);
        all.push(t);
      }
    }
  }
  return all;
}

export const tubeLength = (low: LowVolume, t: Tube) =>
  (t.discs[0].z - t.discs[t.discs.length - 1].z + 1) * low.step[2];

const meanHu = (t: Tube) =>
  t.discs.reduce((sum, d) => sum + d.hu, 0) / t.discs.length;

/** Aorta descendente: o tubo fino mais longo (≥ 40 mm), posterior. */
export function pickDescendingAorta(
  low: LowVolume,
  tubes: Tube[]
): Tube | null {
  const long = tubes
    .filter((t) => {
      const r = median(t.discs.map((d) => d.r));
      return r >= 6 && r <= 18 && tubeLength(low, t) >= 40;
    })
    .sort((a, b) => tubeLength(low, b) - tubeLength(low, a));
  return long[0] ?? null;
}

/**
 * Aorta ascendente: tubo calibroso (≥ 16 mm de extensão) com a mesma
 * densidade da descendente (mesmo sangue arterial; a veia cava e o tronco
 * pulmonar costumam diferir), à direita e à frente dela. Sem descendente no
 * campo, o tubo calibroso mais anterior que chega perto do topo.
 */
export function pickAscendingAorta(
  low: LowVolume,
  tubes: Tube[]
): { tube: Tube; anchored: boolean } | null {
  const desc = pickDescendingAorta(low, tubes);
  const big = tubes.filter((t) => {
    if (t === desc) return false;
    const r = median(t.discs.map((d) => d.r));
    return r >= 9 && r <= 26 && tubeLength(low, t) >= 16;
  });
  if (!big.length) return null;
  const xOf = (t: Tube) => median(t.discs.map((d) => d.x)) * low.step[0];
  const yOf = (t: Tube) => median(t.discs.map((d) => d.y)) * low.step[1];
  if (desc) {
    const hu = meanHu(desc);
    const fit = big.filter((t) => {
      const right = xOf(desc) - xOf(t);
      const front = yOf(desc) - yOf(t);
      const same = Math.abs(meanHu(t) - hu) < 0.1 * hu;
      return same && right > 5 && right < 90 && front > 25 && front < 130;
    });
    // a ascendente fica acima do ventrículo: entre os candidatos, o que
    // começa mais alto; no empate, o mais calibroso
    const top = Math.max(...fit.map((t) => t.discs[0].z));
    const near = fit.filter((t) => (top - t.discs[0].z) * low.step[2] <= 30);
    near.sort(
      (a, b) =>
        median(b.discs.map((d) => d.r)) - median(a.discs.map((d) => d.r))
    );
    if (near.length) return { tube: near[0], anchored: true };
  }
  const top = Math.max(...big.map((t) => t.discs[0].z));
  const near = big.filter((t) => (top - t.discs[0].z) * low.step[2] <= 45);
  near.sort((a, b) => yOf(a) - yOf(b));
  return near[0] ? { tube: near[0], anchored: false } : null;
}

// ------------------------------------------------------- cortes e gargalo

export interface Cut {
  /** Área (mm²) do sangue ligado ao centro, dentro do raio de busca. */
  area: number;
  centroid: Vec3;
  /** Fração da borda do raio de busca tocada pelo sangue (0 = luz fechada). */
  open: number;
}

/**
 * Sangue ligado ao centro num plano (normal n) por p, até `cap` mm do centro.
 * Amostra a 1 mm.
 */
export function cutAt(
  vol: Volume,
  p: Vec3,
  n: Vec3,
  threshold: number,
  cap: number
): Cut | null {
  const { u, v } = basisOf(n);
  const h = Math.ceil(cap);
  const size = 2 * h + 1;
  const mask = new Int8Array(size * size); // 0 = não visto, 1 = sangue, -1 = não
  const test = (i: number, j: number) => {
    const o = i + size * j;
    if (mask[o]) return mask[o] > 0;
    const x = i - h;
    const y = j - h;
    const q: Vec3 = [
      p[0] + u[0] * x + v[0] * y,
      p[1] + u[1] * x + v[1] * y,
      p[2] + u[2] * x + v[2] * y,
    ];
    const yes = sampleVolume(vol, q) >= threshold;
    mask[o] = yes ? 1 : -1;
    return yes;
  };
  // semente: o centro ou o sangue mais próximo (até 4 mm)
  let seed = -1;
  for (let r = 0; r <= 4 && seed < 0; r++)
    for (let dj = -r; dj <= r && seed < 0; dj++)
      for (let di = -r; di <= r; di++)
        if (test(h + di, h + dj)) {
          seed = h + di + size * (h + dj);
          break;
        }
  if (seed < 0) return null;
  const queue = new Int32Array(size * size);
  const seen = new Uint8Array(size * size);
  let head = 0;
  let tail = 0;
  queue[tail++] = seed;
  seen[seed] = 1;
  let area = 0;
  let sx = 0;
  let sy = 0;
  let rim = 0;
  const cap2 = cap * cap;
  const rimFrom = (cap - 1.5) * (cap - 1.5);
  while (head < tail) {
    const o = queue[head++];
    const i = o % size;
    const j = (o - i) / size;
    const x = i - h;
    const y = j - h;
    area += 1;
    sx += x;
    sy += y;
    if (x * x + y * y >= rimFrom) rim += 1;
    for (let d = 0; d < 4; d++) {
      const ni = i + (d === 0 ? 1 : d === 1 ? -1 : 0);
      const nj = j + (d === 2 ? 1 : d === 3 ? -1 : 0);
      if (ni < 0 || nj < 0 || ni >= size || nj >= size) continue;
      const dx = ni - h;
      const dy = nj - h;
      if (dx * dx + dy * dy > cap2) continue;
      const no = ni + size * nj;
      if (seen[no] || !test(ni, nj)) continue;
      seen[no] = 1;
      queue[tail++] = no;
    }
  }
  const cx = sx / area;
  const cy = sy / area;
  return {
    area,
    centroid: [
      p[0] + u[0] * cx + v[0] * cy,
      p[1] + u[1] * cx + v[1] * cy,
      p[2] + u[2] * cx + v[2] * cy,
    ],
    open: rim / (2 * Math.PI * (cap - 0.75) * 1.5),
  };
}

/**
 * Maior círculo de sangue inscrito no plano (normal n), com centro a até
 * `reach` mm de p. Ao contrário da área ligada, quase não muda quando a luz
 * encosta num vaso vizinho.
 */
export function inscribedAt(
  vol: Volume,
  p: Vec3,
  n: Vec3,
  threshold: number,
  reach: number,
  cap: number
): { center: Vec3; radius: number } | null {
  const { u, v } = basisOf(n);
  const h = Math.ceil(cap);
  const size = 2 * h + 1;
  const mask = new Uint8Array(size * size);
  for (let j = 1; j < size - 1; j++)
    for (let i = 1; i < size - 1; i++) {
      const x = i - h;
      const y = j - h;
      if (x * x + y * y > cap * cap) continue;
      const q: Vec3 = [
        p[0] + u[0] * x + v[0] * y,
        p[1] + u[1] * x + v[1] * y,
        p[2] + u[2] * x + v[2] * y,
      ];
      mask[i + size * j] = sampleVolume(vol, q) >= threshold ? 1 : 0;
    }
  const dist = sliceDistance(mask, size, size);
  let best = 0;
  let bi = 0;
  let bj = 0;
  const k = Math.ceil(reach);
  for (let dj = -k; dj <= k; dj++)
    for (let di = -k; di <= k; di++) {
      if (di * di + dj * dj > reach * reach) continue;
      // empate: o mais próximo do centro previsto
      const value = dist[h + di + size * (h + dj)] - 0.02 * Math.hypot(di, dj);
      if (value > best) {
        best = value;
        bi = di;
        bj = dj;
      }
    }
  if (best < 1) return null;
  return {
    center: [
      p[0] + u[0] * bi + v[0] * bj,
      p[1] + u[1] * bi + v[1] * bj,
      p[2] + u[2] * bi + v[2] * bj,
    ],
    radius: dist[h + bi + size * (h + bj)],
  };
}

export interface CenterPoint {
  p: Vec3;
  d: Vec3;
  area: number;
  open: number;
}

/**
 * Segue a luz de 2 em 2 mm. Enquanto o corte é fechado (luz cercada de
 * parede), o centro é o centroide do corte; quando encosta num vizinho, é o
 * centro do maior círculo inscrito, que não é puxado pelo vizinho.
 */
export function trackCenterline(
  vol: Volume,
  start: Vec3,
  dir: Vec3,
  threshold: number,
  radius: number,
  length: number
): CenterPoint[] {
  const out: CenterPoint[] = [];
  const tube = Math.PI * radius * radius;
  const cap = 2.4 * radius;
  let p = start;
  let d = unit(dir);
  for (let s = 0; s <= length; s += 2) {
    let cut = cutAt(vol, p, d, threshold, cap);
    let c = p;
    if (cut && cut.open < 0.03 && cut.area < 2 * tube) c = cut.centroid;
    else {
      const reach = out.length ? 0.3 * radius : radius;
      const disc = inscribedAt(vol, p, d, threshold, reach, cap);
      if (!disc) break;
      c = disc.center;
      cut = cutAt(vol, c, d, threshold, cap);
    }
    out.push({ p: c, d, area: cut?.area ?? 0, open: cut?.open ?? 0 });
    if (out.length >= 5) {
      const back = out[out.length - 5].p;
      const along = unit([c[0] - back[0], c[1] - back[1], c[2] - back[2]]);
      if (dot(along, d) > 0.3) d = unit(add(d, along, 0.5));
    }
    p = add(c, d, 2);
  }
  return out;
}

/**
 * Índice do anel no trajeto (de cima para baixo). Depois dos seios de
 * Valsalva a luz estreita no anel; abaixo dele abre no ventrículo (diástole)
 * ou continua estreitando na via de saída (sístole). O anel é o que vier
 * primeiro:
 *  a) a luz "abre" de vez (área > 1,5 × a do tubo por ≥ 16 mm): o corte
 *     fechado mais estreito nos 16 mm anteriores;
 *  b) a área cai abaixo de 62% do máximo dos 24 mm anteriores (os seios) e
 *     assim permanece.
 * Cortes minúsculos (um folheto fechado isola um compartimento) não contam.
 */
export function annulusIndex(track: CenterPoint[], radius: number): number {
  const tube = Math.PI * radius * radius;
  const n = track.length;
  // mediana de 3 para tirar os cortes espúrios
  const area = track.map((t, i) =>
    median([
      track[Math.max(0, i - 1)].area,
      t.area,
      track[Math.min(n - 1, i + 1)].area,
    ])
  );
  const valid = (i: number) =>
    track[i].open <= 0.03 && track[i].area >= 0.4 * tube;
  const RUN = 8;
  for (let i = 6; i < n; i++) {
    // a) abriu no ventrículo
    if (i + RUN <= n) {
      let run = true;
      for (let q = 0; q < RUN && run; q++) run = area[i + q] > 1.5 * tube;
      if (run) {
        let best = -1;
        for (let q = Math.max(0, i - 8); q < i; q++)
          if (valid(q) && (best < 0 || track[q].area <= track[best].area))
            best = q;
        return best;
      }
    }
    // b) estreitou depois dos seios
    // (o máximo só conta cortes fechados: encostar num vizinho não é seio)
    let peak = 0;
    for (let q = Math.max(0, i - 12); q < i; q++)
      if (track[q].open <= 0.03) peak = Math.max(peak, area[q]);
    const below = (q: number) => q < n && area[q] < 0.62 * peak;
    if (peak > 0.7 * tube && below(i) && below(i + 1) && below(i + 2))
      return valid(i) ? i : i - 1;
  }
  return -1;
}

export type Detection =
  | { ok: true; plane: Plane; blood: number; radius: number }
  | { ok: false; reason: 'sem-contraste' | 'sem-aorta' | 'sem-anel' };

/** Plano com a normal dada, passando por c. */
export function planeAt(center: Vec3, normal: Vec3): Plane {
  const n = unit(normal);
  const { u, v } = basisOf(n);
  return { center, u, v, n };
}

/**
 * Valva aórtica sem cliques. A normal do plano aponta para a aorta (o lado
 * "acima" do anel, onde ficam os seios e as cúspides).
 */
export function detectAorticValve(
  vol: Volume,
  direction?: ArrayLike<number> | null
): Detection {
  const low = reduceVolume(vol, patientAxes(direction), 1.2);
  const levels = bloodCandidates(low);
  if (!levels.length) return { ok: false, reason: 'sem-contraste' };
  // a densidade certa é a que mostra as duas aortas (ascendente ancorada na
  // descendente); sem isso, a primeira que mostrar um tubo calibroso
  let tube: Tube | null = null;
  for (const level of levels) {
    const pick = pickAscendingAorta(low, findTubes(low, level));
    if (pick?.anchored) {
      tube = pick.tube;
      break;
    }
    if (pick && !tube) tube = pick.tube;
  }
  if (!tube) return { ok: false, reason: 'sem-aorta' };
  const radius = median(tube.discs.map((d) => d.r));
  const blood = meanHu(tube);
  // começa onde o tubo já tem calibre de aorta (pula a croça)
  const first = Math.max(
    0,
    tube.discs.findIndex((d) => d.r >= 0.9 * radius)
  );
  const a = tube.discs[first];
  const b = tube.discs[Math.min(tube.discs.length - 1, first + 10)];
  const start = lowToMm(low, [a.x, a.y, a.z]);
  const down =
    a === b
      ? lowDirToMm(low, [0, 0, -1])
      : lowDirToMm(low, [
          (b.x - a.x) * low.step[0],
          (b.y - a.y) * low.step[1],
          (b.z - a.z) * low.step[2],
        ]);
  const threshold = 0.8 * blood;
  const track = trackCenterline(vol, start, down, threshold, radius, 160);
  const at = annulusIndex(track, radius);
  if (at < 0) return { ok: false, reason: 'sem-anel' };
  // eixo da raiz: do trajeto 16 mm acima até o anel (mais estável do que a
  // direção local); o plano do anel é perpendicular a ele
  const above = track[Math.max(0, at - 8)].p;
  const here = track[at].p;
  const axis = unit([
    above[0] - here[0],
    above[1] - here[1],
    above[2] - here[2],
  ]);
  const normal =
    dot(axis, track[at].d) < 0 ? axis : (track[at].d.map((x) => -x) as Vec3);
  const cut = cutAt(vol, here, normal, threshold, 2.4 * radius);
  const center = cut && cut.open <= 0.03 ? cut.centroid : here;
  return { ok: true, plane: planeAt(center, normal), blood, radius };
}

/**
 * Orienta o plano marcado à mão: a normal ("acima" do anel) tem de apontar
 * para a aorta/tronco pulmonar nas valvas semilunares e para o átrio nas
 * atrioventriculares, qualquer que seja a ordem dos cliques.
 */
export function orientPlane(
  plane: Plane,
  valve: 'aortica' | 'mitral' | 'tricuspide' | 'pulmonar',
  direction?: ArrayLike<number> | null
): Plane {
  const axes = patientAxes(direction);
  // [esquerda, posterior, superior] de cada alvo, nos eixos do paciente
  const target: Record<typeof valve, Vec3> = {
    aortica: [0, 0, 1],
    pulmonar: [0, 0, 1],
    mitral: [-1, 1, 1],
    tricuspide: [-1, 1, 0],
  };
  const want: Vec3 = [0, 0, 0];
  for (let q = 0; q < 3; q++)
    want[axes.perm[q]] = axes.flip[q] ? -target[valve][q] : target[valve][q];
  if (dot(plane.n, want) >= 0) return plane;
  const n: Vec3 = [-plane.n[0], -plane.n[1], -plane.n[2]];
  return { center: plane.center, u: plane.u, v: cross(n, plane.u), n };
}

/**
 * Inclina o plano do anel: a graus em torno de v (a normal pende para u) e
 * b graus em torno de u (pende para v). O centro não muda.
 */
export function tiltPlane(plane: Plane, a: number, b: number): Plane {
  if (!a && !b) return plane;
  const ta = Math.tan((a * Math.PI) / 180);
  const tb = Math.tan((b * Math.PI) / 180);
  const n = unit([
    plane.n[0] + plane.u[0] * ta + plane.v[0] * tb,
    plane.n[1] + plane.u[1] * ta + plane.v[1] * tb,
    plane.n[2] + plane.u[2] * ta + plane.v[2] * tb,
  ]);
  const along = dot(plane.u, n);
  const u = unit([
    plane.u[0] - n[0] * along,
    plane.u[1] - n[1] * along,
    plane.u[2] - n[2] * along,
  ]);
  return { center: plane.center, u, v: cross(n, u), n };
}
