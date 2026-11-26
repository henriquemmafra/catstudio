<script setup lang="ts">
/**
 * CatStudio — escultura do 3D: laço, clique na estrutura e limpeza de
 * fragmentos. Fica por cima da vista 3D; o exame não é alterado.
 */
import { computed, nextTick, ref, toRefs, watch } from 'vue';
import { useEventListener } from '@vueuse/core';
import type { Maybe } from '@/src/types';
import type { VtkViewApi } from '@/src/types/vtk-types';
import { useCropStore } from '@/src/store/tools/crop';
import type { Point } from '@/src/catstudio/sculpt/mask';
import {
  resetSculpt,
  sculptSummary,
  undoSculpt,
} from '@/src/catstudio/sculpt/state';
import { baseImageOf } from '@/src/catstudio/sculpt/useSculptedImage';
import {
  type SculptTarget,
  fragments,
  lasso,
  pick,
  presetThreshold,
} from '@/src/catstudio/sculpt/tools';

type Mode = 'lasso-remove' | 'lasso-keep' | 'pick-remove' | 'pick-keep';

interface Props {
  view: Maybe<VtkViewApi>;
  imageId: Maybe<string>;
}

const props = defineProps<Props>();
const { view, imageId } = toRefs(props);
const open = defineModel<boolean>('open', { default: false });

const TOOLS: Array<{ mode: Mode; icon: string; title: string; hint: string }> =
  [
    {
      mode: 'lasso-remove',
      icon: 'mdi-lasso',
      title: 'Laço: apagar',
      hint: 'Contorne com o botão esquerdo o que quer apagar.',
    },
    {
      mode: 'lasso-keep',
      icon: 'mdi-selection-ellipse',
      title: 'Laço: manter',
      hint: 'Contorne o que quer manter; o resto some.',
    },
    {
      mode: 'pick-remove',
      icon: 'mdi-cursor-default-click-outline',
      title: 'Clique: apagar',
      hint: 'Clique numa estrutura (osso, mesa, cabo) para apagá-la inteira. Arrastar continua girando.',
    },
    {
      mode: 'pick-keep',
      icon: 'mdi-target',
      title: 'Clique: manter',
      hint: 'Clique na estrutura que deve ficar; o resto some. Arrastar continua girando.',
    },
  ];

const root = ref<HTMLElement>();
const mode = ref<Mode | null>(null);
const busy = ref(false);
const message = ref('');
const threshold = ref(0);
const range = ref<[number, number]>([0, 1]);
const fragmentMl = ref(1);
const path = ref<Point[]>([]);

const cropStore = useCropStore();
const planes = cropStore.getComputedVTKPlanes(imageId);
const summary = computed(() => sculptSummary(imageId.value ?? null));
const hint = computed(
  () => TOOLS.find((tool) => tool.mode === mode.value)?.hint ?? ''
);
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

const isLasso = () => mode.value?.startsWith('lasso') ?? false;
const fromPanel = (event: Event) =>
  (event.target as HTMLElement | null)?.closest?.('.sculpt-panel') != null;

// ----- laço: o botão esquerdo desenha em vez de girar -----
let drawing = false;

function onPointerDown(event: PointerEvent) {
  if (!open.value || busy.value || event.button !== 0 || fromPanel(event))
    return;
  const point = toPoint(event);
  if (!point) return;
  if (isLasso()) {
    event.stopPropagation();
    event.preventDefault();
    drawing = true;
  }
  path.value = [point];
}

function onPointerMove(event: PointerEvent) {
  const point = toPoint(event);
  if (!point || !path.value.length) return;
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
  if (!start || !end || !rect || !mode.value?.startsWith('pick')) return;
  const moved = Math.hypot(
    (end[0] - start[0]) * rect.width,
    (end[1] - start[1]) * rect.height
  );
  if (moved > 4) return; // foi um giro, não um clique
  const keep = mode.value === 'pick-keep';
  run((where) => pick(where, { point: end, threshold: threshold.value, keep }));
}

function onPointerUp(event: PointerEvent) {
  if (!path.value.length) return;
  if (drawing) {
    event.stopPropagation();
    drawing = false;
    finishLasso();
  } else finishClick(event);
  path.value = [];
}

useEventListener(container, 'pointerdown', onPointerDown, { capture: true });
useEventListener(window, 'pointermove', onPointerMove, { capture: true });
useEventListener(window, 'pointerup', onPointerUp, { capture: true });
useEventListener(window, 'keydown', (event: KeyboardEvent) => {
  if (event.key === 'Escape' && mode.value) mode.value = null;
});

const pathPoints = computed(() =>
  drawing || isLasso()
    ? path.value.map(([x, y]) => `${x * 100},${(1 - y) * 100}`).join(' ')
    : ''
);

function toggle(next: Mode) {
  mode.value = mode.value === next ? null : next;
  message.value = '';
}

const removeFragmentsNow = () =>
  run((where) => fragments(where, threshold.value, fragmentMl.value));

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
