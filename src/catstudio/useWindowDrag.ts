/**
 * CatStudio — janela do 3D com os dois botões do mouse.
 *
 * Com o botão esquerdo e o direito apertados juntos, arrastar mexe na curva
 * de opacidade do preset, como a janela nas vistas 2D:
 *  - para cima/baixo: nível — a curva anda para tecidos menos/mais densos;
 *  - para a direita/esquerda: mais/menos opaco.
 * Só vale para presets de pontos (os de TC); nos outros o gesto não faz nada.
 */
import { type Ref, reactive } from 'vue';
import { useEventListener } from '@vueuse/core';
import vtkPiecewiseFunctionProxy from '@kitware/vtk.js/Proxy/Core/PiecewiseFunctionProxy';
import type { Maybe } from '@/src/types';
import useVolumeColoringStore from '@/src/store/view-configs/volume-coloring';

export interface CurveShift {
  /** deslocamento horizontal, em frações da faixa de valores do exame */
  shift: number;
  /** quanto é subtraído da opacidade */
  shiftAlpha: number;
}

/** pixels de arrasto para andar a faixa inteira de valores */
export const LEVEL_PIXELS = 1500;
/** pixels de arrasto para ir de opaco a transparente */
export const OPACITY_PIXELS = 500;

const clamp = (value: number, low: number, high: number) =>
  Math.min(high, Math.max(low, value));

/**
 * Curva depois de arrastar (dx, dy) pixels de tela (y para baixo) a partir
 * de `start`.
 */
export function draggedCurve(
  start: CurveShift,
  dx: number,
  dy: number
): CurveShift {
  return {
    shift: clamp(start.shift + dy / LEVEL_PIXELS, -1, 1),
    shiftAlpha: clamp(start.shiftAlpha - dx / OPACITY_PIXELS, -1, 1),
  };
}

const BOTH_BUTTONS = 3;

export function useWindowDrag(
  container: Ref<Maybe<HTMLElement>>,
  viewID: Ref<string>,
  imageID: Ref<Maybe<string>>
) {
  const store = useVolumeColoringStore();
  const status = reactive({ active: false, level: 0, opacity: 0 });
  let origin: { x: number; y: number; curve: CurveShift } | null = null;
  // depois de soltar um dos botões, o outro não pode "pular" a rotação
  let swallowing = false;

  const currentCurve = (): CurveShift | null => {
    const id = imageID.value;
    const opacity = id && store.getConfig(viewID.value, id)?.opacityFunction;
    if (!opacity || opacity.mode !== vtkPiecewiseFunctionProxy.Mode.Points)
      return null;
    return { shift: opacity.shift, shiftAlpha: opacity.shiftAlpha };
  };

  const inside = (event: Event) =>
    !!container.value && container.value.contains(event.target as Node);

  const stop = (event: Event) => {
    event.stopPropagation();
    event.preventDefault();
  };

  // O segundo botão apertado com o primeiro já embaixo não gera "pointerdown":
  // pela norma dos Pointer Events ele chega como "pointermove" com os dois
  // botões marcados. Por isso o gesto começa nos dois eventos.
  const start = (event: PointerEvent) => {
    if (swallowing || event.buttons !== BOTH_BUTTONS || !inside(event))
      return false;
    const curve = currentCurve();
    if (!curve) return false;
    origin = { x: event.clientX, y: event.clientY, curve };
    swallowing = true;
    status.active = true;
    return true;
  };

  useEventListener(
    window,
    'pointerdown',
    (event: PointerEvent) => {
      if (start(event)) stop(event);
    },
    { capture: true }
  );

  const apply = (event: PointerEvent) => {
    if (!origin || !imageID.value) return;
    const next = draggedCurve(
      origin.curve,
      event.clientX - origin.x,
      event.clientY - origin.y
    );
    const [low, high] = store.getConfig(viewID.value, imageID.value)
      ?.opacityFunction.mappingRange ?? [0, 1];
    status.level = Math.round(next.shift * (high - low));
    status.opacity = Math.round(-next.shiftAlpha * 100);
    store.updateOpacityFunction(viewID.value, imageID.value, next);
  };

  useEventListener(
    window,
    'pointermove',
    (event: PointerEvent) => {
      if (!swallowing && !start(event)) return;
      stop(event);
      if (event.buttons === BOTH_BUTTONS) apply(event);
      else {
        origin = null;
        status.active = false;
      }
      if (event.buttons === 0) swallowing = false;
    },
    { capture: true }
  );

  useEventListener(
    window,
    'pointerup',
    (event: PointerEvent) => {
      if (!swallowing) return;
      origin = null;
      status.active = false;
      // o vtk recebe a soltura para encerrar o giro que o 1º botão começou
      if (event.buttons === 0) swallowing = false;
    },
    { capture: true }
  );

  // o menu do botão direito não pode abrir no meio do gesto
  useEventListener(
    window,
    'contextmenu',
    (event: MouseEvent) => {
      if (inside(event)) event.preventDefault();
    },
    { capture: true }
  );

  return status;
}
