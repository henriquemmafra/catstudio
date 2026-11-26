/**
 * CatStudio — diretor de arte: o paciente deitado girado no aparelho.
 *
 * Os cortes "do aparelho" seguem os eixos do tomógrafo. Se o paciente está
 * girado na mesa (comum em criança, em decúbito oblíquo, em quem não consegue
 * deitar reto), o coronal do aparelho corta o tórax de viés. Aqui se mede
 * esse giro em torno do eixo do corpo e se monta uma cópia "virtual" do
 * volume já endireitada: os mesmos voxels, com outra orientação. Todo o resto
 * do diretor (referências, cortes, 3D) roda nela sem saber do giro.
 *
 * A medida é pela simetria: em cortes axiais na altura dos pulmões, o
 * contorno do corpo e o arcabouço ósseo da periferia são simétricos em torno
 * do eixo anteroposterior do paciente. Procura-se o ângulo desse eixo que deixa
 * a imagem mais parecida com o próprio reflexo.
 */
import type { Landmarks } from './landmarks';
import {
  makeVolume,
  sampleNearest,
  type Vec3,
  type WorldVolume,
} from './volume';

/** Grade da medida, em mm. */
const STEP = 3;
/** Quantos cortes axiais entram na medida. */
const LEVELS = 14;
/** Densidade a partir da qual é osso (UH). */
const BONE_HU = 350;
/** Faixa da periferia onde o osso conta (fração da meia largura do corpo). */
const RING = 0.32;
/** Maior giro procurado, em graus (além disso não se distingue de decúbito). */
export const MAX_ROLL = 40;
/** Abaixo disso o paciente está reto: não mexe. */
export const MIN_ROLL = 2;

export interface Roll {
  /** graus; positivo = girado no sentido de x para y */
  angle: number;
  /** ponto do eixo de giro, em mm (x, y) */
  center: [number, number];
}

interface Map2D {
  nx: number;
  ny: number;
  min: [number, number];
  /** soma, em todos os cortes, do que conta para a simetria */
  weight: Float32Array;
}

/** Em um corte: 1 = fora do corpo (ar ligado à borda). */
function outsideOf(hu: Int16Array, nx: number, ny: number): Uint8Array {
  const out = new Uint8Array(nx * ny);
  const stack: number[] = [];
  const push = (p: number) => {
    if (out[p] || hu[p] >= -300) return;
    out[p] = 1;
    stack.push(p);
  };
  for (let i = 0; i < nx; i++) {
    push(i);
    push(i + nx * (ny - 1));
  }
  for (let j = 0; j < ny; j++) {
    push(nx * j);
    push(nx * j + nx - 1);
  }
  while (stack.length) {
    const p = stack.pop()!;
    const i = p % nx;
    if (i > 0) push(p - 1);
    if (i < nx - 1) push(p + 1);
    if (p >= nx) push(p - nx);
    if (p < nx * (ny - 1)) push(p + nx);
  }
  return out;
}

/** Distância (em células, 4 vizinhos) de cada ponto do corpo até o fora. */
function depthOf(outside: Uint8Array, nx: number, ny: number): Int32Array {
  const depth = new Int32Array(outside.length).fill(-1);
  let front: number[] = [];
  outside.forEach((o, p) => {
    if (o) {
      depth[p] = 0;
      front.push(p);
    }
  });
  for (let d = 1; front.length; d++) {
    const next: number[] = [];
    front.forEach((p) => {
      const i = p % nx;
      const near = [
        i > 0 ? p - 1 : -1,
        i < nx - 1 ? p + 1 : -1,
        p - nx,
        p + nx,
      ];
      near.forEach((q) => {
        if (q < 0 || q >= nx * ny || depth[q] >= 0) return;
        depth[q] = d;
        next.push(q);
      });
    });
    front = next;
  }
  return depth;
}

function levelsOf(lm: Landmarks): number[] {
  const [low, high] =
    lm.basis === 'pulmoes'
      ? [lm.baseZ, lm.apexZ]
      : [
          lm.body[0][2] + 0.2 * (lm.body[1][2] - lm.body[0][2]),
          lm.body[1][2] - 0.2 * (lm.body[1][2] - lm.body[0][2]),
        ];
  return Array.from(
    { length: LEVELS },
    (_, n) => low + ((n + 0.5) / LEVELS) * (high - low)
  );
}

function addLevel(vol: WorldVolume, map: Map2D, z: number, ring: number) {
  const { nx, ny, min } = map;
  const hu = new Int16Array(nx * ny);
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++)
      hu[i + nx * j] = sampleNearest(
        vol,
        min[0] + i * STEP,
        min[1] + j * STEP,
        z
      );
  const outside = outsideOf(hu, nx, ny);
  const depth = depthOf(outside, nx, ny);
  for (let p = 0; p < hu.length; p++) {
    if (outside[p]) continue;
    // o contorno do corpo, mais o osso da periferia (costelas, coluna)
    const peripheralBone = hu[p] >= BONE_HU && depth[p] <= ring ? 1 : 0;
    map.weight[p] += 1 + peripheralBone;
  }
}

