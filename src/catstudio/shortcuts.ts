/**
 * CatStudio — ações dos atalhos de leitura: janelas de TC (1 a 6), MIP (M),
 * MinIP (N) e resetar (X).
 */
import { WLPresetsCT } from '@/src/constants';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { triggerResetViews } from '@/src/components/tools/ResetViews.vue';
import {
  sharesSourceWindowing,
  useWindowingStore,
} from '@/src/store/view-configs/windowing';
import { useViewStore } from '@/src/store/views';
import {
  clearSlabs,
  slabFor,
  setSlab,
  toggleSlab,
  type SlabMode,
} from '@/src/catstudio/slab';

/** Janelas na ordem do menu; a tecla N aplica a N-ésima. */
export const WINDOW_SHORTCUTS = Object.entries(WLPresetsCT).map(
  ([name, wl]) => ({ name, ...wl })
);

/** Vistas 2D visíveis que mostram a imagem atual. */
function sliceViews() {
  const viewStore = useViewStore();
  const { currentImageID } = useCurrentImage();
  return viewStore.visibleViews.filter(
    (view) => view.type === '2D' && view.dataID === currentImageID.value
  );
}

/**
 * Vista de onde a janela é aplicada. A janela é sincronizada entre as vistas
 * da mesma imagem, então basta uma; a ativa tem preferência.
 */
function windowingView() {
  const viewStore = useViewStore();
  const { currentImageID } = useCurrentImage();
  const active = viewStore.getView(viewStore.activeView);
  if (
    active &&
    active.type === '2D' &&
    active.dataID === currentImageID.value &&
    sharesSourceWindowing(active)
  )
    return active;
  return sliceViews()[0] ?? null;
}

export function applyWindowPreset(index: number) {
  const preset = WINDOW_SHORTCUTS[index];
  const view = windowingView();
  const { currentImageID } = useCurrentImage();
  if (!preset || !view || !currentImageID.value) return;
  useWindowingStore().updateConfig(
    view.id,
    currentImageID.value,
    { width: preset.width, level: preset.level },
    true
  );
}

/**
 * MIP/MinIP na vista ativa; sem vista 2D ativa, em todas as 2D visíveis
 * (ligam ou desligam juntas, pela primeira).
 */
export function toggleSlabOnActiveView(mode: Exclude<SlabMode, 'off'>) {
  const viewStore = useViewStore();
  const views = sliceViews();
  const active = views.find((view) => view.id === viewStore.activeView);
  if (active) {
    toggleSlab(active.id, mode);
    return;
  }
  if (!views.length) return;
  const turnOff = slabFor(views[0].id).mode === mode;
  views.forEach((view) => setSlab(view.id, turnOff ? 'off' : mode));
}

/** Câmeras recentralizadas, janela de volta ao padrão e corte fino. */
export function resetAllViews() {
  clearSlabs();
  triggerResetViews();
  const view = windowingView();
  const { currentImageID } = useCurrentImage();
  if (view && currentImageID.value)
    useWindowingStore().resetContrast(view.id, currentImageID.value);
}
