/**
 * CatStudio — filtro da pasta de exame.
 *
 * O CD/exportação de um PACS traz, ao lado dos DICOM, o visualizador, as
 * miniaturas em JPG de cada corte, logotipos e arquivos de índice. Sem
 * filtro, cada JPG virava um "exame" 2D próprio (centenas de itens na lista
 * e de leituras na fila) e o resto virava erro — a página engasgava antes de
 * chegar aos DICOM. Quando a seleção contém DICOM, só eles (e os formatos de
 * volume/sessão) seguem para a importação.
 */
import { getFileMimeFromMagic } from '@/src/io/magic';
import { FILE_EXT_TO_MIME, FILE_EXTENSIONS } from '@/src/io/mimeTypes';

const DICOM_MIME = FILE_EXT_TO_MIME.dcm;
/** Imagens de tela: miniaturas, logotipos, capturas. */
const RASTER_MIMES = new Set(['image/jpeg', 'image/png', 'image/tiff']);
const MAGIC_BATCH = 64;

/** Tipo pelo nome (aceita extensão dupla, como .nii.gz). */
export function mimeFromName(name: string): string | undefined {
  const parts = name.toLowerCase().split('.');
  for (let i = 1; i < parts.length; i += 1) {
    const ext = parts.slice(i).join('.');
    if (FILE_EXTENSIONS.has(ext)) return FILE_EXT_TO_MIME[ext];
  }
  return undefined;
}

export type IsDicom = (file: File) => Promise<boolean>;

const isDicomByMagic: IsDicom = async (file) =>
  (await getFileMimeFromMagic(file)) === DICOM_MIME;

export interface FolderFilterResult {
  kept: File[];
  skipped: File[];
}

/**
 * Separa o que deve ser importado. Sem nenhum DICOM na seleção nada muda
 * (abrir um JPG ou um NIfTI sozinho continua funcionando).
 */
export async function filterExamFiles(
  files: File[],
  isDicom: IsDicom = isDicomByMagic
): Promise<FolderFilterResult> {
  if (files.length < 2) return { kept: files, skipped: [] };

  const byName = files.map((file) => mimeFromName(file.name));
  const dicom: boolean[] = new Array(files.length).fill(false);
  for (let start = 0; start < files.length; start += MAGIC_BATCH) {
    const end = Math.min(start + MAGIC_BATCH, files.length);
    const batch: Promise<void>[] = [];
    for (let i = start; i < end; i += 1) {
      if (byName[i] === DICOM_MIME) dicom[i] = true;
      else
        batch.push(
          isDicom(files[i])
            .catch(() => false)
            .then((yes) => {
              dicom[i] = yes;
            })
        );
    }
    await Promise.all(batch);
  }

  if (!dicom.some(Boolean)) return { kept: files, skipped: [] };

  const kept: File[] = [];
  const skipped: File[] = [];
  files.forEach((file, i) => {
    const mime = byName[i];
    const keep = dicom[i] || (mime !== undefined && !RASTER_MIMES.has(mime));
    (keep ? kept : skipped).push(file);
  });
  return { kept, skipped };
}
