/**
 * CatStudio — geometria de séries DICOM no navegador.
 *
 * O VolView monta o volume a partir do primeiro e do último corte e supõe
 * cortes igualmente espaçados ao longo da normal. Isso é exato para a maioria
 * das TCs, mas falha (silenciosamente) com gantry inclinado, espaçamento
 * irregular, cortes faltando, aquisições repetidas na mesma série, séries com
 * matrizes diferentes e Enhanced CT multi-frame.
 *
 * Este módulo é puro (sem Vue, sem VTK) para poder ser testado isoladamente:
 *  - refineVolumes: separa pilhas que não podem formar um único volume;
 *  - planStack: decide se a pilha precisa ser reamostrada e calcula a grade
 *    regular de saída, alinhada ao plano de aquisição (interpolação linear ao
 *    longo da normal; deslocamento no plano para compensar o tilt, com
 *    Catmull-Rom limitado — ver resampler.ts).
 */

export type Meta = Map<string, string>;

export const CT = {
  SOPInstanceUID: '0008|0018',
  SOPClassUID: '0008|0016',
  Modality: '0008|0060',
  ImageType: '0008|0008',
  Rows: '0028|0010',
  Columns: '0028|0011',
  ImagePositionPatient: '0020|0032',
  ImageOrientationPatient: '0020|0037',
  PixelSpacing: '0028|0030',
  NumberOfFrames: '0028|0008',
  AcquisitionNumber: '0020|0012',
  TemporalPositionIdentifier: '0020|0100',
  InstanceNumber: '0020|0013',
  /** Chave interna (não é uma tag DICOM): posições de cada quadro de um multi-frame. */
  FramePositions: 'catstudio|frame-positions',
} as const;

/** Distância (mm) abaixo da qual duas posições de corte são consideradas a mesma. */
export const SAME_POSITION_MM = 0.01;

export function numbers(value: string | null | undefined): number[] | null {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  const out = text.split('\\').map((v) => Number(v.trim()));
  return out.every(Number.isFinite) ? out : null;
}

export type Vec3 = [number, number, number];

const dot = (a: ArrayLike<number>, b: ArrayLike<number>) =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: ArrayLike<number>, b: ArrayLike<number>): Vec3 => [
  a[0] - b[0],
  a[1] - b[1],
  a[2] - b[2],
];
const cross = (a: ArrayLike<number>, b: ArrayLike<number>): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: ArrayLike<number>) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: ArrayLike<number>): Vec3 => {
  const n = norm(a);
  return [a[0] / n, a[1] / n, a[2] / n];
};

export interface Basis {
  row: Vec3;
  col: Vec3;
  normal: Vec3;
}

/** Base ortonormal a partir de ImageOrientationPatient, ou null se inválida. */
export function basisFromIOP(iop: number[] | null): Basis | null {
  if (!iop || iop.length !== 6 || !iop.every(Number.isFinite)) return null;
  const r = iop.slice(0, 3);
  const c = iop.slice(3, 6);
  if (Math.abs(norm(r) - 1) > 1e-3 || Math.abs(norm(c) - 1) > 1e-3)
    return null;
  if (Math.abs(dot(r, c)) > 1e-3) return null;
  const row = unit(r);
  const col = unit(c);
  return { row, col, normal: unit(cross(row, col)) };
}

export interface InstanceInfo {
  sop: string;
  rows: number;
  cols: number;
  frames: number;
  iop: number[] | null;
  ipp: number[] | null;
  /** [espaçamento ao longo da linha (x), ao longo da coluna (y)] em mm */
  pixel: [number, number] | null;
  acquisition: string;
  temporal: string;
}

