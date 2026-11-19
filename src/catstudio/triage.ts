/**
 * CatStudio — triagem de séries.
 *
 * Ao abrir a pasta de um exame, o VolView exibia logo a série com mais
 * imagens. Num exame de verdade essa costuma ser a pior escolha (tórax
 * inteiro em cortes finos, várias fases), e é ela que trava a página. Aqui,
 * depois de ler só os cabeçalhos, as séries são resumidas (tamanho,
 * espessura, plano), ordenadas por adequação à reconstrução 3D e mostradas
 * numa lista para a pessoa escolher o que carregar.
 *
 * A parte de cima do arquivo é pura (sem Vue), para testar isoladamente.
 */
import { reactive } from 'vue';
import { basisFromIOP, numbers, type Meta } from './geometry';

export interface SeriesSummary {
  id: string;
  number: string;
  description: string;
  modality: string;
  images: number;
  rows: number;
  cols: number;
  /** Distância entre cortes (mm), medida nas posições; senão, a espessura. */
  spacing: number | null;
  plane: 'Axial' | 'Coronal' | 'Sagital' | 'Oblíquo' | null;
  megabytes: number;
  /** aux = localizador, relatório de dose, captura de tela, poucas imagens. */
  kind: 'volume' | 'aux';
  notes: string[];
  score: number;
  recommended: boolean;
}

const T = {
  SOPClassUID: '0008|0016',
  ImageType: '0008|0008',
  Modality: '0008|0060',
  SeriesDescription: '0008|103e',
  SeriesNumber: '0020|0011',
  Rows: '0028|0010',
  Columns: '0028|0011',
  BitsAllocated: '0028|0100',
  SamplesPerPixel: '0028|0002',
  NumberOfFrames: '0028|0008',
  SliceThickness: '0018|0050',
  ImagePositionPatient: '0020|0032',
  ImageOrientationPatient: '0020|0037',
} as const;

const SECONDARY_CAPTURE = '1.2.840.10008.5.1.4.1.1.7';

