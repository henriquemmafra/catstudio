<script setup lang="ts">
/**
 * CatStudio — fatia espessa (MIP/MinIP) de uma vista 2D. Substitui o corte
 * fino enquanto a projeção está ligada; o plano acompanha o corte atual.
 */
import { computed, inject, onScopeDispose, toRefs, watchEffect } from 'vue';
import vtkPlane from '@kitware/vtk.js/Common/DataModel/Plane';
import { SlabTypes } from '@kitware/vtk.js/Rendering/Core/ImageResliceMapper/Constants';
import type { Vector3 } from '@kitware/vtk.js/types';
import { VtkViewContext } from '@/src/components/vtk/context';
import { useResliceRepresentation } from '@/src/core/vtk/useResliceRepresentation';
import { useBaseSliceColoring } from '@/src/composables/useBaseSliceColoring';
import { useImage } from '@/src/composables/useCurrentImage';
import { useSliceConfig } from '@/src/composables/useSliceConfig';
import { useWindowingConfig } from '@/src/composables/useWindowingConfig';
import type { LPSAxis } from '@/src/types/lps';
import type { Maybe } from '@/src/types';
import { slabFor } from '@/src/catstudio/slab';
import { slicePlane as planeOfSlice } from '@/src/catstudio/slabGeometry';

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
const wlConfig = useWindowingConfig(viewID, imageID);

const rep = useResliceRepresentation(
  { ...view, renderer: view.imageRenderer },
  imageData
);
const plane = vtkPlane.newInstance();
rep.mapper.setSlicePlane(plane);
rep.mapper.setResolveCoincidentTopologyToPolygonOffset();
rep.mapper.setRelativeCoincidentTopologyPolygonOffsetParameters(1, 1);
onScopeDispose(() => plane.delete());

useBaseSliceColoring(
  rep.property,
  computed(() => wlConfig.config.value?.preset),
  true,
  view.requestRender
);

watchEffect(() => {
  const image = imageData.value;
  const slab = slabFor(viewID.value);
  if (!image || slab.mode === 'off') return;

  const ijkAxis = metadata.value.lpsOrientation[axis.value];
  const { origin, normal } = planeOfSlice(
    image,
    ijkAxis,
    sliceConfig.slice.value
  );
  plane.setOrigin(origin as Vector3);
  plane.setNormal(normal as Vector3);
  rep.mapper.setSlabType(slab.mode === 'max' ? SlabTypes.MAX : SlabTypes.MIN);
  rep.mapper.setSlabThickness(slab.thickness);
  rep.property.setColorWindow(wlConfig.width.value);
  rep.property.setColorLevel(wlConfig.level.value);
  rep.actor.setVisibility(wlConfig.config.value?.visibility ?? true);
  view.requestRender();
});

defineExpose(rep);
</script>

<template>
  <slot></slot>
</template>
