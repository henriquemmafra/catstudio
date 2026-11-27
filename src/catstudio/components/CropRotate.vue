<script setup lang="ts">
/**
 * CatStudio — girar a caixa de corte na vista 3D. Aparece quando a
 * ferramenta de recorte está ligada. Com "Girar caixa" marcado, arrastar com o
 * botão esquerdo gira a caixa (o exame fica parado); os outros botões e a
 * roda continuam mexendo na câmera.
 */
import { computed, ref, toRefs, watch } from 'vue';
import { useEventListener } from '@vueuse/core';
import type { Maybe } from '@/src/types';
import type { VtkViewApi } from '@/src/types/vtk-types';
import { useToolStore } from '@/src/store/tools';
import { Tools } from '@/src/store/tools/types';
import { useImage } from '@/src/composables/useCurrentImage';
import vtkBoundingBox from '@kitware/vtk.js/Common/DataModel/BoundingBox';
import {
  dragTurn,
  isRotated,
  resetBoxRotation,
  rotateBox,
  rotationAbout,
  screenRotation,
  setBoxRotation,
} from '@/src/catstudio/cropRotation';

interface Props {
  view: Maybe<VtkViewApi>;
  imageId: Maybe<string>;
}

const props = defineProps<Props>();
const { view, imageId } = toRefs(props);

/** meio grau por pixel de arrasto */
const RADIANS_PER_PIXEL = Math.PI / 360;

const root = ref<HTMLElement>();
const turning = ref(false);
const toolStore = useToolStore();
const cropping = computed(() => toolStore.currentTool === Tools.Crop);
const rotated = computed(() => isRotated(imageId.value));
const { metadata } = useImage(imageId);
const container = computed(() => root.value?.parentElement ?? null);

watch(cropping, (on) => {
  if (!on) turning.value = false;
});

let last: { x: number; y: number } | null = null;
const fromOwnButtons = (event: Event) =>
  (event.target as HTMLElement | null)?.closest?.('.crop-rotate') != null;

useEventListener(
  container,
  'pointerdown',
  (event: PointerEvent) => {
    if (!cropping.value || fromOwnButtons(event)) return;
    if (event.button !== 0 || event.buttons !== 1) return;
    // Ctrl + arrastar gira a caixa sem precisar ligar "Girar caixa"
    if (!turning.value && !event.ctrlKey) return;
    event.stopPropagation();
    event.preventDefault();
    last = { x: event.clientX, y: event.clientY };
  },
  { capture: true }
);

function turnBy(dx: number, dy: number) {
  const camera = view.value?.renderer.getActiveCamera();
  const id = imageId.value;
  if (!camera || !id) return;
  const pivot = vtkBoundingBox.getCenter(metadata.value.worldBounds);
  rotateBox(
    id,
    dragTurn(
      {
        up: camera.getViewUp() as [number, number, number],
        direction: camera.getDirectionOfProjection() as [
          number,
          number,
          number,
        ],
      },
      pivot as [number, number, number],
      { dx, dy, radiansPerPixel: RADIANS_PER_PIXEL }
    )
  );
  view.value?.requestRender();
}

useEventListener(
  window,
  'pointermove',
  (event: PointerEvent) => {
    if (!last) return;
    event.stopPropagation();
    turnBy(event.clientX - last.x, event.clientY - last.y);
    last = { x: event.clientX, y: event.clientY };
  },
  { capture: true }
);

useEventListener(
  window,
  'pointerup',
  () => {
    last = null;
  },
  { capture: true }
);

/** Câmera e centro do exame, para os giros por botão. */
function cameraNow() {
  const camera = view.value?.renderer.getActiveCamera();
  if (!camera) return null;
  return {
    up: camera.getViewUp() as [number, number, number],
    direction: camera.getDirectionOfProjection() as [number, number, number],
    pivot: vtkBoundingBox.getCenter(metadata.value.worldBounds) as [
      number,
      number,
      number,
    ],
  };
}

/** Deixa a caixa de frente para a tela: o corte fica paralelo à tela. */
function faceScreen() {
  const id = imageId.value;
  const now = cameraNow();
  if (!id || !now) return;
  const d = metadata.value.orientation;
  const axes = [0, 1, 2].map((a) => [d[3 * a], d[3 * a + 1], d[3 * a + 2]]) as [
    [number, number, number],
    [number, number, number],
    [number, number, number],
  ];
  setBoxRotation(id, screenRotation(now, axes, now.pivot));
  view.value?.requestRender();
}

/**
 * Gira a caixa em torno da linha de visão (como girar uma foto na mesa).
 * Positivo = sentido horário na tela (a câmera olha ao longo do eixo).
 */
function spin(degrees: number) {
  const id = imageId.value;
  const now = cameraNow();
  if (!id || !now) return;
  rotateBox(
    id,
    rotationAbout(now.pivot, now.direction, (degrees * Math.PI) / 180)
  );
  view.value?.requestRender();
}

function align() {
  if (imageId.value) resetBoxRotation(imageId.value);
  view.value?.requestRender();
}
</script>

<template>
  <div ref="root" class="crop-rotate-root" :class="{ turning }">
    <div v-if="cropping" class="crop-rotate">
      <v-btn
        size="small"
        :variant="turning ? 'flat' : 'tonal'"
        :color="turning ? 'primary' : undefined"
        prepend-icon="mdi-rotate-3d-variant"
        data-testid="crop-rotate-toggle"
        @click="turning = !turning"
      >
        Girar caixa
      </v-btn>
      <v-btn
        size="small"
        variant="tonal"
        prepend-icon="mdi-monitor-screenshot"
        data-testid="crop-rotate-screen"
        title="Gire o exame até o ângulo que quiser e clique: a caixa fica de frente para a tela e o corte, paralelo a ela"
        @click="faceScreen"
      >
        De frente para a tela
      </v-btn>
      <v-btn
        icon="mdi-rotate-left"
        size="small"
        variant="tonal"
        aria-label="Girar a caixa 15° para a esquerda"
        data-testid="crop-rotate-left"
        @click="spin(-15)"
      />
      <v-btn
        icon="mdi-rotate-right"
        size="small"
        variant="tonal"
        aria-label="Girar a caixa 15° para a direita"
        data-testid="crop-rotate-right"
        @click="spin(15)"
      />
      <v-btn
        v-if="rotated"
        size="small"
        variant="tonal"
        prepend-icon="mdi-axis-arrow"
        data-testid="crop-rotate-align"
        @click="align"
      >
        Alinhar ao exame
      </v-btn>
      <span class="crop-rotate-hint">
        {{
          turning
            ? 'Arraste com o botão esquerdo para girar a caixa.'
            : 'Ctrl + arrastar gira a caixa.'
        }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.crop-rotate-root {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 2;
}

.crop-rotate-root.turning {
  outline: 2px solid rgba(102, 187, 255, 0.7);
  outline-offset: -2px;
}

.crop-rotate {
  position: absolute;
  top: 34px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 8px;
  background: rgba(20, 24, 28, 0.85);
  color: #fff;
  font-size: 12px;
  pointer-events: all;
  flex-wrap: wrap;
  justify-content: center;
  max-width: calc(100% - 20px);
}

.crop-rotate :deep(.v-btn) {
  text-transform: none;
  letter-spacing: 0;
}

.crop-rotate-hint {
  color: #9bd1ff;
}
</style>
