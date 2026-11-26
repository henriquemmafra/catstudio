/**
 * CatStudio — foto final: junta o que está na vista 3D (câmera, cores,
 * cortes, escultura, luz) no formato do renderizador.
 */
import type vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import type vtkVolume from '@kitware/vtk.js/Rendering/Core/Volume';
import type { VtkViewApi } from '@/src/types/vtk-types';
import { lightLook, lightPosition } from '@/src/catstudio/lightLook';
import { boneOf, boneViews, sculptOf } from '@/src/catstudio/sculpt/state';
import { baseImageOf } from '@/src/catstudio/sculpt/useSculptedImage';
import type { Dims } from '@/src/catstudio/sculpt/mask';
import {
  type Camera,
  type Lighting,
  type Mask,
  type PhotoInput,
  type Transfer,
  type Vec3,
  normalize,
} from './raycast';
import { SHADOW_STEP_FACTOR } from './trace';

/** Entradas da tabela de cor e opacidade. */
export const LUT_SIZE = 4096;
/** Passo do raio: metade do menor voxel, mas não menos que 0,3 mm. */
export const STEP_FRACTION = 0.5;
export const MIN_STEP_MM = 0.3;

/** Opacidade por amostra num passo `step`, a partir da curva por `unit`. */
export function correctAlpha(alpha: number, step: number, unit: number) {
  if (alpha <= 0) return 0;
  return 1 - (1 - Math.min(alpha, 0.999999)) ** (step / unit);
}

export function buildTransfer(
  actor: vtkVolume,
  range: [number, number],
  step: number
): Transfer {
  const property = actor.getProperty();
  const rgb = new Float32Array(3 * LUT_SIZE);
  const raw = new Float32Array(LUT_SIZE);
  property
    .getRGBTransferFunction(0)
    .getTable(range[0], range[1], LUT_SIZE, rgb as unknown as number[]);
  property.getScalarOpacity(0).getTable(range[0], range[1], LUT_SIZE, raw);
  const unit = property.getScalarOpacityUnitDistance(0) || 1;
  const alpha = raw.map((a) => correctAlpha(a, step, unit));
  const shadowAlpha = raw.map((a) =>
    correctAlpha(a, step * SHADOW_STEP_FACTOR, unit)
  );
  const width = Math.max(range[1] - range[0], 1e-6);
  return {
    rgb,
    alpha,
    shadowAlpha,
    min: range[0],
    scale: (LUT_SIZE - 1) / width,
  };
}

function cameraOf(view: VtkViewApi): Camera {
  const camera = view.renderer.getActiveCamera();
  return {
    position: camera.getPosition() as Vec3,
    focalPoint: camera.getFocalPoint() as Vec3,
    viewUp: camera.getViewUp() as Vec3,
    viewAngle: camera.getViewAngle(),
    parallel: camera.getParallelProjection(),
    parallelScale: camera.getParallelScale(),
  };
}

/** Direção da luz no mundo: o preset escolhido ou, no padrão, a da câmera. */
function lightingOf(
  view: VtkViewApi,
  actor: vtkVolume,
  shadow: number
): Lighting {
  const camera = cameraOf(view);
  const forward = normalize([
    camera.focalPoint[0] - camera.position[0],
    camera.focalPoint[1] - camera.position[1],
    camera.focalPoint[2] - camera.position[2],
  ]);
  const up = normalize(camera.viewUp);
  const right = normalize([
    forward[1] * up[2] - forward[2] * up[1],
    forward[2] * up[0] - forward[0] * up[2],
    forward[0] * up[1] - forward[1] * up[0],
  ]);
  // no padrão a luz sai da câmera, um pouco acima, para a sombra aparecer
  const [x, y, z] =
    lightLook.preset === 'padrao'
      ? lightPosition({ direction: -15, height: 25 })
      : lightPosition(lightLook);
  const direction = normalize(
    [0, 1, 2].map((c) => x * right[c] + y * up[c] - z * forward[c]) as Vec3
  );
  const property = actor.getProperty();
  return {
    direction,
    intensity: lightLook.preset === 'padrao' ? 1 : lightLook.intensity,
    ambient: Math.max(property.getAmbient(), 0.15),
    diffuse: property.getDiffuse(),
    specular: property.getSpecular(),
    specularPower: Math.max(property.getSpecularPower(), 1),
    shadow,
  };
}

/** O que a escultura esconde e o osso, se algum dos dois muda a imagem. */
function sculptLayers(imageID: string, dims: Dims) {
  const sculpt = sculptOf(imageID, dims);
  const bone = boneOf(imageID, dims);
  const boneOpacity = boneViews[imageID]?.opacity ?? 1;
  return {
    hidden: sculpt?.count ? sculpt.hidden : null,
    bone: bone && boneOpacity < 1 ? bone : null,
    boneOpacity,
  };
}

/** A escultura (e o osso) da vista, ligada ao volume original. */
export function maskOf(imageID: string, original: vtkImageData): Mask | null {
  const base = baseImageOf(imageID);
  if (!base) return null;
  const dims = base.getDimensions() as Dims;
  const layers = sculptLayers(imageID, dims);
  if (!layers.hidden && !layers.bone) return null;
  const spacing = original.getSpacing();
  const factor = base
    .getSpacing()
    .map((s, a) => Math.max(1, Math.round(s / spacing[a]))) as Vec3;
  return { dims, factor, ...layers };
}

function axesOf(image: vtkImageData): [Vec3, Vec3, Vec3] {
  const m = image.getIndexToWorld();
  return [0, 1, 2].map((a) => [m[4 * a], m[4 * a + 1], m[4 * a + 2]]) as [
    Vec3,
    Vec3,
    Vec3,
  ];
}

export interface PhotoRequest {
  view: VtkViewApi;
  imageID: string;
  /** o volume original, em resolução total */
  image: vtkImageData;
  width: number;
  height: number;
  shadow: number;
}

/** Monta a entrada da foto; null se a vista ainda não tem volume. */
export function collect(request: PhotoRequest): PhotoInput | null {
  const { view, image } = request;
  const actor = view.renderer.getVolumes()[0];
  if (!actor) return null;
  const scalars = image.getPointData().getScalars();
  const range = scalars.getRange() as [number, number];
  const spacing = image.getSpacing();
  const step = Math.max(MIN_STEP_MM, Math.min(...spacing) * STEP_FRACTION);
  const background = view.renderer.getBackground().slice(0, 3) as Vec3;
  return {
    volume: {
      data: scalars.getData(),
      dims: image.getDimensions() as Vec3,
      worldToIndex: image.getWorldToIndex(),
      axes: axesOf(image),
    },
    transfer: buildTransfer(actor, range, step),
    mask: maskOf(request.imageID, image),
    camera: cameraOf(view),
    planes: actor
      .getMapper()!
      .getClippingPlanes()
      .map((plane) => ({
        origin: plane.getOrigin() as Vec3,
        normal: plane.getNormal() as Vec3,
      })),
    lighting: lightingOf(view, actor, request.shadow),
    background,
    width: request.width,
    height: request.height,
    step,
  };
}
