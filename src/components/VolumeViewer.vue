<template>
  <div class="vtk-container-wrapper volume-viewer-container" tabindex="0">
    <div class="vtk-container" data-testid="two-view-container">
      <v-progress-linear
        v-if="isImageLoading"
        indeterminate
        class="loading-indicator"
        height="2"
        color="grey"
      />
      <div class="vtk-sub-container">
        <vtk-volume-view
          class="vtk-view"
          ref="vtkView"
          data-testid="vtk-view vtk-volume-view"
          :view-id="viewId"
          :image-id="currentImageID"
          :view-direction="viewDirection"
          :view-up="viewUp"
        >
          <vtk-base-volume-representation
            :view-id="viewId"
            :image-id="currentImageID"
          ></vtk-base-volume-representation>
          <vtk-orientation-marker></vtk-orientation-marker>
          <crop-tool :view-id="viewId" :image-id="currentImageID"></crop-tool>
          <slot></slot>
        </vtk-volume-view>
      </div>
      <view-overlay-grid class="overlay-no-events view-annotations">
        <template v-slot:top-left>
          <div class="annotation-cell">
            <v-btn
              class="pointer-events-all"
              color="white"
              icon
              size="medium"
              variant="text"
              @click="resetCamera"
            >
              <v-icon size="medium" class="py-1 view-control-icon">
                mdi-camera-flip-outline
              </v-icon>
              <v-tooltip
                location="right"
                activator="parent"
                transition="slide-x-transition"
              >
                Recentralizar câmera
              </v-tooltip>
            </v-btn>
            <v-menu location="bottom start">
              <template #activator="{ props: menu }">
                <v-btn
                  v-bind="menu"
                  class="pointer-events-all"
                  color="white"
                  icon
                  size="medium"
                  variant="text"
                  :loading="exporting"
                  data-testid="export-3d-menu"
                >
                  <v-icon size="medium" class="py-1 view-control-icon">
                    mdi-image-move
                  </v-icon>
                  <v-tooltip
                    location="right"
                    activator="parent"
                    transition="slide-x-transition"
                  >
                    Exportar imagem (PNG, sem textos nem dados do paciente)
                  </v-tooltip>
                </v-btn>
              </template>
              <v-list density="compact">
                <v-list-item
                  v-for="option in EXPORT_OPTIONS"
                  :key="option.scale"
                  :title="option.title"
                  :subtitle="option.subtitle"
                  :data-testid="`export-3d-${option.scale}x`"
                  @click="exportPNG(option.scale)"
                />
              </v-list>
            </v-menu>
            <v-btn
              class="pointer-events-all"
              :color="sculptOpen ? 'primary' : 'white'"
              icon
              size="medium"
              variant="text"
              data-testid="open-sculpt"
              @click="sculptOpen = !sculptOpen"
            >
              <v-icon size="medium" class="py-1 view-control-icon">
                mdi-content-cut
              </v-icon>
              <v-tooltip
                location="right"
                activator="parent"
                transition="slide-x-transition"
              >
                Esculpir o 3D (laço, apagar estrutura, tirar fragmentos)
              </v-tooltip>
            </v-btn>
            <span class="ml-3">{{ currentImageMetadata.name }}</span>
          </div>
        </template>
        <template #top-right>
          <div class="annotation-cell">
            <span>{{ presetName }}</span>
          </div>
        </template>
        <template #bottom-left>
          <div
            v-if="guard.refining || guard.limited"
            class="annotation-cell guard-badge"
            data-testid="render-guard-badge"
          >
            <template v-if="guard.refining">Refinando o 3D…</template>
            <template v-else>
              Resolução reduzida para não travar
              <span class="guard-detail"
                >(quadro completo ≈ {{ guardSeconds }} s nesta placa)</span
              >
            </template>
          </div>
        </template>
        <template #bottom-right>
          <div class="annotation-cell" @click.stop>
            <ViewTypeSwitcher :view-id="viewId" :image-id="currentImageID" />
          </div>
        </template>
      </view-overlay-grid>
      <sculpt-panel
        v-model:open="sculptOpen"
        :view="vtkView"
        :image-id="currentImageID"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, toRefs, computed } from 'vue';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { LPSAxisDir } from '@/src/types/lps';
