/**
 * CatStudio — volume de cavidade: o que foi medido em cada exame e a imagem
 * de rótulos que os cortes 2D pintam por cima.
 */
import { reactive } from 'vue';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import type { Vec3 } from './grow';

export type CavityName = 'VE' | 'VD';

export const CAVITIES: Record<
  CavityName,
  { label: number; color: string; title: string }
> = {
  VE: { label: 1, color: '#ff4d6d', title: 'Ventrículo esquerdo' },
  VD: { label: 2, color: '#4d9dff', title: 'Ventrículo direito' },
};

export interface Measured {
  /** voxel de partida */
  seed: Vec3;
  /** densidade do sangue no ponto de partida (UH) */
  blood: number;
  /** limiar usado (UH) */
  low: number;
  ml: number;
  /** o crescimento bateu no teto: vazou */
  leaked: boolean;
  /** quantas réguas serviram de limite */
  walls: number;
}

/** A janela da ferramenta (aberta pela barra lateral). */
export const cavityMode = reactive({ open: false });

/** Resultado por exame e cavidade (o que a janela mostra). */
export const cavityResults = reactive<
  Record<string, Partial<Record<CavityName, Measured>>>
>({});

/** Sobe a cada mudança na imagem de rótulos de um exame. */
export const cavityVersions = reactive<Record<string, number>>({});

const labelImages = new Map<string, vtkImageData>();

/** A imagem de rótulos do exame (null se nada foi medido). */
export const labelsOf = (imageID: string) => labelImages.get(imageID) ?? null;

/** A imagem de rótulos do exame, criada com a geometria dele se preciso. */
export function ensureLabels(imageID: string, like: vtkImageData) {
  const existing = labelImages.get(imageID);
  if (existing) return existing;
  const dims = like.getDimensions();
  const image = vtkImageData.newInstance();
  image.setDimensions(dims);
  image.setSpacing(like.getSpacing());
  image.setOrigin(like.getOrigin());
  image.setDirection(like.getDirection());
  image.getPointData().setScalars(
    vtkDataArray.newInstance({
      numberOfComponents: 1,
      values: new Uint8Array(dims[0] * dims[1] * dims[2]),
    })
  );
  labelImages.set(imageID, image);
  return image;
}

export function touch(imageID: string) {
  const image = labelImages.get(imageID);
  image?.getPointData().getScalars().modified();
  image?.modified();
  cavityVersions[imageID] = (cavityVersions[imageID] ?? 0) + 1;
}

/** Esquece tudo de um exame (ele foi fechado). */
export function forgetCavities(imageID: string) {
  labelImages.get(imageID)?.delete();
  labelImages.delete(imageID);
  delete cavityResults[imageID];
  delete cavityVersions[imageID];
}
