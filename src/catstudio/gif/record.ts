/**
 * CatStudio — grava o GIF do 3D girando: põe a câmera em cada ângulo, espera
 * o quadro ficar pronto, copia a imagem e monta o arquivo. No fim a câmera
 * volta para onde estava.
 */
import { GIFEncoder, applyPalette, quantize } from 'gifenc';
import { vec3 } from 'gl-matrix';
import type { VtkViewApi } from '@/src/types/vtk-types';
import { download } from '@/src/catstudio/capture';
import {
  gifSize,
  playOrder,
  sweep,
  turned,
  type Pose,
  type SpinOptions,
} from './spin';

export interface RecordOptions extends SpinOptions {
  /** lado maior do GIF, em pixels */
  side: number;
  /** tempo de cada quadro, em ms */
  delay: number;
  /** espera a vista terminar o quadro */
  settle: () => Promise<void>;
  onProgress?: (done: number, total: number) => void;
  /** devolve true para parar no meio */
  cancelled?: () => boolean;
}

function poseOf(view: VtkViewApi): Pose {
  const camera = view.renderer.getActiveCamera();
  return {
    position: vec3.clone(camera.getPosition() as unknown as vec3),
    focalPoint: vec3.clone(camera.getFocalPoint() as unknown as vec3),
    viewUp: vec3.clone(camera.getViewUp() as unknown as vec3),
  };
}

function pose(view: VtkViewApi, to: Pose) {
  const camera = view.renderer.getActiveCamera();
  camera.setPosition(to.position[0], to.position[1], to.position[2]);
  camera.setFocalPoint(to.focalPoint[0], to.focalPoint[1], to.focalPoint[2]);
  camera.setViewUp(to.viewUp[0], to.viewUp[1], to.viewUp[2]);
  view.renderer.resetCameraClippingRange();
  view.renderer.updateLightsGeometryToFollowCamera();
  view.requestRender({ immediate: true });
}

/** Grava e devolve os bytes do GIF (null se foi cancelado). */
export async function recordSpin(
  view: VtkViewApi,
  options: RecordOptions
): Promise<Uint8Array | null> {
  const canvas = view.renderWindowView.getCanvas() as HTMLCanvasElement | null;
  if (!canvas) throw new Error('Vista sem imagem para gravar');
  const [width, height] = gifSize(canvas.width, canvas.height, options.side);
  const copy = document.createElement('canvas');
  copy.width = width;
  copy.height = height;
  const pen = copy.getContext('2d', { willReadFrequently: true });
  if (!pen) throw new Error('Sem como copiar a imagem');
  const base = poseOf(view);
  const angles = sweep(options.arc);
  const frames: { index: Uint8Array; palette: number[][] }[] = [];
  try {
    for (let i = 0; i < angles.length; i++) {
      if (options.cancelled?.()) return null;
      pose(view, turned(base, options.axis, angles[i]));
      await options.settle();
      pen.drawImage(canvas, 0, 0, width, height);
      const { data } = pen.getImageData(0, 0, width, height);
      const palette = quantize(data, 256);
      frames.push({ index: applyPalette(data, palette), palette });
      options.onProgress?.(i + 1, angles.length);
    }
  } finally {
    pose(view, base);
  }
  const gif = GIFEncoder();
  playOrder(frames.length, options.motion).forEach((at) =>
    gif.writeFrame(frames[at].index, width, height, {
      palette: frames[at].palette,
      delay: options.delay,
    })
  );
  gif.finish();
  return gif.bytes();
}

export async function saveSpin(bytes: Uint8Array, options: SpinOptions) {
  const name = `catstudio-3d-${options.motion}-${options.arc}-${options.axis}.gif`;
  await download(new Blob([bytes as BlobPart], { type: 'image/gif' }), name);
}
