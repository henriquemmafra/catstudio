/**
 * CatStudio — estado interno exposto para os testes ponta a ponta
 * (`window.__catstudio`). Estado da interface e a posição da mira; nenhum dado
 * do exame passa por aqui.
 */
import {
  guardStatus,
  LADDER,
  FRAME_BUDGET_MS,
} from '@/src/catstudio/renderGuard';
import { useCrosshairsToolStore } from '@/src/store/tools/crosshairs';
import { useViewStore } from '@/src/store/views';
import { examModes } from '@/src/catstudio/examMode';
import { slabFor } from '@/src/catstudio/slab';
import { performanceSettings } from '@/src/catstudio/performance';
import { layerViews, sculptSummary } from '@/src/catstudio/sculpt/state';

/** A tela de vídeo compartilhada, para o teste de perda de contexto. */
export const debugGl: { canvas: HTMLCanvasElement | null } = { canvas: null };

function loseGlContext(): boolean {
  const gl = debugGl.canvas?.getContext('webgl2');
  const extension = gl?.getExtension('WEBGL_lose_context');
  extension?.loseContext();
  return !!extension;
}

/** Põe o cruzamento dos cortes num ponto (mm), como a ferramenta de mira. */
function crossAt(point: [number, number, number]) {
  const crosshairs = useCrosshairsToolStore();
  useViewStore()
    .getAllViews()
    .forEach((view) => crosshairs.setPosition(point, view.id));
}

export function installDebugHook() {
  (globalThis as any).__catstudio = {
    guard: (viewID: string) => ({ ...guardStatus(viewID) }),
    slab: (viewID: string) => ({ ...slabFor(viewID) }),
    performance: () => performanceSettings.mode,
    sculpt: (imageID: string) => ({ ...sculptSummary(imageID) }),
    layers: (imageID: string) =>
      JSON.parse(JSON.stringify(layerViews[imageID] ?? null)),
    loseGlContext,
    crossAt,
    examModes,
    LADDER,
    FRAME_BUDGET_MS,
  };
}
