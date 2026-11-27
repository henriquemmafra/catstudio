/**
 * CatStudio — escultura do 3D: o volume que a vista desenha.
 *
 * Sem edição, é o próprio volume. Com edição, é uma cópia em que os voxels
 * escondidos valem o mínimo do exame (ar). O exame original e as vistas 2D
 * nunca são tocados.
 */
import { type Ref, reactive, shallowRef, watch, onScopeDispose } from 'vue';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import type { TypedArray } from '@kitware/vtk.js/types';
import type { Maybe } from '@/src/types';
import type { Dims } from './mask';
import {
  type BoneMode,
  boneModeFor,
  boneOf,
  boneViews,
  highlightOf,
  highlightViews,
  layersOf,
  sculptOf,
  sculptVersions,
} from './state';

/** Volumes-base por exame, para as ferramentas lerem os valores originais. */
const bases = new Map<string, vtkImageData>();
/** Muda quando o volume-base de um exame chega ou é trocado. */
export const baseVersions = reactive<Record<string, number>>({});
export const baseImageOf = (imageID: string) => bases.get(imageID) ?? null;

function registerBase(imageID: string, image: vtkImageData) {
  if (bases.get(imageID) === image) return;
  bases.set(imageID, image);
  baseVersions[imageID] = (baseVersions[imageID] ?? 0) + 1;
}

export interface Layers {
  /** 1 = escondido pela escultura */
  hidden: Uint8Array | null;
  /** > 0 = osso (ou a franja dele) */
  bone: Uint8Array | null;
}

/**
 * Osso translúcido: dois componentes por voxel. O primeiro leva tudo menos o
 * osso; o segundo, só o osso. A vista mistura os dois com pesos diferentes.
 */
export function applySplit(
  source: ArrayLike<number>,
  layers: Layers,
  target: TypedArray,
  air: number
) {
  const { hidden, bone } = layers;
  for (let i = 0; i < source.length; i++) {
    const gone = hidden ? hidden[i] === 1 : false;
    const isBone = bone ? bone[i] > 0 : false;
    target[2 * i] = gone || isBone ? air : source[i];
    target[2 * i + 1] = !gone && isBone ? source[i] : air;
  }
}

/** Um componente só: escondidos (e o osso, se `bone` vier) viram ar. */
export function applyHidden(
  source: ArrayLike<number>,
  layers: Layers,
  target: TypedArray,
  air: number
) {
  const { hidden, bone } = layers;
  for (let i = 0; i < target.length; i++) {
    const gone = (hidden ? hidden[i] : 0) || (bone ? bone[i] : 0);
    target[i] = gone ? air : source[i];
  }
}

function emptyCopy(base: vtkImageData, components: number): vtkImageData {
  const source = base.getPointData().getScalars();
  const data = source.getData() as TypedArray;
  const Ctor = data.constructor as new (n: number) => TypedArray;
  const copy = vtkImageData.newInstance();
  copy.setDimensions(base.getDimensions());
  copy.setSpacing(base.getSpacing());
  copy.setOrigin(base.getOrigin());
  copy.setDirection(base.getDirection());
  copy.getPointData().setScalars(
    vtkDataArray.newInstance({
      name: source.getName(),
      numberOfComponents: components,
      values: new Ctor(data.length * components),
    })
  );
  return copy;
}

interface Plan {
  mode: BoneMode;
  layers: Layers;
}

/** União de duas máscaras (qualquer uma pode faltar). */
export function union(
  a: Uint8Array | null,
  b: Uint8Array | null
): Uint8Array | null {
  if (!a || !b) return a ?? b;
  const out = new Uint8Array(a.length);
  for (let i = 0; i < out.length; i++) out[i] = a[i] | b[i];
  return out;
}

/** O que está escondido: a escultura mais as camadas desligadas. */
export function hiddenOf(imageID: string, dims: Dims): Uint8Array | null {
  const sculpt = sculptOf(imageID, dims);
  return union(
    sculpt?.count ? sculpt.hidden : null,
    layersOf(imageID, dims)?.hidden ?? null
  );
}

/**
 * O segundo componente do volume (quando há) é o destaque, se houver um;
 * senão, o osso translúcido.
 */
export const focusOf = (imageID: string): 'destaque' | 'osso' =>
  (highlightViews[imageID]?.voxels ?? 0) > 0 ? 'destaque' : 'osso';

/** O que precisa mudar no volume deste exame; null = desenhar o original. */
function planFor(imageID: string, image: vtkImageData): Plan | null {
  const dims = image.getDimensions() as Dims;
  const hidden = hiddenOf(imageID, dims);
  const highlight = highlightOf(imageID, dims);
  if (highlight) return { mode: 'split', layers: { hidden, bone: highlight } };
  const label = boneOf(imageID, dims);
  const mode = label ? boneModeFor(boneViews[imageID]?.opacity ?? 1) : 'none';
  if (!hidden && mode === 'none') return null;
  return { mode, layers: { hidden, bone: mode === 'none' ? null : label } };
}

export function useSculptedImage(
  imageID: Ref<Maybe<string>>,
  base: Ref<Maybe<vtkImageData>>
) {
  const output = shallowRef<Maybe<vtkImageData>>(null);
  let copy: vtkImageData | null = null;
  let copyOf: vtkImageData | null = null;

  const copyWith = (image: vtkImageData, components: number) => {
    const current = copy?.getPointData().getScalars().getNumberOfComponents();
    if (copyOf !== image || current !== components) {
      copy = emptyCopy(image, components);
      copyOf = image;
    }
    return copy!;
  };

  const refresh = () => {
    const id = imageID.value;
    const image = base.value;
    if (id && image) registerBase(id, image);
    const plan = id && image ? planFor(id, image) : null;
    if (!image || !plan) {
      copy = null;
      copyOf = null;
      output.value = image ?? null;
      return;
    }
    const split = plan.mode === 'split';
    const result = copyWith(image, split ? 2 : 1);
    const source = image.getPointData().getScalars();
    const target = result.getPointData().getScalars();
    const fill = split ? applySplit : applyHidden;
    fill(
      source.getData(),
      plan.layers,
      target.getData() as TypedArray,
      source.getRange()[0]
    );
    target.modified();
    result.modified();
    output.value = result;
  };

  watch(
    [base, imageID, () => (imageID.value ? sculptVersions[imageID.value] : 0)],
    refresh,
    { immediate: true }
  );

  onScopeDispose(() => {
    const id = imageID.value;
    if (id && bases.get(id) === base.value) bases.delete(id);
    copy = null;
    copyOf = null;
  });

  return output;
}
