<script setup lang="ts">
import {
  toRefs,
  computed,
  inject,
  watchEffect,
  watch,
  shallowRef,
  Ref,
  onScopeDispose,
} from 'vue';
import { useImage } from '@/src/composables/useCurrentImage';
import { useVolumeRepresentation } from '@/src/core/vtk/useVolumeRepresentation';
import { Maybe } from '@/src/types';
import { VtkViewContext } from '@/src/components/vtk/context';
import { useColoringEffect } from '@/src/composables/useColoringEffect';
import useVolumeColoringStore, {
  DEFAULT_AMBIENT,
  DEFAULT_DIFFUSE,
  DEFAULT_SPECULAR,
} from '@/src/store/view-configs/volume-coloring';
import vtkColorTransferFunction from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction';
import vtkPiecewiseFunction from '@kitware/vtk.js/Common/DataModel/PiecewiseFunction';
import { useVolumeColoringInitializer } from '@/src/composables/useVolumeColoringInitializer';
import { isViewAnimating } from '@/src/composables/isViewAnimating';
import { InterpolationType } from '@kitware/vtk.js/Rendering/Core/VolumeProperty/Constants';
import {
  setCinematicLighting,
  setCinematicLocalAmbientOcclusion,
  setCinematicVolumeSampling,
  setCinematicVolumeScatter,
  setCinematicVolumeShading,
} from '@/src/utils/volumeProperties';
import vtkBoundingBox from '@kitware/vtk.js/Common/DataModel/BoundingBox';
import type { vtkObject } from '@kitware/vtk.js/interfaces';
import { onVTKEvent } from '@/src/composables/onVTKEvent';
import { useCroppingEffect } from '@/src/composables/useCroppingEffect';
import { useCropStore } from '@/src/store/tools/crop';
import { useEventListener } from '@vueuse/core';
import {
  ChunkImage,
  type ChunkLoadedInfo,
} from '@/src/core/streaming/chunkImage';
import type vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import { useRenderGuard } from '@/src/catstudio/useRenderGuard';
import {
  applyBackground,
  applyLightLook,
  lightLook,
  resetLight,
} from '@/src/catstudio/lightLook';
import { useSculptedImage } from '@/src/catstudio/sculpt/useSculptedImage';
import { boneViews, sculptVersions } from '@/src/catstudio/sculpt/state';
import {
  isReduced,
  limitCvr,
  performanceSettings,
  reduceImage,
  reductionFactors,
  type Factors,
} from '@/src/catstudio/performance';

interface Props {
  viewId: string;
  imageId: Maybe<string>;
}

const props = defineProps<Props>();
const { viewId: viewID, imageId: imageID } = toRefs(props);

const view = inject(VtkViewContext);
if (!view) throw new Error('No VtkView');

const {
  imageData,
  metadata: imageMetadata,
  isLoading: isImageStreaming,
  image,
} = useImage(imageID);
const coloringConfig = computed(() =>
  useVolumeColoringStore().getConfig(viewID.value, imageID.value)
);

// CatStudio: no modo leve/equilibrado, a vista 3D usa uma cópia reduzida do
// volume (as vistas 2D continuam com o original). A cópia é montada quando o
// volume termina de carregar; até lá o 3D fica vazio, em vez de reenviar a
// textura inteira à placa de vídeo a cada corte que chega.
const factors = computed<Factors>(() => {
  const img = imageData.value;
  if (!img) return [1, 1, 1];
  return reductionFactors(
    img.getDimensions(),
    img.getSpacing(),
    performanceSettings.mode
  );
});
const reducedImage = shallowRef<vtkImageData | null>(null);
const baseImage = computed(() =>
  isReduced(factors.value) ? reducedImage.value : imageData.value
);
// CatStudio: a escultura troca os voxels escondidos por ar numa cópia
const renderImage = useSculptedImage(imageID, baseImage);

// setup base image
const rep = useVolumeRepresentation(view, renderImage);

let reduceJob = 0;
watch(
  [imageData, isImageStreaming, factors],
  async ([img, streaming, f]) => {
    reduceJob += 1;
    const job = reduceJob;
    reducedImage.value = null;
    if (!img || streaming || !isReduced(f)) return;
    const out = await reduceImage(img, f, async () => {
      await new Promise((resolve) => {
        setTimeout(resolve);
      });
      return job === reduceJob;
    });
    if (job !== reduceJob || !out) return;
    rep.property.setUpdatedExtents([]);
    reducedImage.value = out;
  },
  { immediate: true }
);
onScopeDispose(() => {
  reduceJob += 1;
  reducedImage.value = null;
});

watch(
  () => (imageID.value ? sculptVersions[imageID.value] : 0),
  () => {
    rep.property.setUpdatedExtents([]);
    view.requestRender();
  }
);

const cfun = vtkColorTransferFunction.newInstance();
const ofun = vtkPiecewiseFunction.newInstance();
onScopeDispose(() => {
  cfun.delete();
  ofun.delete();
});
rep.property.setRGBTransferFunction(0, cfun);
rep.property.setScalarOpacity(0, ofun);
rep.property.setShade(true);
rep.property.setInterpolationType(InterpolationType.LINEAR);
rep.property.setAmbient(DEFAULT_AMBIENT);
rep.property.setDiffuse(DEFAULT_DIFFUSE);
rep.property.setSpecular(DEFAULT_SPECULAR);

