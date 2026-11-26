/**
 * CatStudio — foto final: o 3D refeito no processador, em qualidade máxima.
 *
 * A vista 3D na tela é limitada pela placa de vídeo (volume reduzido,
 * resolução reduzida, sem sombra no modo Leve). A foto final lança um raio
 * por pixel no volume original, com as mesmas cores, opacidades, cortes e
 * escultura da tela, e acrescenta o que deixa a imagem com cara de pôster:
 * iluminação com brilho, sombra projetada e amostragem fina. Roda aos
 * poucos, sem travar a página e sem depender da placa.
 *
 * Tudo aqui é conta pura (sem vtk nem tela), para poder ser testado.
 */

export type Vec3 = [number, number, number];
/** mat4 por coluna (gl-matrix) */
export type Mat4 = ArrayLike<number>;

export interface Volume {
  data: ArrayLike<number>;
  dims: Vec3;
  /** mundo (mm) → índice */
  worldToIndex: Mat4;
  /** índice → mundo, só a parte linear: coluna a = eixo a × espaçamento */
  axes: [Vec3, Vec3, Vec3];
}

export interface Transfer {
  /** cor (0–1) por entrada: r, g, b */
  rgb: Float32Array;
  /** opacidade por amostra, já corrigida para o passo do raio */
  alpha: Float32Array;
  /** opacidade por amostra no passo (maior) do raio de sombra */
  shadowAlpha: Float32Array;
  min: number;
  /** entradas por unidade de densidade */
  scale: number;
}

/** O que a escultura escondeu, no volume (reduzido) que a tela desenha. */
export interface Mask {
  dims: Vec3;
  /** quantos voxels originais por voxel da máscara, por eixo */
  factor: Vec3;
  hidden: Uint8Array | null;
  /** > 0 = osso */
  bone: Uint8Array | null;
  /** 0 = osso escondido … 1 = normal */
  boneOpacity: number;
}

export interface Camera {
  position: Vec3;
  focalPoint: Vec3;
  viewUp: Vec3;
  /** graus, na vertical */
  viewAngle: number;
  parallel: boolean;
  parallelScale: number;
}

export interface Plane {
  origin: Vec3;
  /** aponta para o lado que fica */
  normal: Vec3;
}

export interface Lighting {
  /** para onde a luz está, em coordenadas do mundo */
  direction: Vec3;
  intensity: number;
  ambient: number;
  diffuse: number;
  specular: number;
  specularPower: number;
  /** 0 = sem sombra … 1 = sombra total */
  shadow: number;
}

export interface PhotoInput {
  volume: Volume;
  transfer: Transfer;
  mask: Mask | null;
  camera: Camera;
  planes: Plane[];
  lighting: Lighting;
  /** 0–1 */
  background: Vec3;
  width: number;
  height: number;
  /** passo do raio, em mm */
  step: number;
}

/** Tamanho do bloco usado para pular o espaço vazio, em voxels. */
export const BLOCK = 8;
/** Gradiente (densidade por mm) a partir do qual o relevo é todo iluminado. */
export const FULL_GRADIENT = 60;
/** Até onde o raio de sombra procura obstáculo, em mm. */
export const SHADOW_REACH = 120;

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const add = (a: Vec3, b: Vec3, s = 1): Vec3 => [
  a[0] + b[0] * s,
  a[1] + b[1] * s,
  a[2] + b[2] * s,
];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const normalize = (a: Vec3): Vec3 => {
  const n = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / n, a[1] / n, a[2] / n];
};

/** Ponto do mundo → índice (com translação). */
export function toIndex(m: Mat4, p: Vec3): Vec3 {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}

/** Direção do mundo → índice (sem translação). */
export function dirToIndex(m: Mat4, d: Vec3): Vec3 {
  return [
    m[0] * d[0] + m[4] * d[1] + m[8] * d[2],
    m[1] * d[0] + m[5] * d[1] + m[9] * d[2],
    m[2] * d[0] + m[6] * d[1] + m[10] * d[2],
  ];
}

// ---------- câmera ----------

export interface Ray {
  origin: Vec3;
  dir: Vec3;
}

interface CameraBasis {
  forward: Vec3;
  right: Vec3;
  up: Vec3;
  /** meia altura da imagem: tangente (perspectiva) ou mm (paralela) */
  half: number;
}

export function cameraBasis(camera: Camera): CameraBasis {
  const forward = normalize(add(camera.focalPoint, camera.position, -1));
  const right = normalize(cross(forward, camera.viewUp));
  const up = cross(right, forward);
  const half = camera.parallel
    ? camera.parallelScale
    : Math.tan((camera.viewAngle * Math.PI) / 360);
  return { forward, right, up, half };
}

