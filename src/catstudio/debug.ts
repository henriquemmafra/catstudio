/**
 * CatStudio — estado interno exposto para os testes ponta a ponta
 * (`window.__catstudio`). Só leitura de estado da interface; nenhum dado do
 * exame passa por aqui.
 */
import {
  guardStatus,
  LADDER,
  FRAME_BUDGET_MS,
} from '@/src/catstudio/renderGuard';
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

export function installDebugHook() {
  (globalThis as any).__catstudio = {
    guard: (viewID: string) => ({ ...guardStatus(viewID) }),
    slab: (viewID: string) => ({ ...slabFor(viewID) }),
    performance: () => performanceSettings.mode,
    sculpt: (imageID: string) => ({ ...sculptSummary(imageID) }),
    layers: (imageID: string) =>
      JSON.parse(JSON.stringify(layerViews[imageID] ?? null)),
    loseGlContext,
    LADDER,
    FRAME_BUDGET_MS,
  };
}