[cfun, ofun].forEach((obj: vtkObject) => {
  onVTKEvent(obj, 'onModified', view.requestRender);
});

// watch for updated extents
const updatedExtents = shallowRef<Array<ChunkLoadedInfo['updatedExtent']>>([]);
useEventListener(
  // safely assume ChunkImage. If not, the event will never be triggered
  image as Ref<ChunkImage | null>,
  'chunkLoad',
  (info: ChunkLoadedInfo) => {
    updatedExtents.value = [...updatedExtents.value, info.updatedExtent];
  }
);

watch(updatedExtents, (current, old) => {
  // CatStudio: a cópia reduzida não recebe atualizações parciais
  if (isReduced(factors.value)) return;
  const startOffset = old.length;
  rep.property.setUpdatedExtents([
    ...rep.property.getUpdatedExtents(),
    ...current.slice(startOffset),
  ]);
  view.requestRender();
});

// cinematic volume rendering
// CatStudio: o modo de desempenho limita o que é usado, sem alterar o salvo
const cvrParams = computed(() => {
  const cvr = coloringConfig.value?.cvr;
  return cvr ? limitCvr(cvr, performanceSettings.mode) : cvr;
});
const center = computed(() =>
  vtkBoundingBox.getCenter(imageMetadata.value.worldBounds)
);
const isAnimating = isViewAnimating(view);
let lightWasMoved = false;

watchEffect(() => {
  const img = renderImage.value;
  if (!cvrParams.value || !img) return;

  const {
    enabled: cvrEnabled,
    lightFollowsCamera,
    ambient,
    diffuse,
    specular,
    volumetricScatteringBlending,
    volumeQuality,
    useLocalAmbientOcclusion,
    useVolumetricScatteringBlending,
    laoKernelRadius,
    laoKernelSize,
  } = cvrParams.value;
  const { property, mapper } = rep;

  const enabled = cvrEnabled && !isAnimating.value && !isImageStreaming.value;
  const dataArray = img.getPointData().getScalars();

  // CatStudio: saindo de um preset de luz, a luz volta para a câmera
  if (lightLook.preset === 'padrao' && lightWasMoved) resetLight(view.renderer);
  lightWasMoved = lightLook.preset !== 'padrao';

  setCinematicLighting({
    enabled,
    renderer: view.renderer,
    lightFollowsCamera,
    center: center.value,
  });

  for (let comp = 0; comp < dataArray.getNumberOfComponents(); comp++) {
    setCinematicVolumeShading({
      enabled,
      image: img,
      ambient,
      diffuse,
      specular,
      property,
      component: comp,
    });
  }

  setCinematicVolumeScatter({
    enabled: enabled && useVolumetricScatteringBlending,
    property,
    blending: volumetricScatteringBlending,
  });

  setCinematicVolumeSampling({
    enabled,
    image: img,
    mapper,
    property,
    quality: volumeQuality,
  });

  setCinematicLocalAmbientOcclusion({
    enabled: enabled && useLocalAmbientOcclusion,
    kernelRadius: laoKernelRadius,
    kernelSize: laoKernelSize,
    property,
  });

  // CatStudio: preset de iluminação e cor do fundo por cima do que o modo
  // cinematográfico acabou de ajustar
  applyLightLook(view.renderer, property, lightLook);
  applyBackground(view.renderer, lightLook);

  view.requestRender();
});

// CatStudio: osso translúcido. O volume vem com dois componentes (resto e
// osso); o segundo usa as mesmas curvas, com peso igual à opacidade do osso.
watchEffect(() => {
  const img = renderImage.value;
  if (!img) return;
  const { property } = rep;
  const split = img.getPointData().getScalars().getNumberOfComponents() === 2;
  property.setIndependentComponents(split);
  if (split) {
    const id = imageID.value;
    property.setRGBTransferFunction(1, cfun);
    property.setScalarOpacity(1, ofun);
    property.setScalarOpacityUnitDistance(
      1,
      property.getScalarOpacityUnitDistance(0)
    );
    property.setComponentWeight(0, 1);
    property.setComponentWeight(1, (id && boneViews[id]?.opacity) || 0);
  }
  view.requestRender();
});

// CatStudio: nenhum quadro parado sai em resolução total sem ter o custo
// medido (ver renderGuard.ts)
useRenderGuard(view, {
  viewID: () => viewID.value,
  mapper: rep.mapper,
  watched: () => [
    rep.mapper,
    rep.actor,
    ...rep.actor.getProperties(),
    cfun,
    ofun,
    view.renderer,
    view.renderer.getActiveCamera(),
    ...view.renderer.getLights(),
    ...rep.mapper.getClippingPlanes(),
    renderImage.value,
    renderImage.value?.getPointData().getScalars(),
  ],
});

// apply coloring
useVolumeColoringInitializer(viewID, imageID);

useColoringEffect(coloringConfig, cfun, ofun);

// cropping
const cropStore = useCropStore();
const croppingPlanes = cropStore.getComputedVTKPlanes(imageID);
useCroppingEffect(rep.mapper, croppingPlanes);

defineExpose(rep);
</script>

<template>
  <slot></slot>
</template>
