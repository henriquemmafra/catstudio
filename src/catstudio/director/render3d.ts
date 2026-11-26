/**
 * CatStudio — diretor de arte: reconstrução 3D recortada no plano do corte.
 *
 * O observador olha para o plano; o que está do lado dele foi retirado. Cada
 * pixel lança um raio para dentro do exame e acumula cor e opacidade pelos
 * tecidos que atravessa (ar e pulmão transparentes, gordura, músculo, sangue
 * com contraste e osso opacos). O resultado é a face do corte colorida pelo
 * tecido e, através do ar (pulmões, alças), o relevo do que fica atrás.
 *
 * Roda em CPU, uma vez por pedido: não usa a placa de vídeo.
 */
import type { Frame } from '@/src/catstudio/director/cut';
import {
  sample,
  type Vec3,
  type WorldVolume,
} from '@/src/catstudio/director/volume';

/** Ponto da função de transferência: densidade (UH) → cor e opacidade por mm. */
type Stop = [hu: number, r: number, g: number, b: number, alpha: number];

export const TISSUE_STYLES = ['tecidos', 'osso', 'vasos', 'pulmao'] as const;
export type TissueStyle = (typeof TISSUE_STYLES)[number];

const STOPS: Record<TissueStyle, Stop[]> = {
  // face do corte legível: tudo o que não é ar fica opaco em poucos mm
  tecidos: [
    [-600, 0.86, 0.6, 0.56, 0],
    [-250, 0.88, 0.66, 0.56, 0.1],
    [-120, 0.95, 0.82, 0.5, 0.16],
    [-40, 0.93, 0.76, 0.48, 0.2],
    [20, 0.72, 0.33, 0.28, 0.3],
    [90, 0.8, 0.4, 0.34, 0.34],
    [200, 0.93, 0.56, 0.47, 0.4],
    [350, 0.97, 0.86, 0.74, 0.5],
    [700, 0.97, 0.94, 0.86, 0.7],
  ],
  // só o esqueleto (e o que tiver densidade de cálcio ou contraste denso)
  osso: [
    [150, 0.9, 0.84, 0.72, 0],
    [260, 0.94, 0.89, 0.78, 0.25],
    [700, 0.98, 0.96, 0.9, 0.7],
  ],
  // partes moles translúcidas, sangue com contraste e osso em destaque
  vasos: [
    [-250, 0.9, 0.75, 0.6, 0],
    [40, 0.82, 0.5, 0.42, 0.012],
    [130, 0.86, 0.3, 0.26, 0.05],
    [220, 0.95, 0.36, 0.3, 0.4],
    [450, 0.98, 0.8, 0.7, 0.55],
    [900, 0.98, 0.95, 0.88, 0.7],
  ],
  // só os pulmões: parênquima quase transparente, vasos e pleura em relevo
  pulmao: [
    [-960, 0.95, 0.75, 0.75, 0],
    [-880, 0.96, 0.78, 0.78, 0.004],
    [-700, 0.95, 0.7, 0.7, 0.012],
    [-450, 0.9, 0.42, 0.42, 0.12],
    [-150, 0.85, 0.28, 0.3, 0.45],
    [100, 0.8, 0.22, 0.25, 0.7],
  ],
};

/** Cor (0–1) e opacidade por mm de uma densidade; escreve em `out`. */
export function transfer(style: TissueStyle, hu: number, out: Float32Array) {
  const stops = STOPS[style];
  const first = stops[0];
  const last = stops[stops.length - 1];
  let a = first;
  let b = first;
  if (hu >= last[0]) {
    a = last;
    b = last;
  } else if (hu > first[0]) {
    let i = 1;
    while (stops[i][0] < hu) i += 1;
    a = stops[i - 1];
    b = stops[i];
  }
  const t = b === a ? 0 : (hu - a[0]) / (b[0] - a[0]);
  out[0] = a[1] + (b[1] - a[1]) * t;
  out[1] = a[2] + (b[2] - a[2]) * t;
  out[2] = a[3] + (b[3] - a[3]) * t;
  out[3] = a[4] + (b[4] - a[4]) * t;
}

const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** Para onde o observador olha: perpendicular à imagem, entrando nela. */
export const viewDirection = (frame: Frame): Vec3 => cross(frame.u, frame.v);

