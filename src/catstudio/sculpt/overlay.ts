/**
 * CatStudio — o que foi apagado e destacado no 3D, mostrado também nos cortes
 * 2D (para conferir com precisão onde a ferramenta pegou).
 */
import { reactive, watch } from 'vue';

export const ERASED = 1;
export const HIGHLIGHTED = 2;
export const ERASED_COLOR = '#2f6fed';

const KEY = 'catstudio.2d.mostrarEscultura';

function stored(): boolean {
  try {
    return localStorage.getItem(KEY) !== '0';
  } catch {
    return true;
  }
}

export const sliceOverlay = reactive({ enabled: stored() });

watch(
  () => sliceOverlay.enabled,
  (on) => {
    try {
      localStorage.setItem(KEY, on ? '1' : '0');
    } catch {
      // sem armazenamento: vale só nesta sessão
    }
  }
);

/** Ar apagado (fora do corpo, mesa oca) não é pintado: só polui o corte. */
export const AIR_HU = -400;

/**
 * Preenche `out` com 0 (nada), 1 (apagado) ou 2 (destacado; o destaque ganha
 * do apagado). O apagado só é marcado onde há tecido (`density` acima de
 * AIR_HU). Devolve quantos voxels ficaram marcados.
 */
export function overlayLabels(
  masks: { hidden: Uint8Array | null; highlight: Uint8Array | null },
  density: ArrayLike<number> | null,
  out: Uint8Array
): number {
  const { hidden, highlight } = masks;
  let marked = 0;
  for (let i = 0; i < out.length; i++) {
    let label = 0;
    if (highlight?.[i]) label = HIGHLIGHTED;
    else if (hidden?.[i] && (!density || density[i] > AIR_HU)) label = ERASED;
    out[i] = label;
    if (label) marked += 1;
  }
  return marked;
}

export const hexToUnit = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16) / 255,
  parseInt(hex.slice(3, 5), 16) / 255,
  parseInt(hex.slice(5, 7), 16) / 255,
];
