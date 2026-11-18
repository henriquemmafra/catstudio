import { MESA_WHITE, type MesaRow, type MesaTable } from '../data/mesa-white';
import type { Sex } from '../schema';

export const MESA_MIN_AGE = 45;
export const MESA_MAX_AGE = 84;

export interface MesaResult {
  /** Percentil inteiro (1–99) ou null quando não se aplica. */
  percentile: number | null;
  /** Motivo de não calcular, ou ressalva do cálculo. */
  note?: string;
  /**
   * true quando o valor é estimado fora das âncoras (acima do P90 ou abaixo da primeira âncora
   * positiva) ou vem de tabela provisória. Exibir na UI; NÃO vai para o texto do laudo.
   */
  approximate: boolean;
}

/**
 * Percentil MESA de um escore observado, coorte branca (padrão do serviço).
 *
 * Método (aproximação da calculadora oficial, que é não paramétrica):
 *  - Para a idade/sexo, temos: fração com CAC = 0 (p0) e os escores nos percentis 25/50/75/90.
 *  - Escores > 0 estão acima de todos os zeros, logo percentil ≥ 100·p0.
 *  - Entre âncoras: interpolação linear do percentil em função de ln(escore).
 *  - Acima do P90: extrapolação em escala probit com a inclinação das duas últimas âncoras.
 *  - Sem âncoras positivas na idade (ex.: mulher de 45 anos): usa o FORMATO da distribuição dos
 *    escores positivos da idade vizinha mais próxima que tenha âncoras, reescalado para o p0 local.
 *
 * Validar contra a calculadora oficial antes de uso clínico (ver data/mesa-white.ts).
 */
export function mesaPercentile(
  score: number,
  ageYears: number | undefined,
  sex: Sex | undefined,
  table: Record<'M' | 'F', MesaTable> = MESA_WHITE
): MesaResult {
  if (sex !== 'M' && sex !== 'F')
    return {
      percentile: null,
      note: 'Sexo não informado nas tags DICOM.',
      approximate: false,
    };
  if (ageYears === undefined || !Number.isFinite(ageYears))
    return {
      percentile: null,
      note: 'Idade não informada nas tags DICOM.',
      approximate: false,
    };
  const age = Math.floor(ageYears);
  if (age < MESA_MIN_AGE || age > MESA_MAX_AGE)
    return {
      percentile: null,
      note: `Idade ${age} anos fora da faixa do MESA (${MESA_MIN_AGE}–${MESA_MAX_AGE}).`,
      approximate: false,
    };
  if (!(score > 0))
    return {
      percentile: null,
      note: 'Escore zero: percentil não se aplica.',
      approximate: false,
    };

  const t = table[sex];
  const row = rowForAge(t, age);
  const res = percentileFromRow(score, row, t, age);
  return { ...res, approximate: res.approximate || t.provisional };
}

// ---------------------------------------------------------------------------

/** Linha para a idade exata, interpolando entre idades tabeladas quando preciso. */
export function rowForAge(t: MesaTable, age: number): MesaRow {
  const rows = t.rows;
  const exact = rows.find((r) => r.age === age);
  if (exact) return exact;
  let lo = rows[0]!;
  let hi = rows[rows.length - 1]!;
  for (const r of rows) {
    if (r.age < age && r.age > lo.age) lo = r;
    if (r.age > age && r.age < hi.age) hi = r;
  }
  if (age <= lo.age) return lo;
  if (age >= hi.age) return hi;
  const f = (age - lo.age) / (hi.age - lo.age);
  const lin = (a: number, b: number) => a + (b - a) * f;
  // Escores interpolados em escala log(1+x): crescem ~exponencialmente com a idade.
  const logi = (a: number, b: number) =>
    Math.round(Math.expm1(lin(Math.log1p(a), Math.log1p(b))));
  return {
    age,
    pPos: lin(lo.pPos, hi.pPos),
    p25: lo.p25 === null || hi.p25 === null ? null : logi(lo.p25, hi.p25),
    p50: logi(lo.p50, hi.p50),
    p75: logi(lo.p75, hi.p75),
    p90: logi(lo.p90, hi.p90),
  };
}

interface Pt {
  x: number;
  y: number;
} // x = ln(escore), y = percentil (0–100)

