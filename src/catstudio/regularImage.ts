/**
 * CatStudio — aloca o vtkImageData na grade regular do plano e prepara o
 * reamostrador. Substitui allocateImageFromChunks apenas quando a pilha não é
 * uniforme (tilt, lacunas, espaçamento irregular) ou é multi-frame enhanced.
 */
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import type { Vector3 } from '@kitware/vtk.js/types';
import type { mat3 } from 'gl-matrix';
import {
  getPixelFormat,
  getTypedArrayValueRange,
  getVolumeBufferType,
} from '@/src/utils/allocateImageFromChunks';
import type { Chunk } from '@/src/core/streaming/chunk';
import {
  CT,
  planForMetas,
  seriesLabel,
  type Meta,
  type Note,
} from './geometry';
import { StackResampler } from './resampler';

export interface RegularImage {
  image: vtkImageData;
  resampler: StackResampler;
  /** a grade de saída tem bordas sem dado (tilt): o valor de preenchimento entra na faixa */
  padded: boolean;
  fill: number;
}

export interface RegularizeOutcome {
  regular: RegularImage | null;
  notes: Note[];
  label: string;
  key: string;
}

export function regularizeChunks(chunks: Chunk[]): RegularizeOutcome | null {
  if (!chunks.length || chunks.some((c) => !c.metadata)) return null;
  const metas: Meta[] = chunks.map((c) => new Map(c.metadata!));
  const first = metas[0];
  if (Number(first.get('0028|0002') ?? 1) !== 1) return null; // só escalar
  const result = planForMetas(metas);
  if (!result) return null;
  const label = seriesLabel(first);
  const key = `${first.get('0020|000e') ?? ''}|${first.get(CT.SOPInstanceUID) ?? ''}|${chunks.length}`;
  if ('error' in result) {
    const multiFrame = chunks.length === 1;
    return {
      regular: null,
      label,
      key,
      notes: multiFrame
        ? [
            {
              title: 'Geometria dos quadros não reconstruída',
              detail: `${result.error} Os quadros são exibidos na ordem do arquivo, sem correção geométrica — não use para medidas.`,
            },
          ]
        : [],
    };
  }
  const { plan } = result;
  if (!plan.resample) return { regular: null, notes: plan.notes, label, key };

  const Ctor = getVolumeBufferType(metas.map((m) => getPixelFormat(m)));
  const [nx, ny, nz] = plan.dims;
  const buffer = new Ctor(nx * ny * nz);
  const modality = (first.get(CT.Modality) ?? '').trim();
  let fill = modality === 'CT' ? -1024 : 0;
  const range = getTypedArrayValueRange(Ctor);
  if (range) fill = Math.min(Math.max(fill, range.min), range.max);

  const image = vtkImageData.newInstance();
  image.setExtent([0, nx - 1, 0, ny - 1, 0, nz - 1]);
  image.setOrigin(plan.origin as Vector3);
  image.setSpacing(plan.spacing as Vector3);
  image.setDirection(plan.direction as unknown as mat3);
  const scalars = vtkDataArray.newInstance({
    numberOfComponents: 1,
    values: buffer,
  });
  image.getPointData().setScalars(scalars);
  scalars.setRange({ min: 0, max: 255 }, 0);

  const resampler = new StackResampler(plan, buffer, fill);
  return {
    regular: {
      image,
      resampler,
      padded: nx > plan.cols || ny > plan.rows,
      fill,
    },
    notes: plan.notes,
    label,
    key,
  };
}
