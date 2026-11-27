<script setup lang="ts">
/**
 * CatStudio — pinta nos cortes 2D o que foi apagado (azul) e destacado (a cor
 * do destaque) na vista 3D. A máscara vive no volume do 3D (que pode ser
 * menor que o exame); aqui ela é cortada no plano do corte atual.
 */
import {
  computed,
  inject,
  onScopeDispose,
  shallowRef,
  toRefs,
  watchEffect,
} from 'vue';
import { watchDebounced } from '@vueuse/core';
import vtkPlane from '@kitware/vtk.js/Common/DataModel/Plane';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkColorTransferFunction from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction';
import vtkPiecewiseFunction from '@kitware/vtk.js/Common/DataModel/PiecewiseFunction';
import { InterpolationType } from '@kitware/vtk.js/Rendering/Core/ImageProperty/Constants';
import type { Vector3 } from '@kitware/vtk.js/types';
import { VtkViewContext } from '@/src/components/vtk/context';
import { useResliceRepresentation } from '@/src/core/vtk/useResliceRepresentation';
import { useImage } from '@/src/composables/useCurrentImage';
import { useSliceConfig } from '@/src/composables/useSliceConfig';
import type { LPSAxis } from '@/src/types/lps';
import type { Maybe } from '@/src/types';
import { slicePlane as planeOfSlice } from '@/src/catstudio/slabGeometry';
import {
  baseImageOf,
  baseVersions,
  hiddenOf,
} from '@/src/catstudio/sculpt/useSculptedImage';
import {
  DEFAULT_HIGHLIGHT,
  highlightOf,
  highlightViews,
  sculptVersions,
} from '@/src/catstudio/sculpt/state';
import type { Dims } from '@/src/catstudio/sculpt/mask';
import {
  ERASED,
  ERASED_COLOR,
  HIGHLIGHTED,
  hexToUnit,
  overlayLabels,
  sliceOverlay,
} from '@/src/catstudio/sculpt/overlay';

const props = defineProps<{
  viewId: string;
  imageId: Maybe<string>;
  axis: LPSAxis;
}>();
const { viewId: viewID, imageId: imageID, axis } = toRefs(props);

const view = inject(VtkViewContext);
if (!view) throw new Error('No VtkView');

const { metadata, imageData } = useImage(imageID);
const sliceConfig = useSliceConfig(viewID, imageID);

const labels = shallowRef<vtkImageData | null>(null);
const rep = useResliceRepresentation(view, labels);
rep.actor.setPickable(false);
const plane = vtkPlane.newInstance();
rep.mapper.setSlicePlane(plane);
rep.mapper.setResolveCoincidentTopologyToPolygonOffset();
rep.mapper.setRelativeCoincidentTopologyPolygonOffsetParameters(-2, -2);

const colors = vtkColorTransferFunction.newInstance();
const opacity = vtkPiecewiseFunction.newInstance();
rep.property.setRGBTransferFunction(0, colors);
rep.property.setScalarOpacity(0, opacity);
rep.property.setInterpolationType(InterpolationType.NEAREST);
rep.property.setUseLookupTableScalarRange(true);
onScopeDispose(() => {
  plane.delete();
  colors.delete();
  opacity.delete();
});

/** Imagem de rótulos com a geometria do volume do 3D. */
function labelImage(base: vtkImageData): vtkImageData {
  const dims = base.getDimensions();
  const image = vtkImageData.newInstance();
  image.setDimensions(dims);
  image.setSpacing(base.getSpacing());
  image.setOrigin(base.getOrigin());
  image.setDirection(base.getDirection());
  image.getPointData().setScalars(
    vtkDataArray.newInstance({
      numberOfComponents: 1,
      values: new Uint8Array(dims[0] * dims[1] * dims[2]),
    })
  );
  return image;
}

let owner: vtkImageData | null = null;
let canvas: vtkImageData | null = null;

function refresh() {
  const id = imageID.value;
  const base = id && sliceOverlay.enabled ? baseImageOf(id) : null;
  if (!id || !base) {
    labels.value = null;
    view!.requestRender();
    return;
  }
  if (owner !== base) {
    owner = base;
    canvas = labelImage(base);
  }
  const dims = base.getDimensions() as Dims;
  const scalars = canvas!.getPointData().getScalars();
  const marked = overlayLabels(
    { hidden: hiddenOf(id, dims), highlight: highlightOf(id, dims) },
    base.getPointData().getScalars().getData() as ArrayLike<number>,
    scalars.getData() as Uint8Array
  );
  scalars.modified();
  canvas!.modified();
  labels.value = marked ? canvas : null;
  view!.requestRender();
}

watchDebounced(
  () => [
    imageID.value,
    sliceOverlay.enabled,
    imageID.value && baseVersions[imageID.value],
    imageID.value && sculptVersions[imageID.value],
  ],
  // segurando o "crescer" a máscara muda muitas vezes por segundo, e cada
  // troca reenvia o volume de rótulos à placa: os cortes esperam uma pausa
  // (ou 1,2 s) para não atrasar o 3D
  refresh,
  { immediate: true, debounce: 200, maxWait: 1200 }
);

// só a cor interessa aqui: o destaque muda a cada passo do "crescer", e
// redesenhar os cortes a cada passo atrasaria o 3D
const tintOf = computed(() => {
  const id = imageID.value;
  return (id && highlightViews[id]?.color) || DEFAULT_HIGHLIGHT.color;
});

watchEffect(() => {
  const tint = tintOf.value;
  colors.removeAllPoints();
  opacity.removeAllPoints();
  colors.addRGBPoint(0, 0, 0, 0);
  colors.addRGBPoint(ERASED, ...hexToUnit(ERASED_COLOR));
  colors.addRGBPoint(HIGHLIGHTED, ...hexToUnit(tint));
  opacity.addPoint(0, 0);
  opacity.addPoint(ERASED, 0.3);
  opacity.addPoint(HIGHLIGHTED, 0.5);
  rep.property.modified();
  view.requestRender();
});

watchEffect(() => {
  const image = imageData.value;
  if (!image) return;
  const ijkAxis = metadata.value.lpsOrientation[axis.value];
  const { origin, normal } = planeOfSlice(
    image,
    ijkAxis,
    sliceConfig.slice.value
  );
  plane.setOrigin(origin as Vector3);
  plane.setNormal(normal as Vector3);
  view.requestRender();
});

defineExpose(rep);
</script>

<template>
  <slot></slot>
</template>
