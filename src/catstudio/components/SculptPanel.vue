<script setup lang="ts">
/**
 * CatStudio — escultura do 3D: laço, clique na estrutura e limpeza de
 * fragmentos. Fica por cima da vista 3D; o exame não é alterado.
 */
import { computed, nextTick, ref, toRefs, watch } from 'vue';
import { useEventListener } from '@vueuse/core';
import type { Maybe } from '@/src/types';
import type { VtkViewApi } from '@/src/types/vtk-types';
import { useBoxPlanes } from '@/src/catstudio/cropRotation';
import type { Point } from '@/src/catstudio/sculpt/mask';
import {
  resetSculpt,
  sculptSummary,
  undoSculpt,
} from '@/src/catstudio/sculpt/state';
import {
  type BrushStroke,
  type GrowStroke,
  startBrushStroke,
  type SculptTarget,
  findBone,
  removeTable,
  flipBone,
  fragments,
  lasso,
  pick,
  presetThreshold,
  startGrowStroke,
} from '@/src/catstudio/sculpt/tools';
import {
  type SculptMode as Mode,
  SCULPT_TOOLS as TOOLS,
  gestureOf,
  hintFor,
} from '@/src/catstudio/sculpt/toolList';
import SculptBone from '@/src/catstudio/components/SculptBone.vue';
import SculptHighlight from '@/src/catstudio/components/SculptHighlight.vue';
import {
  autoTable,
  setAutoTable,
  shouldAutoCut,
} from '@/src/catstudio/sculpt/autoTable';
import {
  baseImageOf,
  baseVersions,
} from '@/src/catstudio/sculpt/useSculptedImage';

interface Props {
  view: Maybe<VtkViewApi>;
  imageId: Maybe<string>;
}

const props = defineProps<Props>();
const { view, imageId } = toRefs(props);
const open = defineModel<boolean>('open', { default: false });

const root = ref<HTMLElement>();
const mode = ref<Mode | null>(null);
const busy = ref(false);
const message = ref('');
const threshold = ref(0);
const range = ref<[number, number]>([0, 1]);
const fragmentMl = ref(1);
const brushMm = ref(8);
const path = ref<Point[]>([]);

const planes = useBoxPlanes(imageId);
const summary = computed(() => sculptSummary(imageId.value ?? null));
const hint = computed(() => hintFor(mode.value));
const container = computed(() => root.value?.parentElement ?? null);

function viewRect(): DOMRect | null {
  const element = container.value?.querySelector('.vtk-view') ?? null;
  return element?.getBoundingClientRect() ?? null;
}

function target(): SculptTarget | null {
  const rect = viewRect();
  const base = imageId.value ? baseImageOf(imageId.value) : null;
  if (!view.value || !imageId.value || !base || !rect?.height) return null;
  return {
    view: view.value,
    imageID: imageId.value,
    base,
    aspect: rect.width / rect.height,
    planes: planes.value,
  };
}

function usePresetThreshold() {
  const base = imageId.value ? baseImageOf(imageId.value) : null;
  if (!view.value || !base) return;
  const preset = presetThreshold(view.value, base);
  range.value = preset.range;
  threshold.value = preset.threshold;
}

watch([open, imageId], ([isOpen]) => {
  mode.value = null;
  message.value = '';
  if (isOpen) usePresetThreshold();
});

/** Dá tempo de o aviso "Calculando…" aparecer antes da conta pesada. */
async function run(job: (where: SculptTarget) => string) {
  const where = target();
  if (!where) {
    message.value = 'O 3D ainda está carregando.';
    return;
  }
  busy.value = true;
  await nextTick();
  await new Promise((resolve) => {
    setTimeout(resolve, 30);
  });
  try {
    message.value = job(where);
  } catch (error) {
    message.value = `Não deu: ${(error as Error).message}`;
  } finally {
    busy.value = false;
  }
}

function toPoint(event: PointerEvent): Point | null {
  const rect = viewRect();
  if (!rect) return null;
  return [
    (event.clientX - rect.left) / rect.width,
    1 - (event.clientY - rect.top) / rect.height,
  ];
}

const gesture = () => gestureOf(mode.value);
const fromPanel = (event: Event) =>
  (event.target as HTMLElement | null)?.closest?.('.sculpt-panel') != null;

// ----- laço e crescer: o botão esquerdo trabalha em vez de girar -----
let drawing = false;
let growing: GrowStroke | null = null;
let growTimer = 0;
const GROW_STEP_MS = 110;

function startGrowing(point: Point) {
  const where = target();
  growing = where
    ? startGrowStroke(where, {
        point,
        threshold: threshold.value,
        keep: mode.value === 'grow-keep',
        highlight: mode.value === 'grow-highlight',
      })
    : null;
  if (!growing) {
    message.value =
      'Não achei nada nesse ponto. Aperte em cima do vaso ou baixe a densidade mínima.';
    return;
  }
  growTimer = window.setInterval(() => {
    if (growing) message.value = growing.step();
  }, GROW_STEP_MS);
}

