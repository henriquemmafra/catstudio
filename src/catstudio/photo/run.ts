/**
 * CatStudio — foto final: roda o renderizador aos poucos (sem travar a
 * página) e entrega o PNG.
 */
import { reactive } from 'vue';
import type vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import type { VtkViewApi } from '@/src/types/vtk-types';
import { download } from '@/src/catstudio/capture';
import { emptyBlocks, growBlocks, markSlice } from './raycast';
import { newJob, renderRows } from './trace';
import { collect } from './collect';

export interface PhotoStatus {
  running: boolean;
  /** 0–1 */
  progress: number;
  stage: string;
  message: string;
}

export const photoStatus = reactive<Record<string, PhotoStatus>>({});
const cancelled = new Set<string>();

/** Tempo de cada fatia de trabalho antes de devolver a vez à página. */
export const SLICE_MS = 40;
/** O maior lado da foto. */
export const MAX_PHOTO_SIDE = 4096;

const pause = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve);
  });

function statusOf(viewID: string): PhotoStatus {
  photoStatus[viewID] ??= {
    running: false,
    progress: 0,
    stage: '',
    message: '',
  };
  return photoStatus[viewID];
}

export function cancelPhoto(viewID: string) {
  cancelled.add(viewID);
}

/** Tamanho da foto: o da vista vezes `scale`, sem passar de 4096 px. */
export function photoSize(
  view: [number, number],
  scale: number
): [number, number] {
  const fit = Math.min(scale, MAX_PHOTO_SIDE / Math.max(view[0], view[1], 1));
  return [
    Math.max(1, Math.round(view[0] * fit)),
    Math.max(1, Math.round(view[1] * fit)),
  ];
}

/** Roda `work(n)` para n de 0 a total-1, em fatias, atualizando o status. */
async function inSlices(
  viewID: string,
  total: number,
  work: (n: number) => void,
  share: [number, number]
): Promise<boolean> {
  const status = statusOf(viewID);
  let n = 0;
  while (n < total) {
    const start = performance.now();
    while (n < total && performance.now() - start < SLICE_MS) {
      work(n);
      n += 1;
    }
    status.progress = share[0] + (share[1] * n) / total;
    await pause();
    if (cancelled.has(viewID)) return false;
  }
  return true;
}

function toPng(
  rgba: Uint8ClampedArray<ArrayBuffer>,
  width: number,
  height: number
) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas
    .getContext('2d')!
    .putImageData(new ImageData(rgba, width, height), 0, 0);
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/png');
  });
}

export interface PhotoOptions {
  view: VtkViewApi;
  viewID: string;
  imageID: string;
  image: vtkImageData;
  scale: number;
  shadow: number;
}

async function render(options: PhotoOptions, size: [number, number]) {
  const { viewID } = options;
  const status = statusOf(viewID);
  const input = collect({
    view: options.view,
    imageID: options.imageID,
    image: options.image,
    width: size[0],
    height: size[1],
    shadow: options.shadow,
  });
  if (!input) throw new Error('O 3D ainda não carregou.');
  const blocks = emptyBlocks(input.volume);
  status.stage = 'Preparando';
  const marked = await inSlices(
    viewID,
    input.volume.dims[2],
    (k) => markSlice(input.volume, input.transfer, blocks, k),
    [0, 0.08]
  );
  if (!marked) return null;
  growBlocks(blocks);
  const job = newJob(input, blocks);
  status.stage = 'Desenhando';
  const done = await inSlices(
    viewID,
    size[1],
    (row) => renderRows(job, row, row + 1),
    [0.08, 0.92]
  );
  return done ? job : null;
}

/** Faz a foto final da vista e baixa o PNG. */
export async function takePhoto(options: PhotoOptions) {
  const { viewID } = options;
  const status = statusOf(viewID);
  if (status.running) return;
  cancelled.delete(viewID);
  const [w, h] = options.view.renderWindowView.getSize() as [number, number];
  const size = photoSize([w, h], options.scale);
  Object.assign(status, {
    running: true,
    progress: 0,
    stage: 'Preparando',
    message: '',
  });
  const started = performance.now();
  try {
    const job = await render(options, size);
    if (!job) {
      status.message = 'Foto cancelada.';
      return;
    }
    const blob = await toPng(job.rgba, size[0], size[1]);
    if (!blob) throw new Error('Não deu para gerar o PNG.');
    await download(blob, `catstudio-foto-${size[0]}px-${Date.now()}.png`);
    const seconds = Math.round((performance.now() - started) / 1000);
    status.message = `Foto pronta: ${size[0]} × ${size[1]} px em ${seconds} s.`;
  } catch (error) {
    status.message = `Não deu: ${(error as Error).message}`;
  } finally {
    status.running = false;
    cancelled.delete(viewID);
  }
}