/** O raio do pixel (px, py), y para baixo, numa imagem w × h. */
export function pixelRay(
  input: Pick<PhotoInput, 'camera' | 'width' | 'height'>,
  basis: CameraBasis,
  pixel: [number, number]
): Ray {
  const aspect = input.width / input.height;
  const x = ((2 * (pixel[0] + 0.5)) / input.width - 1) * basis.half * aspect;
  const y = (1 - (2 * (pixel[1] + 0.5)) / input.height) * basis.half;
  const offset = add(add([0, 0, 0], basis.right, x), basis.up, y);
  if (input.camera.parallel)
    return {
      origin: add(input.camera.position, offset),
      dir: basis.forward,
    };
  return {
    origin: input.camera.position,
    dir: normalize(add(basis.forward, offset)),
  };
}

// ---------- recorte do raio ----------

/** Trecho [t0, t1] do raio dentro da caixa [0, n-1] de um eixo. */
function slab(o: number, d: number, n: number, span: number[]) {
  if (Math.abs(d) < 1e-12) {
    if (o < 0 || o > n - 1) span[1] = -Infinity;
    return;
  }
  const a = (0 - o) / d;
  const b = (n - 1 - o) / d;
  span[0] = Math.max(span[0], Math.min(a, b));
  span[1] = Math.min(span[1], Math.max(a, b));
}

/** Trecho do raio que fica do lado visível de um plano de corte. */
function clipPlane(ray: Ray, plane: Plane, span: number[]) {
  const along = dot(ray.dir, plane.normal);
  const at = dot(add(ray.origin, plane.origin, -1), plane.normal);
  if (Math.abs(along) < 1e-12) {
    if (at < 0) span[1] = -Infinity;
    return;
  }
  const t = -at / along;
  if (along > 0) span[0] = Math.max(span[0], t);
  else span[1] = Math.min(span[1], t);
}

/** Onde o raio entra e sai do volume, já cortado pelos planos. */
export function rayInterval(input: PhotoInput, ray: Ray): [number, number] {
  const o = toIndex(input.volume.worldToIndex, ray.origin);
  const d = dirToIndex(input.volume.worldToIndex, ray.dir);
  const span = [0, Infinity];
  for (let a = 0; a < 3; a++) slab(o[a], d[a], input.volume.dims[a], span);
  input.planes.forEach((plane) => clipPlane(ray, plane, span));
  return [span[0], span[1]];
}

// ---------- amostragem ----------

/** Valor do volume num ponto (índice contínuo), interpolado. */
export function sampleAt(volume: Volume, i: number, j: number, k: number) {
  const [nx, ny, nz] = volume.dims;
  const x = Math.min(Math.max(i, 0), nx - 1.0001);
  const y = Math.min(Math.max(j, 0), ny - 1.0001);
  const z = Math.min(Math.max(k, 0), nz - 1.0001);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const fx = x - x0;
  const fy = y - y0;
  const fz = z - z0;
  const { data } = volume;
  const slice = nx * ny;
  const a = x0 + nx * y0 + slice * z0;
  const c00 = data[a] + (data[a + 1] - data[a]) * fx;
  const c10 = data[a + nx] + (data[a + nx + 1] - data[a + nx]) * fx;
  const c01 = data[a + slice] + (data[a + slice + 1] - data[a + slice]) * fx;
  const b = a + slice + nx;
  const c11 = data[b] + (data[b + 1] - data[b]) * fx;
  const c0 = c00 + (c10 - c00) * fy;
  const c1 = c01 + (c11 - c01) * fy;
  return c0 + (c1 - c0) * fz;
}

export function lutIndex(transfer: Transfer, value: number): number {
  const at = Math.round((value - transfer.min) * transfer.scale);
  return Math.min(transfer.alpha.length - 1, Math.max(0, at));
}

/** Voxel da máscara que contém o ponto; -1 fora. */
function maskIndex(mask: Mask, i: number, j: number, k: number): number {
  const a = Math.floor((i + 0.5) / mask.factor[0]);
  const b = Math.floor((j + 0.5) / mask.factor[1]);
  const c = Math.floor((k + 0.5) / mask.factor[2]);
  const [nx, ny, nz] = mask.dims;
  if (a < 0 || b < 0 || c < 0 || a >= nx || b >= ny || c >= nz) return -1;
  return a + nx * (b + ny * c);
}

const clampTo = (value: number, top: number) =>
  Math.min(top, Math.max(0, value));

