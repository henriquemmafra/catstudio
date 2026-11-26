/**
 * CatStudio — escultura do 3D: o volume que a vista desenha.
 *
 * Sem edição, é o próprio volume. Com edição, é uma cópia em que os voxels
 * escondidos valem o mínimo do exame (ar). O exame original e as vistas 2D
 * nunca são tocados.
 */
import { type Ref, shallowRef, watch, onScopeDispose } from 'vue';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import type { TypedArray } from '@kitware/vtk.js/types';
import type { Maybe } from '@/src/types';
import type { Dims } from './mask';
import { sculptOf, sculptVersions } from './state';

/** Volumes-base por exame, para as ferramentas lerem os valores originais. */
const bases = new Map<string, vtkImageData>();
export const baseImageOf = (imageID: string) => bases.get(imageID) ?? null;

export function applyMask(
  source: ArrayLike<number>,
  hidden: Uint8Array,
  target: TypedArray,
  air: number
) {
  for (let i = 0; i < target.length; i++)
    target[i] = hidden[i] ? air : source[i];
}

function emptyCopy(base: vtkImageData): vtkImageData {
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
      numberOfComponents: source.getNumberOfComponents(),
      values: new Ctor(data.length),
    })
  );
  return copy;
}

export function useSculptedImage(
  imageID: Ref<Maybe<string>>,
  base: Ref<Maybe<vtkImageData>>
) {
  const output = shallowRef<Maybe<vtkImageData>>(null);
  let copy: vtkImageData | null = null;
  let copyOf: vtkImageData | null = null;

  const refresh = () => {
    const id = imageID.value;
    const image = base.value;
    if (id && image) bases.set(id, image);
    const sculpt =
      id && image ? sculptOf(id, image.getDimensions() as Dims) : null;
    if (!image || !sculpt?.count) {
      copy = null;
      copyOf = null;
      output.value = image ?? null;
      return;
    }
    if (copyOf !== image) {
      copy = emptyCopy(image);
      copyOf = image;
    }
    const source = image.getPointData().getScalars();
    const target = copy!.getPointData().getScalars();
    applyMask(
      source.getData(),
      sculpt.hidden,
      target.getData() as TypedArray,
      source.getRange()[0]
    );
    target.modified();
    copy!.modified();
    output.value = copy;
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