function stopGrowing() {
  window.clearInterval(growTimer);
  if (growing) message.value = growing.finish();
  growing = null;
}

// ----- borracha -----
let brushing: BrushStroke | null = null;
let lastBrush = 0;
const BRUSH_STEP_MS = 90;

function startBrushing(point: Point) {
  const where = target();
  if (!where) return;
  brushing = startBrushStroke(where, {
    threshold: threshold.value,
    radiusMm: brushMm.value,
  });
  brushing.at(point);
  lastBrush = performance.now();
}

/** A cada passo a vista é refeita; por isso a borracha anda em passos. */
function brushTo(point: Point) {
  if (!brushing || performance.now() - lastBrush < BRUSH_STEP_MS) return;
  lastBrush = performance.now();
  brushing.at(point);
}

function stopBrushing() {
  if (brushing) message.value = brushing.finish();
  brushing = null;
}

/** Só o botão esquerdo sozinho (os dois juntos mexem na janela do 3D). */
const leftAlone = (event: PointerEvent) =>
  event.button === 0 && event.buttons === 1;

const GESTURE_START: Partial<Record<string, (point: Point) => void>> = {
  grow: startGrowing,
  brush: startBrushing,
};

function onPointerDown(event: PointerEvent) {
  if (!open.value || busy.value || fromPanel(event)) return;
  const point = leftAlone(event) ? toPoint(event) : null;
  const kind = gesture();
  if (!point || !kind) return;
  if (kind !== 'pick') {
    event.stopPropagation();
    event.preventDefault();
  }
  path.value = [point];
  drawing = kind === 'lasso';
  GESTURE_START[kind]?.(point);
}

function onPointerMove(event: PointerEvent) {
  const point = toPoint(event);
  if (!point || !path.value.length) return;
  if (brushing) brushTo(point);
  if (drawing) {
    event.stopPropagation();
    path.value = [...path.value, point];
  } else path.value = [path.value[0], point];
}

function finishLasso() {
  const points = path.value;
  const keep = mode.value === 'lasso-keep';
  // uma passada por vez: depois do corte a vista volta a girar
  mode.value = null;
  run((where) => lasso(where, points, keep));
}

function finishClick(event: PointerEvent) {
  const [start, end] = [path.value[0], toPoint(event)];
  const rect = viewRect();
  if (!start || !end || !rect || gesture() !== 'pick') return;
  const moved = Math.hypot(
    (end[0] - start[0]) * rect.width,
    (end[1] - start[1]) * rect.height
  );
  if (moved > 4) return; // foi um giro, não um clique
  if (mode.value === 'pick-bone') {
    run((where) => flipBone(where, end));
    return;
  }
  const keep = mode.value === 'pick-keep';
  run((where) => pick(where, { point: end, threshold: threshold.value, keep }));
}

function onPointerUp(event: PointerEvent) {
  if (!path.value.length) return;
  if (drawing) {
    event.stopPropagation();
    drawing = false;
    finishLasso();
  } else if (growing) stopGrowing();
  else if (brushing) stopBrushing();
  else finishClick(event);
  path.value = [];
}

useEventListener(container, 'pointerdown', onPointerDown, { capture: true });
useEventListener(window, 'pointermove', onPointerMove, { capture: true });
useEventListener(window, 'pointerup', onPointerUp, { capture: true });
useEventListener(window, 'keydown', (event: KeyboardEvent) => {
  if (event.key === 'Escape' && mode.value) mode.value = null;
});

const pathPoints = computed(() =>
  drawing || gesture() === 'lasso'
    ? path.value.map(([x, y]) => `${x * 100},${(1 - y) * 100}`).join(' ')
    : ''
);

function toggle(next: Mode) {
  mode.value = mode.value === next ? null : next;
  message.value = '';
}

const removeFragmentsNow = () =>
  run((where) => fragments(where, threshold.value, fragmentMl.value));

const detectBoneNow = () => run(findBone);
const removeTableNow = () => run(removeTable);

// tirar a mesa sozinho, uma vez por exame, quando o volume do 3D fica pronto
watch(
  () => [view.value, imageId.value && baseVersions[imageId.value]],
  () => {
    const id = imageId.value;
    if (!id || !baseImageOf(id) || !target()) return;
    if (shouldAutoCut(id, summary.value.hiddenVoxels > 0)) removeTableNow();
  },
  { immediate: true, flush: 'post' }
);

function undo() {
  if (imageId.value && undoSculpt(imageId.value)) message.value = 'Desfeito.';
}

function restore() {
  if (imageId.value && resetSculpt(imageId.value))
    message.value = 'Exame inteiro de volta.';
}
</script>