/** Algum dos 8 voxels da máscara em volta do ponto está escondido? */
function hiddenAround(mask: Mask, hidden: Uint8Array, p: Vec3): boolean {
  const [nx, ny, nz] = mask.dims;
  const [fx, fy, fz] = mask.factor;
  const a0 = Math.floor((p[0] + 0.5) / fx - 0.5);
  const b0 = Math.floor((p[1] + 0.5) / fy - 0.5);
  const c0 = Math.floor((p[2] + 0.5) / fz - 0.5);
  for (let n = 0; n < 8; n++) {
    const a = clampTo(a0 + (n & 1), nx - 1);
    const b = clampTo(b0 + ((n >> 1) & 1), ny - 1);
    const c = clampTo(c0 + ((n >> 2) & 1), nz - 1);
    if (hidden[a + nx * (b + ny * c)]) return true;
  }
  return false;
}

/**
 * Quanto da opacidade fica neste ponto por causa da escultura: 0 escondido,
 * a opacidade do osso no osso, 1 no resto. Basta um vizinho escondido para
 * esconder: na tela o escondido vira ar e a interpolação apaga a borda; sem
 * isso sobraria uma casca fantasma em volta do que foi apagado.
 */
export function maskWeight(mask: Mask | null, p: Vec3): number {
  if (!mask) return 1;
  const { hidden } = mask;
  if (hidden && hiddenAround(mask, hidden, p)) return 0;
  const at = maskIndex(mask, p[0], p[1], p[2]);
  if (at < 0) return 1;
  return mask.bone && mask.bone[at] ? mask.boneOpacity : 1;
}

// ---------- espaço vazio ----------

export interface Blocks {
  dims: Vec3;
  /** 1 = o bloco (ou um vizinho) tem algo visível */
  visible: Uint8Array;
}

/** Marca os blocos de `BLOCK`³ voxels de uma fatia que têm algo visível. */
export function markSlice(
  volume: Volume,
  transfer: Transfer,
  blocks: Blocks,
  k: number
) {
  const [nx, ny] = volume.dims;
  const [bx, by] = blocks.dims;
  const base = bx * by * Math.floor(k / BLOCK);
  const slice = nx * ny * k;
  for (let j = 0; j < ny; j++) {
    const row = slice + nx * j;
    const blockRow = base + bx * Math.floor(j / BLOCK);
    for (let i = 0; i < nx; i++)
      if (transfer.alpha[lutIndex(transfer, volume.data[row + i])] > 0)
        blocks.visible[blockRow + Math.floor(i / BLOCK)] = 1;
  }
}

export function emptyBlocks(volume: Volume): Blocks {
  const dims = volume.dims.map((n) => Math.ceil(n / BLOCK)) as Vec3;
  return { dims, visible: new Uint8Array(dims[0] * dims[1] * dims[2]) };
}

function grownAt(blocks: Blocks, index: number, out: Uint8Array) {
  const [bx, by, bz] = blocks.dims;
  const i = index % bx;
  const j = Math.floor(index / bx) % by;
  const k = Math.floor(index / (bx * by));
  const from = Math.max(0, i - 1);
  const to = Math.min(bx - 1, i + 1) + 1;
  for (let c = Math.max(0, k - 1); c <= Math.min(bz - 1, k + 1); c++)
    for (let b = Math.max(0, j - 1); b <= Math.min(by - 1, j + 1); b++) {
      const row = bx * (b + by * c);
      out.fill(1, row + from, row + to);
    }
}

/**
 * Engorda os blocos visíveis em um bloco para cada lado: a interpolação lê
 * vizinhos, e um bloco vazio encostado num cheio pode mostrar a borda dele.
 */
export function growBlocks(blocks: Blocks) {
  const out = new Uint8Array(blocks.visible.length);
  blocks.visible.forEach((on, index) => {
    if (on) grownAt(blocks, index, out);
  });
  blocks.visible = out;
}

function blockAt(blocks: Blocks, p: Vec3): number {
  const a = Math.floor(p[0] / BLOCK);
  const b = Math.floor(p[1] / BLOCK);
  const c = Math.floor(p[2] / BLOCK);
  const [bx, by, bz] = blocks.dims;
  if (a < 0 || b < 0 || c < 0 || a >= bx || b >= by || c >= bz) return -1;
  return a + bx * (b + by * c);
}

/** Quanto falta (em t) para o raio sair do bloco onde está. */
function toBlockExit(p: Vec3, d: Vec3): number {
  let exit = Infinity;
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-12) continue;
    const edge = (Math.floor(p[a] / BLOCK) + (d[a] > 0 ? 1 : 0)) * BLOCK;
    exit = Math.min(exit, (edge - p[a]) / d[a]);
  }
  return exit;
}

/** Pula o bloco vazio: devolve o novo t, ou o mesmo se o bloco tem algo. */
export function skipEmpty(blocks: Blocks, p: Vec3, d: Vec3, t: number): number {
  const at = blockAt(blocks, p);
  if (at < 0 || blocks.visible[at]) return t;
  return t + Math.max(toBlockExit(p, d), 0) + 1e-3;
}
