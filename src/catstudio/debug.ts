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

export function installDebugHook() {
  (globalThis as any).__catstudio = {
    guard: (viewID: string) => ({ ...guardStatus(viewID) }),
    slab: (viewID: string) => ({ ...slabFor(viewID) }),
    performance: () => performanceSettings.mode,
    LADDER,
    FRAME_BUDGET_MS,
  };
}