import VtkVolumeView from '@/src/components/vtk/VtkVolumeView.vue';
import { VtkViewApi } from '@/src/types/vtk-types';
import VtkBaseVolumeRepresentation from '@/src/components/vtk/VtkBaseVolumeRepresentation.vue';
import { useViewAnimationListener } from '@/src/composables/useViewAnimationListener';
import CropTool from '@/src/components/tools/crop/CropTool.vue';
import { useWebGLWatchdog } from '@/src/composables/useWebGLWatchdog';
import VtkOrientationMarker from '@/src/components/vtk/VtkOrientationMarker.vue';
import ViewOverlayGrid from '@/src/components/ViewOverlayGrid.vue';
import useVolumeColoringStore from '@/src/store/view-configs/volume-coloring';
import { useResetViewsEvents } from '@/src/components/tools/ResetViews.vue';
import { onVTKEvent } from '@/src/composables/onVTKEvent';
import { useViewStore } from '@/src/store/views';
import ViewTypeSwitcher from '@/src/components/ViewTypeSwitcher.vue';
import { captureViewHiRes, captureViewPNG } from '@/src/catstudio/capture';
import { guardStatus } from '@/src/catstudio/renderGuard';
import SculptPanel from '@/src/catstudio/components/SculptPanel.vue';

interface Props {
  viewId: string;
}

interface VolumeViewerOptions {
  viewDirection: LPSAxisDir;
  viewUp: LPSAxisDir;
}

const vtkView = ref<VtkViewApi>();
const sculptOpen = ref(false);

const props = defineProps<Props>();

const { viewId } = toRefs(props);

const viewStore = useViewStore();
const viewInfo = computed(() => viewStore.getView(viewId.value)!);
const viewType = computed(() => viewInfo.value.type);
const viewOptions = computed(
  () => viewInfo.value.options as VolumeViewerOptions
);
const viewDirection = computed(() => viewOptions.value.viewDirection);
const viewUp = computed(() => viewOptions.value.viewUp);

function resetCamera() {
  if (!vtkView.value) return;
  vtkView.value.resetCamera();
  vtkView.value.renderer.updateLightsGeometryToFollowCamera();
}

useResetViewsEvents().onClick(resetCamera);

// CatStudio: exportar a vista 3D como PNG
const EXPORT_OPTIONS = [
  { scale: 1, title: 'Como está na tela', subtitle: 'Na hora' },
  { scale: 2, title: '2× (slide)', subtitle: 'Redesenha maior' },
  { scale: 4, title: '4× (pôster)', subtitle: 'Até 4096 px; demora mais' },
];
const exporting = ref(false);

/** Espera a trava do 3D terminar de refinar (ou desistir de esperar). */
async function settled() {
  const pause = (ms: number) =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  await pause(500);
  for (let waited = 0; waited < 40_000 && guard.value.refining; waited += 200)
    await pause(200);
  await pause(300);
}

async function exportPNG(scale = 1) {
  const view = vtkView.value;
  if (!view || exporting.value) return;
  exporting.value = true;
  try {
    if (scale === 1) await captureViewPNG(view, '3d');
    else await captureViewHiRes(view, { scale, settle: settled });
  } finally {
    exporting.value = false;
  }
}

// CatStudio: aviso da trava de segurança (resolução reduzida / refinando)
const guard = computed(() => guardStatus(viewId.value));
const guardSeconds = computed(() =>
  Math.max(1, Math.round(guard.value.fullEstimateMs / 1000))
);

useWebGLWatchdog(vtkView);
useViewAnimationListener(vtkView, viewId, viewType);

// base image
const {
  currentImageID,
  currentImageData,
  currentImageMetadata,
  isImageLoading,
} = useCurrentImage();

onVTKEvent(currentImageData, 'onModified', () => {
  vtkView.value?.requestRender();
});

// color preset
const coloringStore = useVolumeColoringStore();
const coloringConfig = computed(() =>
  coloringStore.getConfig(viewId.value, currentImageID.value)
);
const presetName = computed(
  () => coloringConfig.value?.transferFunction.preset.replace(/-/g, ' ') ?? ''
);
</script>

<style scoped src="@/src/components/styles/vtk-view.css"></style>
<style scoped src="@/src/components/styles/utils.css"></style>

<style scoped>
.guard-badge {
  margin-left: 44px;
  padding: 1px 8px;
  border-radius: 10px;
  background: rgba(20, 24, 28, 0.78);
  color: #ffd166;
  font-size: 12px;
}

.guard-detail {
  color: rgba(255, 255, 255, 0.7);
}

.volume-viewer-container {
  background-color: black;
  grid-template-columns: auto;
}
</style>
