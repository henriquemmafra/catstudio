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
    if (!turning.value || !cropping.value || fromOwnButtons(event)) return;
    if (event.button !== 0 || event.buttons !== 1) return;
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
        v-if="rotated"
        size="small"
        variant="tonal"
        prepend-icon="mdi-axis-arrow"
        data-testid="crop-rotate-align"
        @click="align"
      >
        Alinhar
      </v-btn>
      <span v-if="turning" class="crop-rotate-hint">
        Arraste com o botão esquerdo para girar a caixa.
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
  white-space: nowrap;
}

.crop-rotate :deep(.v-btn) {
  text-transform: none;
  letter-spacing: 0;
}

.crop-rotate-hint {
  color: #9bd1ff;
}
</style>