export interface Scene3D {
  /** RGBA da imagem (largura × altura × 4) */
  rgba: Uint8ClampedArray;
  width: number;
  /** pinta o pixel `index` com o raio que parte do ponto (mm) do plano */
  paint(index: number, x: number, y: number, z: number): void;
}

export interface Scene3DOptions {
  style: TissueStyle;
  /** até onde os raios entram, em mm */
  depth: number;
  /** cor de fundo, 0–255 */
  background: readonly [number, number, number];
  /** quanto de cada ponto aparece, 0–1 (pulmões isolados) */
  weight?: (x: number, y: number, z: number) => number;
}

/** Abaixo deste gradiente (UH/mm) o tecido é homogêneo: sem relevo. */
const FLAT_GRADIENT = 12;

/** Desvio (0–1) fixo por pixel, sem padrão visível. */
function jitter(index: number) {
  const h = Math.sin(index * 12.9898) * 43758.5453;
  return h - Math.floor(h);
}

export function scene3D(
  vol: WorldVolume,
  frame: Frame,
  size: { width: number; height: number },
  options: Scene3DOptions
): Scene3D {
  const rgba = new Uint8ClampedArray(4 * size.width * size.height);
  const [dx, dy, dz] = viewDirection(frame);
  const step = Math.min(1.5, Math.max(0.7, vol.minSpacing));
  const steps = Math.max(1, Math.round(options.depth / step));
  // luz vinda do observador, do alto e da esquerda da imagem
  const raw = [0, 1, 2].map(
    (a) => -0.72 * [dx, dy, dz][a] - 0.5 * frame.v[a] - 0.32 * frame.u[a]
  );
  const norm = Math.hypot(raw[0], raw[1], raw[2]);
  const [lx, ly, lz] = raw.map((c) => c / norm);
  const faceLight = -(dx * lx + dy * ly + dz * lz);
  const tf = new Float32Array(4);
  const { style, background, weight } = options;

  /** Iluminação (0–1) no ponto: face do corte chapada, relevo pelo gradiente. */
  function lightAt(x: number, y: number, z: number, hu: number) {
    const gx = sample(vol, x + step, y, z) - hu;
    const gy = sample(vol, x, y + step, z) - hu;
    const gz = sample(vol, x, y, z + step) - hu;
    const g = Math.hypot(gx, gy, gz);
    if (g < FLAT_GRADIENT * step) return faceLight;
    // a normal aponta para o lado menos denso (para fora da superfície)
    return Math.max(0, -(gx * lx + gy * ly + gz * lz) / g);
  }

  function paint(index: number, x0: number, y0: number, z0: number) {
    let r = 0;
    let g = 0;
    let b = 0;
    let alpha = 0;
    // início do raio desviado por pixel: tira os anéis do passo fixo
    const shift = jitter(index);
    for (let i = 0; i < steps && alpha < 0.985; i++) {
      const t = (i + shift) * step;
      const x = x0 + dx * t;
      const y = y0 + dy * t;
      const z = z0 + dz * t;
      const share = weight ? weight(x, y, z) : 1;
      if (share < 0.02) continue;
      const hu = sample(vol, x, y, z);
      transfer(style, hu, tf);
      tf[3] *= share;
      if (tf[3] > 0.0005) {
        const opacity = 1 - Math.exp(-tf[3] * step);
        // a face do corte (primeira amostra) é chapada; o resto tem relevo
        const lit = i === 0 ? faceLight : lightAt(x, y, z, hu);
        const light = 0.32 + 0.68 * lit;
        // o que está mais fundo escurece um pouco: dá a noção de distância
        const part =
          (1 - alpha) * opacity * light * (1 - 0.5 * (t / options.depth));
        r += part * tf[0];
        g += part * tf[1];
        b += part * tf[2];
        alpha += (1 - alpha) * opacity;
      }
    }
    const rest = 1 - alpha;
    const o = 4 * index;
    rgba[o] = 255 * r + rest * background[0];
    rgba[o + 1] = 255 * g + rest * background[1];
    rgba[o + 2] = 255 * b + rest * background[2];
    rgba[o + 3] = 255;
  }

  return { rgba, width: size.width, paint };
}

/** Estilo de cor conforme a janela pedida. */
export function styleForWindow(janela: string): TissueStyle {
  if (janela === 'osso') return 'osso';
  if (janela === 'angio') return 'vasos';
  return 'tecidos';
}
