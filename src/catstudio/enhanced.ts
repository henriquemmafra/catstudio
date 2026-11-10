/**
 * CatStudio — geometria de arquivos multi-frame "Enhanced" (CT/MR/PET e
 * Legacy Converted). A posição de cada quadro fica nos Functional Groups
 * (5200,9230), que o leitor de tags do VolView não expõe. Aqui o cabeçalho é
 * lido com dicom-parser (já usado pelo VolView para OCT) e a geometria é
 * promovida para as tags de topo, mais a lista de posições de cada quadro em
 * CT.FramePositions (consumida por planForMetas).
 */
import dicomParser, { type DataSet } from 'dicom-parser';
import { CT, numbers } from './geometry';

const SHARED = 'x52009229';
const PER_FRAME = 'x52009230';
const MEASURES = 'x00289110';
const ORIENTATION = 'x00209116';
const POSITION = 'x00209113';
const VALUE_TRANSFORM = 'x00289145';
const PIXEL_SPACING = 'x00280030';
const IMAGE_ORIENTATION = 'x00200037';
const IMAGE_POSITION = 'x00200032';
const RESCALE_INTERCEPT = 'x00281052';
const RESCALE_SLOPE = 'x00281053';
const PIXEL_DATA = 'x7fe00010';
const SEQUENCES = new Set([
  SHARED,
  PER_FRAME,
  MEASURES,
  ORIENTATION,
  POSITION,
  VALUE_TRANSFORM,
]);

const OCT_OR_US = /^(OPT|OCT|US|XA|RF|ES|XC|OP)$/;

const first = (data: DataSet | undefined, tag: string) =>
  data?.elements[tag]?.items?.[0]?.dataSet;
const str = (data: DataSet | undefined, tag: string) =>
  data?.string(tag)?.trim() || undefined;

async function readHeader(file: Blob): Promise<DataSet | null> {
  let length = Math.min(file.size, 256 * 1024);
  for (;;) {
    const complete = length === file.size;
    const bytes = new Uint8Array(await file.slice(0, length).arrayBuffer());
    try {
      const data = dicomParser.parseDicom(bytes, {
        untilTag: PIXEL_DATA,
        vrCallback: (tag: string) => (SEQUENCES.has(tag) ? 'SQ' : undefined),
      } as any);
      if (complete || data.elements[PIXEL_DATA]) return data;
    } catch {
      if (complete) return null;
    }
    length = Math.min(file.size, length * 4);
  }
}

export function isEnhancedCandidate(metadata: Array<[string, string]>) {
  const tags = new Map(metadata);
  const frames = Number(tags.get(CT.NumberOfFrames) ?? 1);
  const modality = (tags.get(CT.Modality) ?? '').trim();
  if (!(frames > 1) || OCT_OR_US.test(modality)) return false;
  // Já tem geometria completa no topo (ex.: NM/SC multi-frame simples): não mexe.
  return !numbers(tags.get(CT.ImagePositionPatient));
}

/**
 * Devolve os metadados com a geometria dos Functional Groups promovida.
 * Sem alterações quando o arquivo não é multi-frame enhanced ou a leitura falha.
 */
export async function augmentEnhancedMetadata(
  file: Blob,
  metadata: Array<[string, string]>
): Promise<Array<[string, string]>> {
  if (!isEnhancedCandidate(metadata)) return metadata;
  let data: DataSet | null = null;
  try {
    data = await readHeader(file);
  } catch {
    data = null;
  }
  if (!data) return metadata;
  const shared = first(data, SHARED);
  const frames =
    data.elements[PER_FRAME]?.items?.map((item) => item.dataSet) ?? [];
  if (!frames.length) return metadata;

  const attr = (frame: DataSet | undefined, seq: string, tag: string) =>
    str(first(shared, seq), tag) ??
    str(first(frame, seq), tag) ??
    str(data!, tag);

  const iop = attr(frames[0], ORIENTATION, IMAGE_ORIENTATION);
  const spacing = attr(frames[0], MEASURES, PIXEL_SPACING);
  // quadros com orientação ou pixel diferentes não formam um volume
  const consistent = frames.every(
    (f) =>
      attr(f, ORIENTATION, IMAGE_ORIENTATION) === iop &&
      attr(f, MEASURES, PIXEL_SPACING) === spacing
  );
  const positions = frames.map((f) =>
    numbers(str(first(f, POSITION), IMAGE_POSITION))
  );
  if (
    !iop ||
    !spacing ||
    !consistent ||
    positions.some((p) => !p || p.length !== 3)
  )
    return metadata;

  const tags = new Map(metadata);
  tags.set(CT.ImageOrientationPatient, iop);
  tags.set(CT.PixelSpacing, spacing);
  tags.set(CT.ImagePositionPatient, positions[0]!.join('\\'));
  tags.set(CT.FramePositions, JSON.stringify(positions));
  const intercept = attr(frames[0], VALUE_TRANSFORM, RESCALE_INTERCEPT);
  const slope = attr(frames[0], VALUE_TRANSFORM, RESCALE_SLOPE);
  if (intercept && !tags.get('0028|1052')) tags.set('0028|1052', intercept);
  if (slope && !tags.get('0028|1053')) tags.set('0028|1053', slope);
  return [...tags.entries()];
}