const text = (meta: Meta, tag: string) => (meta.get(tag) ?? '').trim();
const int = (meta: Meta, tag: string, fallback: number) => {
  const value = Number(text(meta, tag));
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

function planeOf(meta: Meta): SeriesSummary['plane'] {
  const basis = basisFromIOP(numbers(meta.get(T.ImageOrientationPatient)));
  if (!basis) return null;
  const [x, y, z] = basis.normal.map(Math.abs);
  if (z > 0.9) return 'Axial';
  if (y > 0.9) return 'Coronal';
  if (x > 0.9) return 'Sagital';
  return 'Oblíquo';
}

/** Distância entre os dois primeiros cortes ao longo da normal (mm). */
function spacingOf(metas: Meta[]): number | null {
  if (metas.length >= 2) {
    const basis = basisFromIOP(
      numbers(metas[0].get(T.ImageOrientationPatient))
    );
    const a = numbers(metas[0].get(T.ImagePositionPatient));
    const b = numbers(metas[1].get(T.ImagePositionPatient));
    if (basis && a?.length === 3 && b?.length === 3) {
      const n = basis.normal;
      const d = Math.abs(
        (b[0] - a[0]) * n[0] + (b[1] - a[1]) * n[1] + (b[2] - a[2]) * n[2]
      );
      if (d > 0.01) return d;
    }
  }
  const thickness = Number(text(metas[0], T.SliceThickness));
  return Number.isFinite(thickness) && thickness > 0 ? thickness : null;
}

const RX = {
  localizer: /scout|topogra|localiz|surview|scanogram|scano\b/i,
  report: /dose|report|relat[oó]rio|screen|captura|protocol|summary/i,
  reformat: /\bmip\b|\bmpr\b|\bvr\b|\b3d\b|cpr|curv|reformat|batch|ssd/i,
  contrast: /angio|\bcta\b|coron|card|arterial|contrast|c\+|aort|tavi|\bcor\b/i,
  plain:
    /sem contraste|s\/c\b|s\/ ?contr|c[aá]lcio|calcium|escore|score|\bcacs\b/i,
  sharp: /pulm|lung|\bosso|bone|\bfc5|\bb[67]0|\bbl5|yc\b/i,
};

function auxReason(meta: Meta, description: string, frames: number) {
  const imageType = text(meta, T.ImageType).toUpperCase();
  if (imageType.includes('LOCALIZER') || RX.localizer.test(description))
    return 'Localizador';
  const isCapture = text(meta, T.SOPClassUID).startsWith(SECONDARY_CAPTURE);
  if (
    isCapture ||
    RX.report.test(description) ||
    int(meta, T.SamplesPerPixel, 1) > 1
  )
    return 'Captura ou relatório';
  if (frames < 20) return 'Poucas imagens';
  return null;
}

function spacingScore(spacing: number | null, notes: string[]) {
  if (spacing == null) return 0;
  if (spacing <= 1.0) return 30;
  if (spacing <= 1.5) return 22;
  if (spacing <= 2.5) return 10;
  notes.push('Cortes espessos');
  return 0;
}

/** Nota de adequação ao 3D de uma série de volume. */
function volumeScore(
  description: string,
  spacing: number | null,
  plane: SeriesSummary['plane'],
  notes: string[]
) {
  let score = spacingScore(spacing, notes);
  if (plane === 'Axial') score += 10;
  if (RX.reformat.test(description)) {
    score -= 25;
    notes.push('Reconstrução pronta');
  }
  if (RX.contrast.test(description)) score += 12;
  if (RX.plain.test(description)) score -= 10;
  if (RX.sharp.test(description)) score -= 5;
  return score;
}

/**
 * Resume uma pilha (já ordenada) a partir dos cabeçalhos de cada imagem.
 * A nota é só um critério de ordenação para a sugestão; nada é descartado
 * automaticamente.
 */
export function summarizeSeries(id: string, metas: Meta[]): SeriesSummary {
  const first = metas[0];
  const description = text(first, T.SeriesDescription);
  const modality = text(first, T.Modality);
  const rows = int(first, T.Rows, 0);
  const cols = int(first, T.Columns, 0);
  const frames = metas.reduce((n, m) => n + int(m, T.NumberOfFrames, 1), 0);
  const bytes =
    (int(first, T.BitsAllocated, 16) / 8) * int(first, T.SamplesPerPixel, 1);
  const spacing = spacingOf(metas);
  const plane = planeOf(first);

  const notes: string[] = [];
  const aux = auxReason(first, description, frames);
  if (aux) notes.push(aux);
  const base = ['CT', 'MR', 'PT'].includes(modality) ? 10 : 0;
  const score = aux
    ? -100
    : base + volumeScore(description, spacing, plane, notes);

  return {
    id,
    number: text(first, T.SeriesNumber),
    description,
    modality,
    images: frames,
    rows,
    cols,
    spacing,
    plane,
    megabytes: (rows * cols * frames * bytes) / 1048576,
    kind: aux ? 'aux' : 'volume',
    notes,
    score,
    recommended: false,
  };
}

const seriesOrder = (a: SeriesSummary, b: SeriesSummary) =>
  (Number(a.number) || 0) - (Number(b.number) || 0) || a.id.localeCompare(b.id);

/** Marca a série sugerida e as fases de uma mesma série. */
export function rankSeries(list: SeriesSummary[]): SeriesSummary[] {
  const out = list.map((s) => ({ ...s, notes: [...s.notes] }));
  const bySeries = new Map<string, SeriesSummary[]>();
  out.forEach((s) => {
    const base = s.id.split('~')[0];
    bySeries.set(base, [...(bySeries.get(base) ?? []), s]);
  });
  bySeries.forEach((parts) => {
    if (parts.length < 2) return;
    parts
      .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
      .forEach((s, n) => s.notes.unshift(`Parte ${n + 1} de ${parts.length}`));
  });
  const best = out
    .filter((s) => s.kind === 'volume' && s.score > 0)
    .sort((a, b) => b.score - a.score || seriesOrder(a, b))[0];
  if (best) best.recommended = true;
  return out.sort(seriesOrder);
}

/** A lista só aparece quando há o que escolher e o exame é grande. */
export const TRIAGE_MIN_MEGABYTES = 200;

export function needsTriage(list: SeriesSummary[]) {
  if (list.length < 2) return false;
  return list.reduce((n, s) => n + s.megabytes, 0) > TRIAGE_MIN_MEGABYTES;
}

// --------------------------------------------------------------- interface

interface Pending {
  list: SeriesSummary[];
  resolve: (ids: string[]) => void;
}

export const triage = reactive({
  /** Ligado pelo diálogo ao ser montado; sem ele nada é perguntado. */
  available: false,
  pending: null as Pending | null,
  /** Nota de cada volume da última importação (ordem de exibição). */
  scores: {} as Record<string, number>,
});

export function scoreOf(id: string): number | undefined {
  return triage.scores[id];
}

/**
 * Recebe as pilhas já separadas e devolve só as que devem ser carregadas.
 * Sem interface montada (testes unitários, restauração de sessão) ou com
 * exame pequeno, devolve tudo.
 */
export async function triageVolumes<T>(
  volumes: Record<string, T[]>,
  metaOf: (item: T) => Meta | null | undefined,
  options: { ask?: boolean } = {}
): Promise<Record<string, T[]>> {
  const summaries: SeriesSummary[] = [];
  Object.entries(volumes).forEach(([id, items]) => {
    const metas = items.map((it) => metaOf(it));
    if (!items.length || metas.some((m) => !m)) return;
    summaries.push(summarizeSeries(id, metas as Meta[]));
  });
  const ranked = rankSeries(summaries);
  ranked.forEach((s) => {
    triage.scores[s.id] = s.score;
  });

  const complete = summaries.length === Object.keys(volumes).length;
  if (
    options.ask === false ||
    !triage.available ||
    !complete ||
    !needsTriage(ranked)
  )
    return volumes;

  const chosen = await new Promise<string[]>((resolve) => {
    triage.pending = { list: ranked, resolve };
  });
  triage.pending = null;
  const keep = new Set(chosen);
  return Object.fromEntries(
    Object.entries(volumes).filter(([id]) => keep.has(id))
  );
}
