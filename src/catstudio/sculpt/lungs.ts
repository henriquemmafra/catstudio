/**
 * CatStudio — "Só pulmões" na vista 3D: acha a região dos pulmões (a mesma
 * conta do diretor de arte) e esconde todo o resto. As cores ficam por conta
 * de quem chama (a paleta "Diretor: pulmões").
 */
import type { Vec3 } from '@/src/catstudio/director/volume';
import { volumeFromImage } from '@/src/catstudio/director/volume';
import { findLungMask, inLungs } from '@/src/catstudio/director/landmarks';
import { keepRegion, type SculptTarget } from './tools';

export const LUNG_PALETTE = 'diretor-pulmao';

/** Deixa só os pulmões. Devolve a frase a mostrar. */
export function keepLungs(target: SculptTarget): string {
  const { base } = target;
  const dims = base.getDimensions() as Vec3;
  const data = base.getPointData().getScalars().getData();
  const lungs = findLungMask(volumeFromImage(base, data, dims));
  if (!lungs.mask.some((v) => v === 1))
    throw new Error('não achei os pulmões neste exame.');
  keepRegion(target, (x, y, z) => inLungs(lungs, x, y, z));
  return 'Só os pulmões. Desfazer traz o resto de volta.';
}