function positiveAnchors(row: MesaRow): Pt[] {
  const a: Pt[] = [];
  const add = (y: number, v: number | null) => {
    if (v !== null && v > 0) a.push({ x: Math.log(v), y });
  };
  add(25, row.p25);
  add(50, row.p50);
  add(75, row.p75);
  add(90, row.p90);
  return a;
}

function percentileFromRow(
  score: number,
  row: MesaRow,
  t: MesaTable,
  age: number
): MesaResult {
  const base = 100 * (1 - row.pPos); // todos os zeros ficam abaixo de qualquer escore > 0
  let anchors = positiveAnchors(row);
  let approximate = false;

  if (anchors.length === 0) {
    // Empresta o formato da distribuição positiva da idade vizinha com âncoras.
    const donor = nearestRowWithAnchors(t, age);
    if (!donor)
      return {
        percentile: null,
        note: 'Sem dados de referência para esta idade.',
        approximate: true,
      };
    const dBase = 100 * (1 - donor.pPos);
    anchors = positiveAnchors(donor).map((p) => {
      const cond = (p.y - dBase) / (100 - dBase); // percentil condicional entre os positivos
      return { x: p.x, y: base + cond * (100 - base) };
    });
    approximate = true;
  }

  // Ponto de partida: escore 1 (ln 1 = 0) logo acima de todos os zeros.
  const pts = dedupeMonotone([{ x: 0, y: base }, ...anchors]);
  const x = Math.log(Math.max(score, 1));

  let y: number;
  const last = pts[pts.length - 1]!;
  if (x <= pts[0]!.x) {
    y = pts[0]!.y;
  } else if (x <= last.x) {
    let i = 1;
    while (pts[i]!.x < x) i++;
    const a = pts[i - 1]!,
      b = pts[i]!;
    y = a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
    if (anchors.length && x < anchors[0]!.x) approximate = true; // entre escore 1 e a 1ª âncora
  } else {
    // Extrapolação probit acima da última âncora.
    const prev = pts.length >= 2 ? pts[pts.length - 2]! : { x: 0, y: base };
    const z1 = probit(clampP(prev.y / 100)),
      z2 = probit(clampP(last.y / 100));
    const slope = last.x > prev.x ? (z2 - z1) / (last.x - prev.x) : 0;
    y = 100 * phi(z2 + Math.max(slope, 0) * (x - last.x));
    approximate = true;
  }

  const lower = Math.ceil(base) > 99 ? 99 : Math.max(1, Math.ceil(base));
  const pct = Math.min(99, Math.max(lower, Math.round(y)));
  return { percentile: pct, approximate };
}

function nearestRowWithAnchors(t: MesaTable, age: number): MesaRow | undefined {
  return [...t.rows]
    .filter((r) => positiveAnchors(r).length >= 2)
    .sort((a, b) => Math.abs(a.age - age) - Math.abs(b.age - age))[0];
}

function dedupeMonotone(pts: Pt[]): Pt[] {
  const s = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  const out: Pt[] = [];
  for (const p of s) {
    const prev = out[out.length - 1];
    if (prev && Math.abs(prev.x - p.x) < 1e-12) {
      prev.y = Math.max(prev.y, p.y);
      continue;
    }
    out.push({ x: p.x, y: prev ? Math.max(prev.y, p.y) : p.y });
  }
  return out;
}

const clampP = (p: number) => Math.min(0.9999, Math.max(0.0001, p));

/** CDF normal padrão. */
export function phi(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}
function erf(x: number): number {
  // Abramowitz-Stegun 7.1.26 (erro < 1,5e-7)
  const s = Math.sign(x);
  x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) *
      t +
      0.254829592) *
      t *
      Math.exp(-x * x);
  return s * y;
}
/** Inversa da normal (Acklam). */
export function probit(p: number): number {
  const a = [
    -39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269,
    -30.66479806614716, 2.506628277459239,
  ];
  const b = [
    -54.47609879822406, 161.5858368580409, -155.6989798598866,
    66.80131188771972, -13.28068155288572,
  ];
  const c = [
    -0.007784894002430293, -0.3223964580411365, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783,
  ];
  const d = [
    0.007784695709041462, 0.3224671290700398, 2.445134137142996,
    3.754408661907416,
  ];
  const pl = 0.02425;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q +
        c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1)
    );
  }
  if (p > 1 - pl) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return (
      -(
        ((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q +
        c[5]!
      ) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1)
    );
  }
  const q = p - 0.5,
    r = q * q;
  return (
    ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r +
      a[5]!) *
      q) /
    (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1)
  );
}
