/**
 * CatStudio — foto final: o caminho de cada raio (cor, luz e sombra).
 */
import {
  type Blocks,
  type PhotoInput,
  type Ray,
  type Vec3,
  FULL_GRADIENT,
  SHADOW_REACH,
  cameraBasis,
  dirToIndex,
  lutIndex,
  maskWeight,
  normalize,
  pixelRay,
  rayInterval,
  sampleAt,
  skipEmpty,
  toIndex,
} from './raycast';

const OPAQUE = 0.985;
/** a sombra é medida onde o raio já ficou com esta opacidade */
const SHADOW_AT = 0.35;
/** o raio de sombra anda em passos maiores */
export const SHADOW_STEP_FACTOR = 2.5;

/** O que um raio acumula. */
interface Accum {
  /** luz ambiente e parte sem relevo (não sofre sombra) */
  ambient: Vec3;
  /** luz direta (sofre sombra) */
  direct: Vec3;
  alpha: number;
  /** 1 = sem sombra; fica < 1 depois de medida */
  light: number;
  shadowDone: boolean;
}

const newAccum = (): Accum => ({
  ambient: [0, 0, 0],
  direct: [0, 0, 0],
  alpha: 0,
  light: 1,
  shadowDone: false,
});

/** O que vale para o raio inteiro. */
interface RayState {
  input: PhotoInput;
  blocks: Blocks;
  /** origem e direção em índices */
  o: Vec3;
  d: Vec3;
  /** semi-vetor de Blinn (luz + olho), no mundo */
  half: Vec3;
  /** direção da luz em índices, por mm */
  lightIndex: Vec3;
  /** para o observador, no mundo */
  eye: Vec3;
}

/** Gradiente da densidade no mundo (por mm), por diferenças centrais. */
export function gradientAt(input: PhotoInput, p: Vec3): Vec3 {
  const { volume } = input;
  const gi =
    (sampleAt(volume, p[0] + 1, p[1], p[2]) -
      sampleAt(volume, p[0] - 1, p[1], p[2])) /
    2;
  const gj =
    (sampleAt(volume, p[0], p[1] + 1, p[2]) -
      sampleAt(volume, p[0], p[1] - 1, p[2])) /
    2;
  const gk =
    (sampleAt(volume, p[0], p[1], p[2] + 1) -
      sampleAt(volume, p[0], p[1], p[2] - 1)) /
    2;
  // eixo a do índice = axes[a] no mundo (com o espaçamento): o gradiente
  // por mm é a soma de cada derivada pelo eixo dividido pelo comprimento²
  const out: Vec3 = [0, 0, 0];
  [gi, gj, gk].forEach((g, a) => {
    const axis = volume.axes[a];
    const length2 = axis[0] ** 2 + axis[1] ** 2 + axis[2] ** 2;
    for (let c = 0; c < 3; c++) out[c] += (g * axis[c]) / length2;
  });
  return out;
}

/** Peso da luz de preenchimento, que vem do observador e não faz sombra. */
export const FILL_LIGHT = 0.35;

/**
 * Luz principal (difusa), brilho, quanto há de relevo (0–1) e luz de
 * preenchimento no ponto.
 */
function shade(state: RayState, p: Vec3): [number, number, number, number] {
  const g = gradientAt(state.input, p);
  const size = Math.hypot(g[0], g[1], g[2]);
  if (size < 1e-6) return [0, 0, 0, 0];
  // a normal aponta para o lado menos denso (para fora da superfície)
  const n: Vec3 = [-g[0] / size, -g[1] / size, -g[2] / size];
  const { lighting } = state.input;
  const l = lighting.direction;
  const ndl = Math.max(0, n[0] * l[0] + n[1] * l[1] + n[2] * l[2]);
  const h = state.half;
  const ndh = Math.max(0, n[0] * h[0] + n[1] * h[1] + n[2] * h[2]);
  const relief = Math.min(1, size / FULL_GRADIENT);
  const eye = state.eye;
  const ndv = Math.max(0, n[0] * eye[0] + n[1] * eye[1] + n[2] * eye[2]);
  return [ndl, ndh ** lighting.specularPower, relief, ndv];
}

/** Soma a contribuição de uma amostra ao raio. */
function accumulate(
  state: RayState,
  acc: Accum,
  p: Vec3,
  sample: { index: number; alpha: number }
) {
  const { transfer, lighting } = state.input;
  const weight = (1 - acc.alpha) * sample.alpha;
  const [ndl, glare, relief, ndv] = shade(state, p);
  const at = 3 * sample.index;
  const fill = FILL_LIGHT * lighting.diffuse * ndv;
  const flat = 1 - relief + relief * (lighting.ambient + fill);
  const lit = relief * lighting.diffuse * ndl * lighting.intensity;
  const shine = relief * lighting.specular * glare * lighting.intensity;
  for (let c = 0; c < 3; c++) {
    const color = transfer.rgb[at + c];
    acc.ambient[c] += weight * color * flat;
    acc.direct[c] += weight * (color * lit + shine);
  }
  acc.alpha += weight;
}

