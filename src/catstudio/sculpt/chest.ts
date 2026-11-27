/**
 * CatStudio — o tórax visto pelos pulmões (heurística, sem IA):
 *
 *  - a "caixa" do tórax: o que fica entre os pulmões e dentro do contorno
 *    deles. O que é denso do lado de fora dessa caixa, na altura dos pulmões,
 *    é parede: costela, esterno, escápula, clavícula.
 *  - o coração: o maior bloco grosso de partes moles entre os dois pulmões.
 */
import type { Vec3, WorldVolume } from '@/src/catstudio/director/volume';
import {
  coarseGrid,
  components,
  largestLabel,
  type LungMask,
} from '@/src/catstudio/director/landmarks';
import { dilateWithin, erode } from './body';

/** fora da altura dos pulmões: a regra da parede não vale */
export const ZONE_NONE = 0;
export const ZONE_WALL = 1;
export const ZONE_INSIDE = 2;

/** Marca em `foot` o que fica entre o primeiro e o último pulmão da linha. */
function span(
  lung: (at: number) => number,
  count: number,
  mark: (at: number) => void
) {
  let first = -1;
  let last = -1;
  for (let at = 0; at < count; at++)
    if (lung(at)) {
      if (first < 0) first = at;
      last = at;
    }
  for (let at = first; first >= 0 && at <= last; at++) mark(at);
  return first >= 0;
}

/** Soma ao contorno `foot` o deste corte; devolve se o corte tem pulmão. */
function addSlice(lungs: LungMask, k: number, foot: Uint8Array): boolean {
  const [nx, ny] = lungs.n;
  const base = k * nx * ny;
  let any = false;
  for (let j = 0; j < ny; j++) {
    const row = j * nx;
    const found = span(
      (i) => lungs.mask[base + row + i],
      nx,
      (i) => {
        foot[row + i] = 1;
      }
    );
    any = any || found;
  }
  for (let i = 0; any && i < nx; i++)
    span(
      (j) => lungs.mask[base + i + nx * j],
      ny,
      (j) => {
        foot[i + nx * j] = 1;
      }
    );
  return any;
}

/**
 * Zona de cada célula da grade dos pulmões. O contorno vai acumulando de cima
 * para baixo (o tórax alarga para baixo e os pulmões afinam na base), para o
 * fígado e o baço sob o diafragma continuarem "dentro".
 */
export function chestZones(lungs: LungMask): Uint8Array {
  const [nx, ny, nz] = lungs.n;
  const zones = new Uint8Array(lungs.mask.length);
  const foot = new Uint8Array(nx * ny);
  for (let k = nz - 1; k >= 0; k--) {
    if (!addSlice(lungs, k, foot)) continue;
    const base = k * nx * ny;
    for (let o = 0; o < foot.length; o++)
      zones[base + o] = foot[o] ? ZONE_INSIDE : ZONE_WALL;
  }
  return zones;
}

/** Valor da célula da grade mais próxima do ponto (mm); fora da grade: 0. */
export function cellAt(
  lungs: Pick<LungMask, 'n' | 'min' | 'step'>,
  cells: Uint8Array,
  point: Vec3
): number {
  const [nx, ny, nz] = lungs.n;
  const i = Math.round((point[0] - lungs.min[0]) / lungs.step);
  const j = Math.round((point[1] - lungs.min[1]) / lungs.step);
  const k = Math.round((point[2] - lungs.min[2]) / lungs.step);
  if (Math.min(i, j, k) < 0 || i >= nx || j >= ny || k >= nz) return 0;
  return cells[i + nx * (j + ny * k)];
}

// ---------- coração ----------

/** Só os cortes em que os pulmões têm pelo menos esta fração da área máxima. */
const LUNG_AREA_SHARE = 0.4;
/** Raio do "bloco grosso", como fração da largura dos pulmões. */
const CORE_SHARE = 0.06;
/** acima da gordura: a gordura do mediastino não entra */
const TISSUE_HU = -30;

interface LungBox {
  areas: Float64Array;
  x: [number, number];
  y: [number, number];
  ySum: number;
  count: number;
}

function lungBox(lungs: LungMask): LungBox {
  const [nx, ny, nz] = lungs.n;
  const box: LungBox = {
    areas: new Float64Array(nz),
    x: [nx, -1],
    y: [ny, -1],
    ySum: 0,
    count: 0,
  };
  for (let o = 0; o < lungs.mask.length; o++) {
    if (!lungs.mask[o]) continue;
    const i = o % nx;
    const j = Math.floor(o / nx) % ny;
    box.areas[Math.floor(o / (nx * ny))] += 1;
    box.x = [Math.min(box.x[0], i), Math.max(box.x[1], i)];
    box.y = [Math.min(box.y[0], j), Math.max(box.y[1], j)];
    box.ySum += j;
    box.count += 1;
  }
  return box;
}

/**
 * Candidatos a coração num corte: partes moles com pulmão dos dois lados na
 * mesma linha, sem passar muito para trás (onde ficam a coluna e a aorta
 * descendente).
 */
function candidatesIn(
  slice: { lungs: LungMask; hu: Int16Array; k: number; backRow: number },
  out: Uint8Array
) {
  const { lungs, hu, k } = slice;
  const [nx, ny] = lungs.n;
  const base = k * nx * ny;
  for (let j = 0; j < Math.min(ny, slice.backRow + 1); j++) {
    const row = base + j * nx;
    span(
      (i) => lungs.mask[row + i],
      nx,
      (i) => {
        if (!lungs.mask[row + i] && hu[row + i] > TISSUE_HU) out[row + i] = 1;
      }
    );
  }
}

/**
 * Região do coração, na grade dos pulmões. Pega junto a raiz dos grandes
 * vasos e, embaixo, pode levar uma fatia do fígado: é ponto de partida para
 * acertar com a borracha, não segmentação de verdade.
 */
export function findHeartMask(vol: WorldVolume, lungs: LungMask): LungMask {
  const { n } = lungs;
  const grid = coarseGrid(vol, lungs.step);
  const box = lungBox(lungs);
  let candidates: Uint8Array = new Uint8Array(lungs.mask.length);
  const empty = { ...lungs, mask: candidates };
  if (!box.count || grid.hu.length !== candidates.length) return empty;
  const most = Math.max(...box.areas);
  // y cresce para trás: até um pouco atrás do centro dos pulmões
  const backRow = Math.round(
    box.ySum / box.count + 0.15 * (box.y[1] - box.y[0])
  );
  for (let k = 0; k < n[2]; k++)
    if (box.areas[k] >= LUNG_AREA_SHARE * most)
      candidatesIn({ lungs, hu: grid.hu, k, backRow }, candidates);
  const radius = Math.max(2, Math.round(CORE_SHARE * (box.x[1] - box.x[0])));
  let core = candidates;
  for (let r = 0; r < radius; r++) core = erode(core, n);
  const blobs = components(grid, (o) => core[o] === 1);
  const heart = largestLabel(blobs.sizes);
  if (!heart) return empty;
  let mask: Uint8Array = new Uint8Array(core.length);
  for (let o = 0; o < mask.length; o++)
    mask[o] = blobs.labels[o] === heart ? 1 : 0;
  for (let r = 0; r < radius + 1; r++) mask = dilateWithin(mask, candidates, n);
  candidates = mask;
  return { ...lungs, mask: candidates };
}
