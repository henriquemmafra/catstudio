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
  GROUP_TITLE,
  type ToolGroup,
  gestureOf,
  hintFor,
  toolsIn,
} from '@/src/catstudio/sculpt/toolList';
import useVolumeColoringStore from '@/src/store/view-configs/volume-coloring';
import SculptBone from '@/src/catstudio/components/SculptBone.vue';
import SculptOptions from '@/src/catstudio/components/SculptOptions.vue';
import { keepLungs, LUNG_PALETTE } from '@/src/catstudio/sculpt/lungs';
import { allPalettes, applyPalette } from '@/src/catstudio/paletteStore';
import { choosePreset } from '@/src/catstudio/lightLook';
import SculptHighlight from '@/src/catstudio/components/SculptHighlight.vue';
import { shouldAutoCut } from '@/src/catstudio/sculpt/autoTable';
import {
  baseImageOf,
  baseVersions,
} from '@/src/catstudio/sculpt/useSculptedImage';

interface Props {
  view: Maybe<VtkViewApi>;
  imageId: Maybe<string>;
  viewId: string;
}

const props = defineProps<Props>();
const { view, imageId, viewId } = toRefs(props);
const open = defineModel<boolean>('open', { default: false });

const root = ref<HTMLElement>();
const mode = ref<Mode | null>(null);
const busy = ref(false);
const message = ref('');
const threshold = ref(0);
const range = ref<[number, number]>([0, 1]);
const fragmentMl = ref(1);
const DUST_SIZES = [0.5, 1, 3, 10, 30];
const GROUPS: ToolGroup[] = ['apagar', 'manter', 'destacar'];
const showSettings = ref(false);
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

// trocar de preset ou de paleta muda o que conta como estrutura visível
const coloring = useVolumeColoringStore();
watch(
  () =>
    imageId.value &&
    coloring.getConfig(viewId.value, imageId.value)?.opacityFunction,
  () => usePresetThreshold(),
  { deep: true, flush: 'post' }
);

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
  // o laço continua ligado para o próximo corte (Esc desliga)
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

