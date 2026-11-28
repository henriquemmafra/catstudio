<script setup lang="ts">
/**
 * CatStudio — pinta nos cortes 2D as cavidades medidas (VE, VD), para
 * conferir o que entrou na conta do volume.
 */
import {
  inject,
  onScopeDispose,
  shallowRef,
  toRefs,
  watch,
  watchEffect,
} from 'vue';
import vtkPlane from '@kitware/vtk.js/Common/DataModel/Plane';
import type vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
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
import { hexToUnit } from '@/src/catstudio/sculpt/overlay';
import {
  CAVITIES,
  cavityVersions,
  labelsOf,
} from '@/src/catstudio/cavity/state';

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
rep.mapper.setRelativeCoincidentTopologyPolygonOffsetParameters(-3, -3);

const colors = vtkColorTransferFunction.newInstance();
const opacity = vtkPiecewiseFunction.newInstance();
colors.addRGBPoint(0, 0, 0, 0);
opacity.addPoint(0, 0);
Object.values(CAVITIES).forEach((cavity) => {
  colors.addRGBPoint(cavity.label, ...hexToUnit(cavity.color));
  opacity.addPoint(cavity.label, 0.45);
});
rep.property.setRGBTransferFunction(0, colors);
rep.property.setScalarOpacity(0, opacity);
rep.property.setInterpolationType(InterpolationType.NEAREST);
rep.property.setUseLookupTableScalarRange(true);
onScopeDispose(() => {
  plane.delete();
  colors.delete();
  opacity.delete();
});

watch(
  () => [imageID.value, imageID.value && cavityVersions[imageID.value]],
  () => {
    const id = imageID.value;
    labels.value = id && cavityVersions[id] ? labelsOf(id) : null;
    view.requestRender();
  },
  { immediate: true }
);

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
