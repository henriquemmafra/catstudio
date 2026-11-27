/**
 * CatStudio — "Só pulmões" e "Só coração" na vista 3D: acha a região do órgão
 * (a mesma conta do diretor de arte para os pulmões; o coração sai deles, ver
 * chest.ts) e esconde todo o resto.
 */
import { inLungs, type LungMask } from '@/src/catstudio/director/landmarks';
import { findHeartMask } from './chest';
import { chestOf } from './chestImage';
import { keepRegion, type SculptTarget } from './tools';

export const LUNG_PALETTE = 'diretor-pulmao';

function keepMask(target: SculptTarget, mask: LungMask) {
  keepRegion(target, (x, y, z) => inLungs(mask, x, y, z));
}

/** Deixa só os pulmões. Devolve a frase a mostrar. */
export function keepLungs(target: SculptTarget): string {
  const { lungs, found } = chestOf(target.base);
  if (!found) throw new Error('não achei os pulmões neste exame.');
  keepMask(target, lungs);
  return 'Só os pulmões. Desfazer traz o resto de volta.';
}

/** Deixa só o coração (aproximado). Devolve a frase a mostrar. */
export function keepHeart(target: SculptTarget): string {
  const { vol, lungs, found } = chestOf(target.base);
  if (!found)
    throw new Error(
      'preciso dos pulmões para achar o coração, e não os achei.'
    );
  const heart = findHeartMask(vol, lungs);
  if (!heart.mask.some((v) => v === 1))
    throw new Error('não achei o coração neste exame.');
  keepMask(target, heart);
  return 'Só o coração (aproximado: acerte com a borracha). Desfazer traz o resto.';
}
