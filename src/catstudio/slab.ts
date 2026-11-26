/**
 * CatStudio — MIP e MinIP em espessura nas vistas 2D.
 *
 * Cada vista 2D pode trocar o corte fino por uma projeção de uma fatia
 * espessa centrada no corte atual: máxima intensidade (MIP, vasos e nódulos)
 * ou mínima intensidade (MinIP, vias aéreas e enfisema). A projeção é feita
 * na placa de vídeo sobre o volume original; nada é recalculado ao rolar.
 */
import { reactive } from 'vue';

export type SlabMode = 'off' | 'max' | 'min';

export interface SlabState {
  mode: SlabMode;
  /** espessura em mm */
  thickness: number;
}

export const SLAB_LABEL: Record<Exclude<SlabMode, 'off'>, string> = {
  max: 'MIP',
  min: 'MinIP',
};

/** Espessura inicial de cada projeção, em mm. */
export const SLAB_DEFAULT_THICKNESS: Record<
  Exclude<SlabMode, 'off'>,
  number
> = {
  max: 10,
  min: 5,
};

export const SLAB_MIN_THICKNESS = 1;
export const SLAB_MAX_THICKNESS = 100;

const states = reactive<Record<string, SlabState>>({});
// a espessura escolhida para cada projeção vale para as próximas vezes
const lastThickness = { ...SLAB_DEFAULT_THICKNESS };

const OFF: SlabState = Object.freeze({ mode: 'off', thickness: 0 });

export function slabFor(viewID: string): SlabState {
  return states[viewID] ?? OFF;
}

export function setSlab(viewID: string, mode: SlabMode) {
  if (mode === 'off') {
    delete states[viewID];
    return;
  }
  states[viewID] = { mode, thickness: lastThickness[mode] };
}

/** Liga a projeção na vista; repetir o mesmo modo desliga. */
export function toggleSlab(viewID: string, mode: Exclude<SlabMode, 'off'>) {
  setSlab(viewID, slabFor(viewID).mode === mode ? 'off' : mode);
}

export function clampThickness(mm: number) {
  if (!Number.isFinite(mm)) return SLAB_MIN_THICKNESS;
  return Math.min(SLAB_MAX_THICKNESS, Math.max(SLAB_MIN_THICKNESS, mm));
}

export function setSlabThickness(viewID: string, mm: number) {
  const state = states[viewID];
  if (!state || state.mode === 'off') return;
  state.thickness = clampThickness(mm);
  lastThickness[state.mode] = state.thickness;
}

/** Passo da espessura: fino nas fatias finas, maior nas espessas. */
export function thicknessStep(mm: number) {
  if (mm < 5) return 1;
  if (mm < 20) return 2.5;
  return 5;
}

export function stepSlabThickness(viewID: string, direction: 1 | -1) {
  const state = states[viewID];
  if (!state || state.mode === 'off') return;
  const step = thicknessStep(
    direction > 0 ? state.thickness : state.thickness - 0.01
  );
  setSlabThickness(viewID, state.thickness + direction * step);
}

export function clearSlabs() {
  Object.keys(states).forEach((id) => delete states[id]);
}

/** Só para os testes: volta as espessuras lembradas ao padrão. */
export function resetSlabMemory() {
  clearSlabs();
  Object.assign(lastThickness, SLAB_DEFAULT_THICKNESS);
}
