/**
 * CatStudio — os pulmões e as zonas do tórax (ver chest.ts) a partir do
 * volume que a vista 3D desenha.
 */
import type vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import type { Vec3, WorldVolume } from '@/src/catstudio/director/volume';
import { volumeFromImage } from '@/src/catstudio/director/volume';
import {
  coarseGrid,
  findLungMask,
  type LungMask,
} from '@/src/catstudio/director/landmarks';
import { cellAt, chestZones } from './chest';

export function chestOf(base: vtkImageData) {
  const dims = base.getDimensions() as Vec3;
  const data = base.getPointData().getScalars().getData();
  const vol = volumeFromImage(base, data, dims);
  const lungs = findLungMask(vol);
  return { vol, lungs, found: lungs.mask.some((v) => v === 1) };
}

/**
 * Num tórax de verdade os pulmões ocupam boa parte dos cortes em que
 * aparecem; gás intestinal (que a busca pode tomar por pulmão) não. Abaixo
 * disto a regra da parede não é usada.
 */
export const CHEST_LUNG_SHARE = 0.15;

/** Fração dos cortes com "pulmão" que é pulmão (o resto é tecido). */
export function lungShare(vol: WorldVolume, lungs: LungMask): number {
  const grid = coarseGrid(vol, lungs.step);
  const perSlice = lungs.n[0] * lungs.n[1];
  let lung = 0;
  let tissue = 0;
  for (let k = 0; k < lungs.n[2]; k++) {
    const slice = lungs.mask.subarray(k * perSlice, (k + 1) * perSlice);
    if (!slice.includes(1)) continue;
    for (let o = 0; o < perSlice; o++) {
      lung += slice[o];
      if (!slice[o] && grid.hu[k * perSlice + o] > -300) tissue += 1;
    }
  }
  return lung / Math.max(1, lung + tissue);
}

/**
 * Zona de cada voxel do volume no tórax (0 = fora da altura dos pulmões,
 * 1 = parede, 2 = dentro); undefined se o exame não tem pulmões.
 */
export function chestZoneOf(base: vtkImageData) {
  const { vol, lungs, found } = chestOf(base);
  if (!found || lungShare(vol, lungs) < CHEST_LUNG_SHARE) return undefined;
  const zones = chestZones(lungs);
  const [nx, ny] = base.getDimensions();
  const m = base.getIndexToWorld();
  return (index: number) => {
    const i = index % nx;
    const j = Math.floor(index / nx) % ny;
    const k = Math.floor(index / (nx * ny));
    return cellAt(lungs, zones, [
      m[0] * i + m[4] * j + m[8] * k + m[12],
      m[1] * i + m[5] * j + m[9] * k + m[13],
      m[2] * i + m[6] * j + m[10] * k + m[14],
    ]);
  };
}