function symmetryMap(vol: WorldVolume, lm: Landmarks): Map2D {
  const [low, high] = lm.body;
  const min: [number, number] = [low[0] - 2 * STEP, low[1] - 2 * STEP];
  const nx = Math.round((high[0] - low[0]) / STEP) + 5;
  const ny = Math.round((high[1] - low[1]) / STEP) + 5;
  const map: Map2D = { nx, ny, min, weight: new Float32Array(nx * ny) };
  const halfWidth = Math.min(high[0] - low[0], high[1] - low[1]) / 2;
  const ring = Math.max(2, Math.round((RING * halfWidth) / STEP));
  levelsOf(lm).forEach((z) => addLevel(vol, map, z, ring));
  return map;
}

function centroid(map: Map2D): [number, number] {
  let sum = 0;
  let sx = 0;
  let sy = 0;
  map.weight.forEach((w, p) => {
    sum += w;
    sx += w * (p % map.nx);
    sy += w * Math.floor(p / map.nx);
  });
  return sum ? [sx / sum, sy / sum] : [map.nx / 2, map.ny / 2];
}

/**
 * Quanto a imagem se parece com o próprio reflexo no eixo que passa por
 * `c` (células) com o ângulo dado (graus): 1 = simétrica.
 */
export function symmetryScore(map: Map2D, c: [number, number], angle: number) {
  const a = (angle * Math.PI) / 180;
  // eixo anteroposterior do paciente girado: (−sen, cos)
  const dx = -Math.sin(a);
  const dy = Math.cos(a);
  let match = 0;
  let total = 0;
  for (let j = 0; j < map.ny; j++)
    for (let i = 0; i < map.nx; i++) {
      const w = map.weight[i + map.nx * j];
      if (!w) continue;
      total += w * w;
      const qx = i - c[0];
      const qy = j - c[1];
      const along = qx * dx + qy * dy;
      const ri = Math.round(c[0] + 2 * along * dx - qx);
      const rj = Math.round(c[1] + 2 * along * dy - qy);
      if (ri >= 0 && rj >= 0 && ri < map.nx && rj < map.ny)
        match += w * map.weight[ri + map.nx * rj];
    }
  return total ? match / total : 0;
}

function bestAngle(map: Map2D, c: [number, number]): number {
  // um empate entre ângulos fica com o menor giro
  const score = (angle: number) =>
    symmetryScore(map, c, angle) - 0.0004 * Math.abs(angle);
  let best = 0;
  for (let angle = -MAX_ROLL; angle <= MAX_ROLL; angle += 1)
    if (score(angle) > score(best)) best = angle;
  let fine = best;
  for (let angle = best - 1; angle <= best + 1; angle += 0.25)
    if (score(angle) > score(fine)) fine = angle;
  return fine;
}

/** Mede o giro do paciente em torno do eixo do corpo. */
export function estimateRoll(vol: WorldVolume, lm: Landmarks): Roll {
  const map = symmetryMap(vol, lm);
  const c = centroid(map);
  const angle = bestAngle(map, c);
  return {
    angle: Math.abs(angle) < MIN_ROLL ? 0 : angle,
    center: [map.min[0] + c[0] * STEP, map.min[1] + c[1] * STEP],
  };
}

/** Gira (x, y) em torno de `center` por `angle` graus; z não muda. */
export function rotateXY(
  p: Vec3,
  center: [number, number],
  angle: number
): Vec3 {
  const a = (angle * Math.PI) / 180;
  const x = p[0] - center[0];
  const y = p[1] - center[1];
  return [
    center[0] + x * Math.cos(a) - y * Math.sin(a),
    center[1] + x * Math.sin(a) + y * Math.cos(a),
    p[2],
  ];
}

/**
 * O mesmo volume, visto por um paciente endireitado: os voxels não mudam,
 * só a orientação (gira de volta o giro medido).
 */
export function alignedVolume(vol: WorldVolume, roll: Roll): WorldVolume {
  if (!roll.angle) return vol;
  const back = -roll.angle;
  const origin = rotateXY(vol.origin, roll.center, back);
  const axes = vol.axes.map((axis) => rotateXY(axis, [0, 0], back)) as [
    Vec3,
    Vec3,
    Vec3,
  ];
  return makeVolume(vol.data, vol.dims, origin, axes);
}

/** Aviso do giro do paciente no aparelho, se houver. */
export function rollNotes(angle: number): string[] {
  if (!angle) return [];
  const side = angle > 0 ? 'anti-horário' : 'horário';
  return [
    `O paciente está girado ${Math.round(Math.abs(angle))}° (sentido ${side}, visto dos pés) no aparelho. Os cortes saem alinhados ao paciente; peça "do aparelho" para usar os eixos do tomógrafo.`,
  ];
}