/** Quanto da luz chega ao ponto (1 = toda), andando até a luz. */
export function lightReaching(state: RayState, from: Vec3): number {
  const { input, blocks } = state;
  const stepMm = input.step * SHADOW_STEP_FACTOR;
  const d = state.lightIndex;
  let pass = 1;
  for (let t = stepMm; t < SHADOW_REACH && pass > 0.03; t += stepMm) {
    const p: Vec3 = [
      from[0] + d[0] * t,
      from[1] + d[1] * t,
      from[2] + d[2] * t,
    ];
    const after = skipEmpty(blocks, p, d, t);
    if (after > t) {
      t = after - stepMm;
      continue;
    }
    const alpha =
      input.transfer.shadowAlpha[
        lutIndex(input.transfer, sampleAt(input.volume, p[0], p[1], p[2]))
      ];
    pass *= 1 - alpha * maskWeight(input.mask, p);
  }
  return pass;
}

function maybeShadow(state: RayState, acc: Accum, p: Vec3) {
  if (acc.shadowDone || acc.alpha < SHADOW_AT) return;
  acc.shadowDone = true;
  if (state.input.lighting.shadow > 0)
    acc.light = 1 - state.input.lighting.shadow * (1 - lightReaching(state, p));
}

/** Uma amostra do raio em t; devolve o próximo t. */
function step(state: RayState, acc: Accum, t: number): number {
  const { o, d, input } = state;
  const p: Vec3 = [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
  const after = skipEmpty(state.blocks, p, d, t);
  if (after > t) return after;
  const index = lutIndex(
    input.transfer,
    sampleAt(input.volume, p[0], p[1], p[2])
  );
  const alpha = input.transfer.alpha[index] * maskWeight(input.mask, p);
  if (alpha > 0) {
    accumulate(state, acc, p, { index, alpha });
    maybeShadow(state, acc, p);
  }
  return t + input.step;
}

/** Desvio do início do raio (0–1 passo), fixo por pixel: tira as listras. */
export function jitter(px: number, py: number): number {
  const h = Math.sin(px * 12.9898 + py * 78.233) * 43758.5453;
  return h - Math.floor(h);
}

function rayState(input: PhotoInput, blocks: Blocks, ray: Ray): RayState {
  const { worldToIndex } = input.volume;
  const l = input.lighting.direction;
  return {
    input,
    blocks,
    o: toIndex(worldToIndex, ray.origin),
    d: dirToIndex(worldToIndex, ray.dir),
    half: normalize([l[0] - ray.dir[0], l[1] - ray.dir[1], l[2] - ray.dir[2]]),
    lightIndex: dirToIndex(worldToIndex, l),
    eye: [-ray.dir[0], -ray.dir[1], -ray.dir[2]],
  };
}

/** Cor final (0–1) do raio. */
export function traceRay(
  input: PhotoInput,
  blocks: Blocks,
  ray: Ray,
  offset = 0
): Vec3 {
  const [t0, t1] = rayInterval(input, ray);
  const acc = newAccum();
  if (t0 < t1) {
    const state = rayState(input, blocks, ray);
    let t = t0 + offset * input.step;
    while (t < t1 && acc.alpha < OPAQUE) t = step(state, acc, t);
  }
  const rest = 1 - acc.alpha;
  return [0, 1, 2].map((c) =>
    Math.min(
      1,
      acc.ambient[c] + acc.direct[c] * acc.light + rest * input.background[c]
    )
  ) as Vec3;
}

export interface PhotoJob {
  input: PhotoInput;
  blocks: Blocks;
  rgba: Uint8ClampedArray<ArrayBuffer>;
}

export function newJob(input: PhotoInput, blocks: Blocks): PhotoJob {
  return {
    input,
    blocks,
    rgba: new Uint8ClampedArray(4 * input.width * input.height),
  };
}

/** Desenha as linhas [from, to) da foto. */
export function renderRows(job: PhotoJob, from: number, to: number) {
  const { input } = job;
  const basis = cameraBasis(input.camera);
  for (let py = from; py < Math.min(to, input.height); py++)
    for (let px = 0; px < input.width; px++) {
      const ray = pixelRay(input, basis, [px, py]);
      const color = traceRay(input, job.blocks, ray, jitter(px, py));
      const o = 4 * (px + input.width * py);
      job.rgba[o] = Math.round(color[0] * 255);
      job.rgba[o + 1] = Math.round(color[1] * 255);
      job.rgba[o + 2] = Math.round(color[2] * 255);
      job.rgba[o + 3] = 255;
    }
}