<template>
  <div ref="root" class="sculpt-root" :class="{ armed: mode && open }">
    <svg
      v-if="pathPoints"
      class="sculpt-path"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
    >
      <polygon :points="pathPoints" vector-effect="non-scaling-stroke" />
    </svg>
    <div v-if="open" class="sculpt-panel" data-testid="sculpt-panel">
      <div class="sculpt-title">
        Esculpir
        <v-btn
          icon="mdi-close"
          size="x-small"
          variant="text"
          data-testid="sculpt-close"
          @click="open = false"
        />
      </div>
      <div class="sculpt-tools">
        <v-btn
          v-for="tool in TOOLS"
          :key="tool.mode"
          size="small"
          :variant="mode === tool.mode ? 'flat' : 'tonal'"
          :color="mode === tool.mode ? 'primary' : undefined"
          :prepend-icon="tool.icon"
          :disabled="busy"
          :data-testid="`sculpt-${tool.mode}`"
          @click="toggle(tool.mode)"
        >
          {{ tool.title }}
        </v-btn>
      </div>
      <label class="sculpt-label">
        Densidade mínima da estrutura: <b>{{ threshold }}</b>
        <input
          v-model.number="threshold"
          type="range"
          :min="range[0]"
          :max="range[1]"
          step="5"
          data-testid="sculpt-threshold"
        />
      </label>
      <label v-if="mode === 'brush-remove'" class="sculpt-label">
        Borracha: raio de <b>{{ brushMm }} mm</b>
        <input
          v-model.number="brushMm"
          type="range"
          min="2"
          max="40"
          step="1"
          data-testid="sculpt-brush-size"
        />
      </label>
      <label class="sculpt-label">
        Fragmento: até <b>{{ fragmentMl }} cm³</b>
        <input
          v-model.number="fragmentMl"
          type="range"
          min="0.1"
          max="30"
          step="0.1"
          data-testid="sculpt-fragment-size"
        />
      </label>
      <div class="sculpt-tools">
        <v-btn
          size="small"
          variant="tonal"
          prepend-icon="mdi-broom"
          :disabled="busy"
          data-testid="sculpt-fragments"
          @click="removeFragmentsNow"
        >
          Tirar fragmentos
        </v-btn>
        <v-btn
          size="small"
          variant="tonal"
          prepend-icon="mdi-undo"
          :disabled="busy || !summary.undoLevels"
          data-testid="sculpt-undo"
          @click="undo"
        >
          Desfazer
        </v-btn>
        <v-btn
          size="small"
          variant="tonal"
          prepend-icon="mdi-restore"
          :disabled="busy || !summary.hiddenVoxels"
          data-testid="sculpt-restore"
          @click="restore"
        >
          Restaurar tudo
        </v-btn>
      </div>
      <div class="sculpt-tools">
        <v-btn
          size="small"
          variant="tonal"
          prepend-icon="mdi-bed-outline"
          :disabled="busy"
          data-testid="sculpt-table"
          @click="removeTableNow"
        >
          Tirar mesa
        </v-btn>
        <label class="sculpt-check">
          <input
            type="checkbox"
            :checked="autoTable.enabled"
            data-testid="sculpt-table-auto"
            @change="setAutoTable(($event.target as HTMLInputElement).checked)"
          />
          sempre, ao abrir
        </label>
      </div>
      <sculpt-highlight :image-id="imageId" />
      <sculpt-bone
        :image-id="imageId"
        :busy="busy"
        :picking="mode === 'pick-bone'"
        @detect="detectBoneNow"
        @pick="toggle('pick-bone')"
      />
      <div class="sculpt-status" data-testid="sculpt-status">
        <template v-if="busy">Calculando…</template>
        <template v-else>{{ message || hint }}</template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sculpt-root {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 3;
}

.sculpt-root.armed {
  outline: 2px solid rgba(255, 209, 102, 0.7);
  outline-offset: -2px;
}

.sculpt-path {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.sculpt-path polygon {
  fill: rgba(255, 209, 102, 0.12);
  stroke: #ffd166;
  stroke-width: 2;
  stroke-dasharray: 6 4;
}

.sculpt-panel {
  position: absolute;
  top: 40px;
  left: 6px;
  width: 268px;
  padding: 8px 10px 10px;
  border-radius: 8px;
  background: rgba(20, 24, 28, 0.9);
  color: #fff;
  font-size: 12px;
  pointer-events: all;
}

.sculpt-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 600;
  font-size: 13px;
}

.sculpt-tools {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  margin: 6px 0;
}

.sculpt-tools :deep(.v-btn) {
  text-transform: none;
  letter-spacing: 0;
  justify-content: flex-start;
}

.sculpt-check {
  display: flex;
  align-items: center;
  gap: 6px;
  color: rgba(255, 255, 255, 0.8);
}

.sculpt-label {
  display: block;
  margin-top: 6px;
  color: rgba(255, 255, 255, 0.8);
}

.sculpt-label input {
  display: block;
  width: 100%;
}

.sculpt-status {
  min-height: 32px;
  margin-top: 4px;
  color: #ffd166;
}
</style>
