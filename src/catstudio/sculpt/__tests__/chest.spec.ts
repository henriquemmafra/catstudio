import { describe, expect, it } from 'vitest';
import { makeVolume, type Vec3 } from '@/src/catstudio/director/volume';
import { findLungMask, inLungs } from '@/src/catstudio/director/landmarks';
import {
  ZONE_INSIDE,
  ZONE_WALL,
  cellAt,
  chestZones,
  findHeartMask,
} from '../chest';
import { detectBone } from '../bone';
import { CHEST_LUNG_SHARE, lungShare } from '../chestImage';

/**
 * Tórax de teste (LPS, mm; passo de 4): corpo elíptico, dois pulmões, coração
 * contrastado (300 UH, homogêneo) entre eles, gordura em volta, coluna atrás (medular 250,
 * cortical 800) com a aorta contrastada encostada nela, costelas finas e
 * pouco densas (260 UH) na parede, e fígado (60 UH) sob o pulmão direito.
 */
const STEP = 4;
const ORIGIN: Vec3 = [-180, -120, 0];
const DIMS: Vec3 = [91, 61, 76];
const HEART: Vec3 = [15, -25, 150];
const SPINE: Vec3 = [0, 48, 0];
const AORTA: Vec3 = [24, 24, 0];

const ball = (p: Vec3, c: Vec3, r: Vec3) =>
  ((p[0] - c[0]) / r[0]) ** 2 +
  ((p[1] - c[1]) / r[1]) ** 2 +
  ((p[2] - c[2]) / r[2]) ** 2;

function bone(p: Vec3): number | null {
  const spine = Math.hypot(p[0] - SPINE[0], p[1] - SPINE[1]);
  if (spine < 18) return spine > 10 ? 800 : 250;
  if (Math.hypot(p[0] - AORTA[0], p[1] - AORTA[1]) < 12) return 320;
  // costelas: anéis finos na parede, a cada 24 mm
  const shell = (p[0] / 150) ** 2 + (p[1] / 95) ** 2;
  const rib = p[2] % 24 < 8 && shell > 0.86 && shell < 0.97;
  return rib ? 260 : null;
}

function density(p: Vec3): number {
  if ((p[0] / 165) ** 2 + (p[1] / 105) ** 2 > 1) return -1000;
  const dense = bone(p);
  if (dense !== null) return dense;
  if (ball(p, HEART, [48, 35, 45]) < 1) return 300;
  // fígado: cúpula sob o pulmão direito
  if (ball(p, [-60, 0, 40], [75, 80, 60]) < 1) return 60;
  const lung = (cx: number) => ball(p, [cx, 5, 170], [52, 62, 110]) < 1;
  if (lung(-78) || lung(78)) return -850;
  // o resto é gordura (mediastino, parede)
  return -90;
}

function chest() {
  const data = new Int16Array(DIMS[0] * DIMS[1] * DIMS[2]);
  let o = 0;
  for (let k = 0; k < DIMS[2]; k++)
    for (let j = 0; j < DIMS[1]; j++)
      for (let i = 0; i < DIMS[0]; i++) {
        data[o] = density([
          ORIGIN[0] + i * STEP,
          ORIGIN[1] + j * STEP,
          ORIGIN[2] + k * STEP,
        ]);
        o += 1;
      }
  const vol = makeVolume(data, DIMS, ORIGIN, [
    [STEP, 0, 0],
    [0, STEP, 0],
    [0, 0, STEP],
  ]);
  return { vol, data, lungs: findLungMask(vol, STEP) };
}

const indexOf = (p: Vec3) =>
  Math.round((p[0] - ORIGIN[0]) / STEP) +
  DIMS[0] *
    (Math.round((p[1] - ORIGIN[1]) / STEP) +
      DIMS[1] * Math.round((p[2] - ORIGIN[2]) / STEP));

describe('tórax pelos pulmões', () => {
  const { vol, data, lungs } = chest();
  const zones = chestZones(lungs);
  const zoneAt = (p: Vec3) => cellAt(lungs, zones, p);

  it('zonas: coração, coluna e fígado dentro; costela na parede', () => {
    expect(zoneAt(HEART)).toBe(ZONE_INSIDE);
    expect(zoneAt([0, 48, 150])).toBe(ZONE_INSIDE);
    expect(zoneAt([-60, 0, 80])).toBe(ZONE_INSIDE);
    expect(zoneAt([-143, 0, 148])).toBe(ZONE_WALL);
    expect(zoneAt([0, -90, 148])).toBe(ZONE_WALL);
  });

  it('é tórax: os pulmões ocupam boa parte dos cortes', () => {
    expect(lungShare(vol, lungs)).toBeGreaterThan(CHEST_LUNG_SHARE);
    // um bolsão de gás pequeno não faz do exame um tórax
    const gas = { ...lungs, mask: new Uint8Array(lungs.mask.length) };
    const [nx, ny] = lungs.n;
    for (let k = 20; k < 26; k++)
      for (let j = 28; j < 34; j++)
        for (let i = 40; i < 46; i++) gas.mask[i + nx * (j + ny * k)] = 1;
    expect(lungShare(vol, gas)).toBeLessThan(CHEST_LUNG_SHARE);
  });

  it('só coração: pega o coração, não pulmão, coluna nem costela', () => {
    const heart = findHeartMask(vol, lungs);
    const inside = (p: Vec3) => inLungs(heart, p[0], p[1], p[2]);
    expect(inside(HEART)).toBe(true);
    expect(inside([HEART[0] + 30, HEART[1], HEART[2]])).toBe(true);
    expect(inside([78, 5, 200])).toBe(false);
    expect(inside([0, 48, 150])).toBe(false);
    expect(inside([-143, 0, 148])).toBe(false);
    // o fígado lá embaixo fica de fora
    expect(inside([-60, 0, 20])).toBe(false);
    const cells = heart.mask.reduce((sum, v) => sum + v, 0);
    const ml = (cells * STEP ** 3) / 1000;
    // o coração do teste tem ~320 cm³
    expect(ml).toBeGreaterThan(200);
    expect(ml).toBeLessThan(700);
  });

  it('osso: costela fina e coluna encostada na aorta; coração não', () => {
    const grid = {
      dims: DIMS,
      scalars: data,
      hidden: new Uint8Array(data.length),
    };
    const zone = (index: number) => {
      const i = index % DIMS[0];
      const j = Math.floor(index / DIMS[0]) % DIMS[1];
      const k = Math.floor(index / (DIMS[0] * DIMS[1]));
      return zoneAt([
        ORIGIN[0] + i * STEP,
        ORIGIN[1] + j * STEP,
        ORIGIN[2] + k * STEP,
      ]);
    };
    const rib = indexOf([-143, 0, 148]);
    const cortex = indexOf([0, 62, 148]);
    const blood = indexOf(HEART);
    const aorta = indexOf([AORTA[0] + 4, AORTA[1] - 4, 148]);
    // a aorta e a coluna formam uma estrutura só (senão o teste não vale)
    const joined = detectBone(grid, { low: 200, minVoxels: 1e9 });
    expect(joined.voxels).toBe(0);
    // sem as zonas, a costela fina não passa por osso
    const plain = detectBone(grid, { low: 200, minVoxels: 20 });
    expect(plain.label[rib]).toBe(0);
    const { label } = detectBone(grid, { low: 200, minVoxels: 20, zone });
    expect(label[rib]).toBe(1);
    expect(label[cortex]).toBe(1);
    expect(label[blood]).toBe(0);
    expect(label[aorta]).not.toBe(1);
  });
});