/** Um clique: esconde tudo menos os pulmões e põe as cores de pulmão. */
const lungsOnlyNow = () =>
  run((where) => {
    const phrase = keepLungs(where);
    const palette = allPalettes().find((p) => p.id === LUNG_PALETTE);
    if (palette && viewId.value)
      applyPalette({ viewID: viewId.value, imageID: where.imageID }, palette);
    choosePreset('diretor');
    return phrase;
  });

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
    <button
      v-if="!open"
      class="sculpt-tab"
      data-testid="sculpt-tab"
      title="Abrir as ferramentas 3D"
      @click="open = true"
    >
      <v-icon size="16">mdi-content-cut</v-icon>
      Ferramentas 3D
    </button>
    <div v-else class="sculpt-panel" data-testid="sculpt-panel">
      <div class="sculpt-title">
        Ferramentas 3D
        <span class="sculpt-title-actions">
          <v-btn
            icon="mdi-undo"
            size="x-small"
            variant="text"
            title="Desfazer"
            aria-label="Desfazer"
            :disabled="busy || !summary.undoLevels"
            data-testid="sculpt-undo"
            @click="undo"
          />
          <v-btn
            icon="mdi-restore"
            size="x-small"
            variant="text"
            title="Restaurar tudo"
            aria-label="Restaurar tudo"
            :disabled="busy || !summary.hiddenVoxels"
            data-testid="sculpt-restore"
            @click="restore"
          />
          <v-btn
            icon="mdi-chevron-left"
            size="x-small"
            variant="text"
            title="Recolher"
            aria-label="Recolher as ferramentas"
            data-testid="sculpt-close"
            @click="open = false"
          />
        </span>
      </div>

      <div v-for="group in GROUPS" :key="group" class="sculpt-group">
        <span class="sculpt-group-name">{{ GROUP_TITLE[group] }}</span>
        <v-btn
          v-for="tool in toolsIn(group)"
          :key="tool.mode"
          stacked
          size="x-small"
          class="sculpt-tile"
          :variant="mode === tool.mode ? 'flat' : 'tonal'"
          :color="mode === tool.mode ? 'primary' : undefined"
          :prepend-icon="tool.icon"
          :title="tool.title"
          :disabled="busy"
          :data-testid="`sculpt-${tool.mode}`"
          @click="toggle(tool.mode)"
        >
          {{ tool.short }}
        </v-btn>
      </div>
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
      <sculpt-highlight :image-id="imageId" />

      <div class="sculpt-row">
        <v-btn
          size="small"
          variant="tonal"
          prepend-icon="mdi-lungs"
          :disabled="busy"
          title="Esconde tudo menos os pulmões e usa as cores de pulmão"
          data-testid="sculpt-lungs"
          @click="lungsOnlyNow"
        >
          Só pulmões
        </v-btn>
      </div>

      <div class="sculpt-section">Limpeza</div>
      <div class="sculpt-row">
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
        <v-btn
          size="small"
          variant="tonal"
          prepend-icon="mdi-broom"
          :disabled="busy"
          data-testid="sculpt-fragments"
          @click="removeFragmentsNow"
        >
          Poeira
        </v-btn>
        <select
          v-model.number="fragmentMl"
          class="sculpt-select"
          aria-label="Tamanho máximo da poeira"
          data-testid="sculpt-fragment-size"
        >
          <option v-for="ml in DUST_SIZES" :key="ml" :value="ml">
            até {{ String(ml).replace('.', ',') }} cm³
          </option>
        </select>
      </div>
      <sculpt-options />

      <sculpt-bone
        :image-id="imageId"
        :busy="busy"
        :picking="mode === 'pick-bone'"
        @detect="detectBoneNow"
        @pick="toggle('pick-bone')"
      />

      <button
        class="sculpt-more"
        data-testid="sculpt-settings"
        @click="showSettings = !showSettings"
      >
        {{ showSettings ? '▾' : '▸' }} Ajuste fino
      </button>
      <label v-if="showSettings" class="sculpt-label">
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

.sculpt-tab {
  position: absolute;
  top: 40px;
  left: 6px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.25);
  background: rgba(20, 24, 28, 0.85);
  color: #fff;
  font-size: 12px;
  cursor: pointer;
  pointer-events: all;
}

.sculpt-panel {
  position: absolute;
  top: 38px;
  left: 6px;
  width: 236px;
  max-height: calc(100% - 78px);
  overflow-y: auto;
  padding: 6px 8px 8px;
  border-radius: 8px;
  background: rgba(20, 24, 28, 0.88);
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

.sculpt-title-actions {
  display: flex;
}

.sculpt-group {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 4px;
}

.sculpt-group-name {
  flex: 0 0 52px;
  color: rgba(255, 255, 255, 0.7);
  font-size: 11px;
  line-height: 1.1;
}

.sculpt-tile {
  flex: 0 0 40px;
  min-width: 40px !important;
  height: 40px !important;
  padding: 0 2px !important;
  font-size: 9px !important;
  text-transform: none;
  letter-spacing: 0;
}

.sculpt-section {
  margin-top: 8px;
  padding-top: 6px;
  border-top: 1px solid rgba(255, 255, 255, 0.15);
  color: rgba(255, 255, 255, 0.7);
  font-size: 11px;
}

.sculpt-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  margin: 4px 0;
}

.sculpt-row :deep(.v-btn) {
  text-transform: none;
  letter-spacing: 0;
  padding: 0 8px;
}

.sculpt-select {
  flex: 1 1 60px;
  min-width: 0;
  padding: 2px 4px;
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 4px;
  color: #fff;
  background: #14181c;
  font-size: 11px;
}

.sculpt-more {
  display: block;
  margin-top: 6px;
  padding: 0;
  border: none;
  background: none;
  color: rgba(255, 255, 255, 0.7);
  font-size: 11px;
  cursor: pointer;
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
