/**
 * CatStudio — a vista 3D recebe o pedido "Editar no 3D" do diretor de arte
 * (ver handoff.ts) e se arruma: câmera, caixa de corte, cores, fundo e, com
 * pulmões isolados, o resto escondido.
 */
import { type Ref, watch } from 'vue';
import type { Maybe } from '@/src/types';
import type { VtkViewApi } from '@/src/types/vtk-types';
import { useCropStore } from '@/src/store/tools/crop';
import { useToolStore } from '@/src/store/tools';
import { Tools } from '@/src/store/tools/types';
import { cropRotations, resetBoxRotation } from '@/src/catstudio/cropRotation';
import { allPalettes, applyPalette } from '@/src/catstudio/paletteStore';
import { lightLook } from '@/src/catstudio/lightLook';
import { baseImageOf } from '@/src/catstudio/sculpt/useSculptedImage';
import { resetSculpt } from '@/src/catstudio/sculpt/state';
import { keepRegion } from '@/src/catstudio/sculpt/tools';
import { vec3 } from 'gl-matrix';
import { useImageCacheStore } from '@/src/store/image-cache';
import type { ImageMetadata } from '@/src/types/image';
import {
  handoff,
  type CameraPose,
  type CropRequest,
  type Handoff,
} from './handoff';

const DISTANCE = 1000;

function aim(view: VtkViewApi, pose: CameraPose) {
  const camera = view.renderer.getActiveCamera();
  const [fx, fy, fz] = pose.focalPoint;
  const [dx, dy, dz] = pose.direction;
  camera.setFocalPoint(fx, fy, fz);
  camera.setPosition(
    fx - dx * DISTANCE,
    fy - dy * DISTANCE,
    fz - dz * DISTANCE
  );
  camera.setViewUp(...pose.viewUp);
  view.renderer.resetCamera();
  view.renderer.updateLightsGeometryToFollowCamera();
}

type Box = Pick<CropRequest, 'Sagittal' | 'Coronal' | 'Axial'>;

/**
 * A caixa de corte do VolView é guardada em índices do exame (coluna, linha,
 * fatia), não em mm: converte os dois cantos e acha a faixa de cada eixo.
 */
export function toIndexBox(
  box: Box,
  metadata: Pick<ImageMetadata, 'worldToIndex' | 'lpsOrientation'>
): Box {
  const corner = (side: 0 | 1) =>
    vec3.transformMat4(
      vec3.create(),
      [box.Sagittal[side], box.Coronal[side], box.Axial[side]],
      metadata.worldToIndex
    );
  const [a, b] = [corner(0), corner(1)];
  const range = (axis: keyof Box): [number, number] => {
    const at = metadata.lpsOrientation[axis];
    return [Math.min(a[at], b[at]), Math.max(a[at], b[at])];
  };
  return {
    Sagittal: range('Sagittal'),
    Coronal: range('Coronal'),
    Axial: range('Axial'),
  };
}

function crop(request: Handoff) {
  const cropStore = useCropStore();
  const { imageID } = request;
  if (!request.crop) {
    cropStore.resetCropping(imageID);
    resetBoxRotation(imageID);
    return;
  }
  const { rotation, ...box } = request.crop;
  const metadata = useImageCacheStore().getImageMetadata(imageID);
  if (!metadata) return;
  cropStore.setCropping(imageID, toIndexBox(box, metadata));
  if (rotation) cropRotations[imageID] = rotation;
  else resetBoxRotation(imageID);
  // a caixa fica visível e pronta para mexer
  useToolStore().setCurrentTool(Tools.Crop);
}

function keepOnly(view: VtkViewApi, request: Handoff) {
  const base = baseImageOf(request.imageID);
  resetSculpt(request.imageID);
  if (!request.keepOnly || !base) return;
  const [w, h] = view.renderWindowView.getSize();
  keepRegion(
    { view, imageID: request.imageID, base, aspect: w / Math.max(h, 1) },
    request.keepOnly
  );
}

export function useHandoff(
  view: Ref<Maybe<VtkViewApi>>,
  viewID: Ref<string>,
  imageID: Ref<Maybe<string>>
) {
  watch(
    () => handoff.seq,
    () => {
      const request = handoff.request;
      const target = view.value;
      if (!request || !target || request.imageID !== imageID.value) return;
      const palette = allPalettes().find((p) => p.id === request.palette);
      if (palette)
        applyPalette(
          { viewID: viewID.value, imageID: request.imageID },
          palette
        );
      lightLook.background = request.background;
      crop(request);
      keepOnly(target, request);
      aim(target, request.camera);
      target.requestRender();
    }
  );
}