export function instanceInfo(meta: Meta): InstanceInfo {
  const ps = numbers(meta.get(CT.PixelSpacing));
  const ipp = numbers(meta.get(CT.ImagePositionPatient));
  const iop = numbers(meta.get(CT.ImageOrientationPatient));
  const frames = Number(meta.get(CT.NumberOfFrames) ?? 1);
  return {
    sop: (meta.get(CT.SOPInstanceUID) ?? '').trim(),
    rows: Number(meta.get(CT.Rows) ?? 0),
    cols: Number(meta.get(CT.Columns) ?? 0),
    frames: Number.isFinite(frames) && frames > 0 ? frames : 1,
    iop: iop && iop.length === 6 ? iop : null,
    ipp: ipp && ipp.length === 3 ? ipp : null,
    // PixelSpacing = [entre linhas (y), entre colunas (x)]
    pixel:
      ps && ps.length === 2 && ps[0] > 0 && ps[1] > 0 ? [ps[1], ps[0]] : null,
    acquisition: (meta.get(CT.AcquisitionNumber) ?? '').trim(),
    temporal: (meta.get(CT.TemporalPositionIdentifier) ?? '').trim(),
  };
}

export interface Note {
  title: string;
  detail: string;
}

export const fmtMM = (v: number, digits = 2) =>
  v.toLocaleString('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });

/** Rótulo curto da série para mensagens (sem dados do paciente). */
export function seriesLabel(meta: Meta) {
  const number = (meta.get('0020|0011') ?? '').trim();
  const desc = (meta.get('0008|103e') ?? '').trim();
  return [number && `Série ${number}`, desc].filter(Boolean).join(' · ') || 'Série';
}

function stackKey(info: InstanceInfo) {
  const r = (v: number, d: number) => (Math.round(v * 10 ** d) / 10 ** d).toFixed(d);
  const iop = info.iop ? info.iop.map((v) => r(v, 3)).join(',') : 'sem-orientacao';
  const ps = info.pixel ? info.pixel.map((v) => r(v, 4)).join(',') : 'sem-pixel';
  return `${info.rows}x${info.cols}|${iop}|${ps}`;
}

function hasDuplicatePositions(infos: InstanceInfo[], normal: Vec3) {
  const t = infos.map((i) => dot(i.ipp!, normal)).sort((a, b) => a - b);
  for (let k = 1; k < t.length; k++)
    if (t[k] - t[k - 1] < SAME_POSITION_MM) return true;
  return false;
}

/**
 * Separa um grupo do VolView em pilhas que podem formar um volume cada.
 * Devolve listas de índices (relativos a `infos`), ordenadas ao longo da normal.
 */
export function splitStack(infos: InstanceInfo[]): {
  parts: number[][];
  notes: Note[];
} {
  const notes: Note[] = [];
  const all = infos.map((_, i) => i);
  if (infos.length <= 1) return { parts: [all], notes };

  // 1) cópias exatas (mesmo SOPInstanceUID)
  const seen = new Set<string>();
  const unique: number[] = [];
  all.forEach((i) => {
    const sop = infos[i].sop;
    if (sop && seen.has(sop)) return;
    if (sop) seen.add(sop);
    unique.push(i);
  });
  const copies = all.length - unique.length;
  if (copies)
    notes.push({
      title: 'Arquivos repetidos ignorados',
      detail: `${copies} arquivo(s) com o mesmo SOPInstanceUID de outro já carregado foram ignorados.`,
    });

  // 2) multi-frame: um volume por arquivo
  const multi = unique.filter((i) => infos[i].frames > 1);
  const single = unique.filter((i) => infos[i].frames <= 1);

  // 3) matriz, orientação e tamanho de pixel
  const groups = new Map<string, number[]>();
  single.forEach((i) => {
    const key = stackKey(infos[i]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(i);
  });
  if (groups.size > 1)
    notes.push({
      title: 'Série dividida em volumes',
      detail: `A série mistura ${groups.size} combinações de matriz, orientação ou tamanho de pixel; cada combinação virou um volume separado.`,
    });

  const parts: number[][] = [];
  groups.forEach((members) => {
    const basis = basisFromIOP(infos[members[0]].iop);
    const located = basis && members.every((i) => infos[i].ipp);
    if (!basis || !located) {
      parts.push(members);
      return;
    }
    const sortByT = (list: number[]) =>
      list
        .slice()
        .sort(
          (a, b) =>
            dot(infos[a].ipp!, basis.normal) - dot(infos[b].ipp!, basis.normal)
        );

    if (!hasDuplicatePositions(members.map((i) => infos[i]), basis.normal)) {
      parts.push(sortByT(members));
      return;
    }

    // 4) posições repetidas: tenta separar por aquisição e depois por fase
    const attempts: Array<[keyof InstanceInfo, string]> = [
      ['acquisition', 'número de aquisição'],
      ['temporal', 'posição temporal (fase)'],
    ];
    for (const [attr, label] of attempts) {
      const byAttr = new Map<string, number[]>();
      members.forEach((i) => {
        const k = String(infos[i][attr] ?? '');
        if (!byAttr.has(k)) byAttr.set(k, []);
        byAttr.get(k)!.push(i);
      });
      if (byAttr.size < 2) continue;
      const ok = [...byAttr.values()].every(
        (p) => !hasDuplicatePositions(p.map((i) => infos[i]), basis.normal)
      );
      if (!ok) continue;
      notes.push({
        title: 'Aquisições separadas',
        detail: `A série tinha cortes repetidos na mesma posição; foi separada por ${label} em ${byAttr.size} volumes, sem misturar aquisições.`,
      });
      [...byAttr.values()]
        .sort((a, b) => b.length - a.length)
        .forEach((p) => parts.push(sortByT(p)));
      return;
    }

    // 5) não resolvido: mantém o primeiro corte de cada posição
    const sorted = sortByT(members);
    const kept: number[] = [];
    let lastT = -Infinity;
    sorted.forEach((i) => {
      const t = dot(infos[i].ipp!, basis.normal);
      if (t - lastT >= SAME_POSITION_MM) {
        kept.push(i);
        lastT = t;
      }
    });
    notes.push({
      title: 'Cortes na mesma posição descartados',
      detail: `${sorted.length - kept.length} corte(s) repetiam a posição de outro corte sem aquisição ou fase que os distinguisse e foram descartados.`,
    });
    parts.push(kept);
  });

  multi.forEach((i) => parts.push([i]));
  parts.sort((a, b) => b.length - a.length);
  return { parts, notes };
}

/**
 * Refina o agrupamento feito pelo VolView (por série) usando os metadados de
 * cada instância. O maior grupo mantém o identificador original; os demais
 * recebem um sufixo. Instâncias sem metadados deixam o grupo intacto.
 */
export function refineVolumes<T>(
  volumes: Record<string, T[]>,
  metaOf: (item: T) => Meta | null | undefined,
  onNotes?: (volumeId: string, notes: Note[], label: string) => void
): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  Object.entries(volumes).forEach(([id, items]) => {
    const metas = items.map((it) => metaOf(it));
    if (items.length <= 1 || metas.some((m) => !m)) {
      out[id] = items;
      return;
    }
    const infos = metas.map((m) => instanceInfo(m!));
    const { parts, notes } = splitStack(infos);
    parts.forEach((part, n) => {
      out[n === 0 ? id : `${id}~${n + 1}`] = part.map((i) => items[i]);
    });
    if (notes.length && onNotes) onNotes(id, notes, seriesLabel(metas[0]!));
  });
  return out;
}

// ------------------------------------------------------------------ plano

export interface StackPlan {
  /** true quando a grade padrão do VolView (primeiro/último corte) não é exata */
  resample: boolean;
  rows: number;
  cols: number;
  /** número de cortes de origem */
  count: number;
  /** grade de saída */
  dims: Vec3;
  origin: Vec3;
  spacing: Vec3;
  /** colunas: eixo x (linha), eixo y (coluna), normal — convenção do vtk.js */
  direction: number[];
  /** rank[índiceDeOrigem] = posição na ordem ao longo da normal */
  rank: Int32Array;
  /** para cada fatia de saída: cortes vizinhos (posição ordenada) e peso de b */
  a: Int32Array;
  b: Int32Array;
  w: Float64Array;
  /** deslocamento (em pixels) da grade de saída para cada corte ordenado */
  du: Float64Array;
  dv: Float64Array;
  tiltDeg: number;
  gaps: Array<{ from: number; to: number; size: number }>;
  irregular: { min: number; max: number } | null;
  notes: Note[];
}

export interface PlanInput {
  /** posição (IPP) de cada corte, na ordem de origem (arquivos ou quadros) */
  positions: number[][];
  iop: number[];
  pixel: [number, number];
  rows: number;
  cols: number;
  /** força o caminho reamostrado (multi-frame: quadros podem estar fora de ordem) */
  force?: boolean;
}

export type PlanResult = { plan: StackPlan } | { error: string };

export function planStack(input: PlanInput): PlanResult {
  const { positions, iop, pixel, rows, cols } = input;
  const basis = basisFromIOP(iop);
  if (!basis) return { error: 'Orientação da imagem (IOP) ausente ou inválida.' };
  if (!positions.length || positions.some((p) => !p || p.length !== 3 || !p.every(Number.isFinite)))
    return { error: 'Posição de corte (IPP) ausente ou inválida.' };
  const [sx, sy] = pixel;
  const n = positions.length;
  const { row, col, normal } = basis;

  const order = positions
    .map((p, i) => ({ i, t: dot(p, normal) }))
    .sort((p, q) => p.t - q.t)
    .map((p) => p.i);
  const rank = new Int32Array(n);
  order.forEach((src, k) => {
    rank[src] = k;
  });
  const P = order.map((i) => positions[i]);
  const t = P.map((p) => dot(p, normal));
  for (let k = 1; k < n; k++)
    if (t[k] - t[k - 1] < SAME_POSITION_MM)
      return { error: 'Há quadros/cortes repetidos na mesma posição.' };
  const u = P.map((p) => dot(sub(p, P[0]), row));
  const v = P.map((p) => dot(sub(p, P[0]), col));

  const notes: Note[] = [];
  const span = t[n - 1] - t[0];
  const step = n > 1 ? span / (n - 1) : 1;
  const tolT = Math.max(0.05, 0.05 * step);
  const tolS = Math.max(0.05, 0.05 * Math.min(sx, sy));
  let devT = 0;
  let shift = 0;
  for (let k = 0; k < n; k++) {
    devT = Math.max(devT, Math.abs(t[k] - (t[0] + k * step)));
    shift = Math.max(shift, Math.hypot(u[k], v[k]));
  }
  const tilted = shift > tolS;
  const uneven = devT > tolT;
  const resample = n > 1 && (Boolean(input.force) || tilted || uneven);

  const deltas = t.slice(1).map((x, k) => x - t[k]);
  const sortedDeltas = deltas.slice().sort((a, b) => a - b);
  const median = n > 1 ? sortedDeltas[Math.floor((sortedDeltas.length - 1) / 2)] : 1;
  const gaps: StackPlan['gaps'] = [];
  deltas.forEach((d, k) => {
    if (d > 1.5 * median) gaps.push({ from: t[k], to: t[k + 1], size: d });
  });
  const regular = deltas.filter((d) => d <= 1.5 * median);
  let irregular: StackPlan['irregular'] = null;
  if (uneven && regular.length) {
    const mn = Math.min(...regular);
    const mx = Math.max(...regular);
    if (mx - mn > tolT) irregular = { min: mn, max: mx };
  }
  const tiltDeg =
    n > 1 ? (Math.atan2(Math.hypot(u[n - 1], v[n - 1]), span) * 180) / Math.PI : 0;

  // espaçamento de saída: o do exame quando uniforme; senão o menor intervalo regular
  let sz = step;
  if (uneven && n > 1) {
    sz = Math.max(regular.length ? Math.min(...regular) : median, 0.25 * median);
    if (span / sz + 1 > 4 * n + 16) sz = span / (4 * n);
  }
  const nz = n > 1 ? Math.floor(span / sz + 1e-6) + 1 : 1;

  // extensão no plano: união dos cortes (o tilt desloca cada corte)
  const U0 = Math.min(...u);
  const V0 = Math.min(...v);
  const nx = cols + Math.ceil((Math.max(...u) - U0) / sx - 1e-6);
  const ny = rows + Math.ceil((Math.max(...v) - V0) / sy - 1e-6);
  const origin: Vec3 = [0, 1, 2].map(
    (d) => P[0][d] + U0 * row[d] + V0 * col[d]
  ) as Vec3;
  const du = Float64Array.from(u, (x) => (U0 - x) / sx);
  const dv = Float64Array.from(v, (y) => (V0 - y) / sy);

  const a = new Int32Array(nz);
  const b = new Int32Array(nz);
  const w = new Float64Array(nz);
  let k = 0;
  for (let o = 0; o < nz; o++) {
    const to = t[0] + o * sz;
    while (k < n - 2 && t[k + 1] <= to + 1e-6) k++;
    if (n === 1) {
      a[o] = 0;
      b[o] = 0;
      w[o] = 0;
      continue;
    }
    let ka = k;
    if (t[ka + 1] <= to + 1e-6) ka += 1; // última posição
    const kb = Math.min(ka + 1, n - 1);
    let wb = kb === ka ? 0 : (to - t[ka]) / (t[kb] - t[ka]);
    if (wb < 1e-6) wb = 0;
    if (wb > 1 - 1e-6) {
      a[o] = kb;
      b[o] = kb;
      w[o] = 0;
      continue;
    }
    a[o] = ka;
    b[o] = wb === 0 ? ka : kb;
    w[o] = wb;
  }

  if (tilted)
    notes.push({
      title: `Gantry inclinado (${fmtMM(tiltDeg, 1)}°)`,
      detail:
        'Os cortes foram reamostrados para uma grade ortogonal alinhada ao plano de aquisição. Sem isso a anatomia ficaria cisalhada no MPR e no 3D.',
    });
  gaps.forEach((g) =>
    notes.push({
      title: `Lacuna de ${fmtMM(g.size)} mm entre cortes`,
      detail: `Entre as posições ${fmtMM(g.from)} e ${fmtMM(g.to)} mm (ao longo da normal) não há cortes. A região foi preenchida por interpolação e não contém dados reais.`,
    })
  );
  if (irregular)
    notes.push({
      title: 'Espaçamento entre cortes irregular',
      detail: `Intervalos de ${fmtMM(irregular.min)} a ${fmtMM(irregular.max)} mm. O volume foi reamostrado para espaçamento regular de ${fmtMM(sz, 3)} mm.`,
    });

  return {
    plan: {
      resample,
      rows,
      cols,
      count: n,
      dims: [nx, ny, nz],
      origin,
      spacing: [sx, sy, sz],
      direction: [...row, ...col, ...normal],
      rank,
      a,
      b,
      w,
      du,
      dv,
      tiltDeg,
      gaps,
      irregular,
      notes,
    },
  };
}

/** Plano para um grupo de instâncias já ordenado pelo VolView/CatStudio. */
export function planForMetas(metas: Meta[]): PlanResult | null {
  if (!metas.length) return null;
  const first = instanceInfo(metas[0]);
  if (!first.iop || !first.pixel) return null;
  if (metas.length === 1) {
    if (first.frames <= 1) return null;
    const raw = metas[0].get(CT.FramePositions);
    if (!raw) return null;
    let positions: number[][];
    try {
      positions = JSON.parse(raw);
    } catch {
      return null;
    }
    if (!Array.isArray(positions) || positions.length !== first.frames) return null;
    return planStack({
      positions,
      iop: first.iop,
      pixel: first.pixel,
      rows: first.rows,
      cols: first.cols,
      force: true,
    });
  }
  const infos = metas.map(instanceInfo);
  if (infos.some((i) => !i.ipp || i.frames > 1)) return null;
  const key = stackKey(first);
  if (infos.some((i) => stackKey(i) !== key)) return null;
  return planStack({
    positions: infos.map((i) => i.ipp!),
    iop: first.iop,
    pixel: first.pixel,
    rows: first.rows,
    cols: first.cols,
  });
}
