/**
 * CatStudio — mede uma cavidade no exame aberto: o ponto de partida é o
 * cruzamento dos três cortes (axial, coronal, sagital) e as réguas
 * desenhadas no exame servem de plano-limite.
 */
import type vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useViewStore } from '@/src/store/views';
import useViewSliceStore from '@/src/store/view-configs/slicing';
import { useRulerStore } from '@/src/store/tools/rulers';
import { volume2DViewsOfImage } from '@/src/core/views/effectiveView';
import {
  MIN_BLOOD_HU,
  bloodAt,
  growCavity,
  suggestLow,
  wallFromLine,
  type Vec3,
  type Wall,
} from './grow';
import {
  CAVITIES,
  cavityResults,
  ensureLabels,
  forgetCavities,
  touch,
  type CavityName,
  type Measured,
} from './state';

/** Acima disto, o crescimento vazou (nenhum ventrículo chega aqui). */
export const MAX_ML = 700;

/** O voxel onde os três cortes se cruzam. */
export function seedOf(imageID: string): Vec3 {
  const metadata = useImageCacheStore().getImageMetadata(imageID);
  if (!metadata) throw new Error('exame sem imagem.');
  const sliceStore = useViewSliceStore();
  const seed: number[] = [NaN, NaN, NaN];
  volume2DViewsOfImage(imageID, useViewStore().getAllViews()).forEach(
    ({ viewId, axis }) => {
      const slice = sliceStore.getConfig(viewId, imageID)?.slice;
      if (slice != null)
        seed[metadata.lpsOrientation[axis]] = Math.round(slice);
    }
  );
  if (seed.some(Number.isNaN))
    throw new Error(
      'preciso dos três cortes (axial, coronal e sagital) na tela para saber o ponto de partida.'
    );
  return seed as Vec3;
}

/** As réguas do exame, como planos-limite. */
export function wallsOf(imageID: string, image: vtkImageData): Wall[] {
  const toWorld = image.getIndexToWorld();
  return useRulerStore()
    .finishedTools.filter((ruler) => ruler.imageID === imageID)
    .flatMap((ruler) => {
      const wall = wallFromLine(
        {
          first: ruler.firstPoint as Vec3,
          second: ruler.secondPoint as Vec3,
          viewNormal: ruler.frameOfReference.planeNormal as Vec3,
        },
        toWorld
      );
      return wall ? [wall] : [];
    });
}

let listening = false;
function forgetClosedExams() {
  if (listening) return;
  listening = true;
  useImageCacheStore().onImageDeleted((ids) => ids.forEach(forgetCavities));
}

export interface MeasureOptions {
  /** limiar (UH); sem isto, o sugerido pelo sangue no ponto de partida */
  low?: number;
  /** usar as réguas como limite */
  useRulers: boolean;
  /** partir de novo do cruzamento dos cortes (senão, do ponto já usado) */
  reseed: boolean;
}

/** Mede (ou mede de novo) a cavidade. */
export function measureCavity(
  imageID: string,
  name: CavityName,
  options: MeasureOptions
): Measured {
  const image = useImageCacheStore().getVtkImageData(imageID);
  if (!image) throw new Error('exame sem imagem.');
  forgetClosedExams();
  const dims = image.getDimensions() as Vec3;
  const scalars = image.getPointData().getScalars().getData();
  const previous = cavityResults[imageID]?.[name];
  const seed = options.reseed || !previous ? seedOf(imageID) : previous.seed;
  const blood = bloodAt({ dims, scalars }, seed);
  if (blood < MIN_BLOOD_HU)
    throw new Error(
      `o cruzamento dos cortes está em ${Math.round(blood)} UH: ponha os três cortes dentro da cavidade contrastada.`
    );
  const low = options.low ?? suggestLow(blood);
  const walls = options.useRulers ? wallsOf(imageID, image) : [];
  const labels = ensureLabels(imageID, image);
  const out = labels.getPointData().getScalars().getData() as Uint8Array;
  const { label } = CAVITIES[name];
  for (let index = 0; index < out.length; index++)
    if (out[index] === label) out[index] = 0;
  const [sx, sy, sz] = image.getSpacing();
  const voxelMl = (sx * sy * sz) / 1000;
  const result = growCavity(
    { dims, scalars, seed, low, walls, maxVoxels: Math.ceil(MAX_ML / voxelMl) },
    out,
    label
  );
  const measured: Measured = {
    seed,
    blood,
    low,
    ml: result.voxels * voxelMl,
    leaked: result.leaked,
    walls: walls.length,
  };
  cavityResults[imageID] = { ...cavityResults[imageID], [name]: measured };
  touch(imageID);
  return measured;
}

export function clearCavity(imageID: string, name: CavityName) {
  const image = useImageCacheStore().getVtkImageData(imageID);
  if (!image || !cavityResults[imageID]?.[name]) return;
  const out = ensureLabels(imageID, image)
    .getPointData()
    .getScalars()
    .getData() as Uint8Array;
  const { label } = CAVITIES[name];
  for (let index = 0; index < out.length; index++)
    if (out[index] === label) out[index] = 0;
  const rest = { ...cavityResults[imageID] };
  delete rest[name];
  cavityResults[imageID] = rest;
  touch(imageID);
}
