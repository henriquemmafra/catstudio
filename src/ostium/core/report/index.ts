/**
 * Motor de laudo construtivo: Exam (JSON) → texto puro.
 *
 * Regras de ouro:
 *  - Só escreve o que está no JSON. Vaso ausente = linha omitida. Achado adicional não marcado = omitido.
 *  - Cada linha carrega `sources` (ids dos achados que a geraram) para destacar na UI e para o
 *    verificador do polimento por IA conferir que nada foi inventado ou perdido.
 *  - Função pura e instantânea: pode rodar a cada clique.
 */
import {
  GRADE_ORDER,
  SEGMENTS,
  type Branch,
  type BranchKind,
  type Exam,
  type LimitationReason,
  type MainVessel,
  type MainVesselId,
  type Plaque,
  type Segment,
  type StenosisGrade,
} from '../schema';
import {
  BRANCH_NAME,
  COUNT_M,
  GRADE_EFFECT,
  IMPORTANCE,
  ORDINAL_M,
  P,
  PLAQUE_TYPE,
  SEGMENT_NAME,
  VESSEL_NAME,
  cap,
  contract,
  formatCm,
  formatInt,
  joinPt,
  segmentsLoc,
  type Noun,
} from './phrases';

export interface ReportLine {
  text: string;
  sources: string[];
}
export interface ReportSection {
  id: 'calcio' | 'angio' | 'adicionais' | 'conclusao';
  title?: string;
  lines: ReportLine[];
}
export interface Report {
  sections: ReportSection[];
  warnings: string[];
}

export interface ReportOptions {
  /** Mostrar "A2/N2" no texto do escore (padrão: não). */
  showCacDrsN?: boolean;
}

export function generateReport(exam: Exam, opts: ReportOptions = {}): Report {
  const sections: ReportSection[] = [];
  const warnings: string[] = [];
  const hasCalcium = exam.kind !== 'angio' && !!exam.calcium;
  const hasAngio = exam.kind !== 'escore' && !!exam.angio;

  if (hasCalcium) {
    sections.push(calciumSection(exam, opts));
    const c = exam.calcium!;
    warnings.push(...c.warnings);
    if (c.total > 0 && c.mesaPercentile === null && c.mesaNote)
      warnings.push(`Percentil MESA omitido: ${c.mesaNote}`);
  }
  if (hasAngio) {
    sections.push(angioSection(exam));
    const pending = allPlaques(exam).filter(
      (p) => p.plaque.status === 'sugerido'
    ).length;
    if (pending)
      warnings.push(
        `${pending} lesão(ões) sugerida(s) pelo sistema ainda não revisada(s).`
      );
  }
  const add = additionalSection(exam);
  if (add.lines.length) sections.push(add);
  const concl = impressionSection(exam, hasCalcium, hasAngio);
  if (concl.lines.length) sections.push(concl);

  return { sections, warnings };
}

export function toPlainText(r: Report): string {
  return r.sections
    .map((s) =>
      [...(s.title ? [s.title] : []), ...s.lines.map((l) => l.text)].join('\n')
    )
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ---------------------------------------------------------------------------
// Escore de cálcio
// ---------------------------------------------------------------------------

function calciumSection(exam: Exam, opts: ReportOptions): ReportSection {
  const c = exam.calcium!;
  const lines: ReportLine[] = [];
  const src = ['calcio'];
  if (c.cacDrs === 'A0') {
    lines.push({ text: P.calcium.zero, sources: src });
    return { id: 'calcio', lines };
  }
  const cls = opts.showCacDrsN ? `${c.cacDrs}/N${c.vesselCount}` : c.cacDrs;
  let text = P.calcium.main(formatInt(c.total), cls, P.calcium.level[c.cacDrs]);
  text +=
    c.mesaPercentile !== null ? P.calcium.percentile(c.mesaPercentile) : '.';
  lines.push({ text, sources: src });
  lines.push({ text: '', sources: [] });
  for (const v of ['TCE', 'DA', 'CX', 'CD'] as const)
    lines.push({
      text: P.calcium.tableRow(v, formatInt(c.perVessel[v])),
      sources: [`calcio.${v}`],
    });
  lines.push({
    text: P.calcium.tableRow('Total', formatInt(c.total)),
    sources: src,
  });
  lines.push({ text: '', sources: [] });
  lines.push({ text: P.calcium.referencesTitle, sources: [] });
  const refs =
    c.mesaPercentile !== null
      ? P.calcium.references
      : P.calcium.references.slice(1);
  for (const r of refs) lines.push({ text: r, sources: [] });
  return { id: 'calcio', lines };
}

// ---------------------------------------------------------------------------
// Angio-TC
// ---------------------------------------------------------------------------

function angioSection(exam: Exam): ReportSection {
  const a = exam.angio!;
  const lines: ReportLine[] = [];
  const technique =
    exam.kind === 'escore_angio'
      ? P.techniqueAfterCalcium(exam.detectorRows)
      : P.techniqueAngioOnly(exam.detectorRows);
  lines.push({ text: technique, sources: ['tecnica'] });

  const lim = limitationLine(a.vessels, a.branches);
  if (lim) lines.push(lim);

  lines.push({ text: P.dominance[a.dominance], sources: ['dominancia'] });

  const vessel = (id: MainVesselId) =>
    a.vessels.find((v) => v.id === id && v.present);
  const branches = (parent: MainVesselId, kinds: BranchKind[]) =>
    a.branches
      .filter((b) => b.parent === parent && kinds.includes(b.kind))
      .sort(
        (x, y) =>
          kinds.indexOf(x.kind) - kinds.indexOf(y.kind) ||
          (x.order ?? 0) - (y.order ?? 0)
      );

  const tce = vessel('TCE');
  if (tce) lines.push(mainVesselLine(tce));
  const da = vessel('DA');
  if (da) lines.push(mainVesselLine(da));
  lines.push(...branchLines(branches('DA', ['diagonal'])));
  lines.push(...branchLines(a.branches.filter((b) => b.kind === 'diagonalis')));
  const cx = vessel('CX');
  if (cx) lines.push(mainVesselLine(cx));
  lines.push(...branchLines(branches('CX', ['marginal'])));
  lines.push(...branchLines(branches('CX', ['dp', 'vp'])));
  const cd = vessel('CD');
  if (cd) lines.push(mainVesselLine(cd));
  lines.push(...branchLines(branches('CD', ['dp', 'vp'])));

  return { id: 'angio', lines };
}

function limitationLine(
  vessels: MainVessel[],
  branches: Branch[]
): ReportLine | null {
  const reasons: LimitationReason[] = [];
  const sources: string[] = [];
  let count = 0;
  for (const v of vessels) {
    if (!v.present) continue;
    if (v.limitedWhole) {
      reasons.push(v.limitedWhole);
      sources.push(`${v.id}.limitado`);
      count++;
    }
    for (const s of SEGMENTS) {
      const r = v.limited[s];
      if (r && !v.limitedWhole) {
        reasons.push(r);
        sources.push(`${v.id}.${s}.limitado`);
        count++;
      }
    }
  }
  for (const b of branches)
    if (b.limited) {
      reasons.push(b.limited.reason);
      sources.push(`${b.id}.limitado`);
      count++;
    }
  if (!count) return null;
  const order: LimitationReason[] = [
    'movimento',
    'calcificacao',
    'ruido',
    'outro',
  ];
  const uniq = order.filter((r) => reasons.includes(r));
  const text =
    uniq.length === 1
      ? `${P.limitation.single[uniq[0]!]} ${P.limitation.object(count)}`
      : `${cap(joinPt(uniq.map((r) => P.limitation.noun[r])))} ${P.limitation.multiVerb} ${P.limitation.object(count)}`;
  return { text, sources };
}

function sortSegs(segs: Iterable<Segment>): Segment[] {
  const set = new Set(segs);
  return SEGMENTS.filter((s) => set.has(s));
}

/** Agrupa placas de mesmo tipo e grau: "placas calcificadas nos segmentos proximal e distal determinando ...". */
export function plaquesText(plaques: Plaque[]): string {
  const groups = new Map<string, { plaques: Plaque[]; segs: Set<Segment> }>();
  for (const p of plaques) {
    const k = `${p.type}|${p.grade}`;
    const g = groups.get(k) ?? { plaques: [], segs: new Set<Segment>() };
    g.plaques.push(p);
    p.segments.forEach((s) => g.segs.add(s));
    groups.set(k, g);
  }
  const ordered = [...groups.values()].sort(
    (a, b) => firstSegIdx(a.segs) - firstSegIdx(b.segs)
  );
  return joinPt(
    ordered.map((g) => {
      const p0 = g.plaques[0]!;
      const noun =
        g.plaques.length > 1
          ? PLAQUE_TYPE[p0.type].plur
          : PLAQUE_TYPE[p0.type].sing;
      const segs = sortSegs(g.segs);
      const loc = segs.length ? ` ${segmentsLoc(segs)}` : '';
      return `${noun}${loc} determinando ${GRADE_EFFECT[p0.grade]}`;
    })
  );
}
const firstSegIdx = (s: Set<Segment>) =>
  Math.min(...[...s].map((x) => SEGMENTS.indexOf(x)), 99);

interface SentenceInput {
  subject: string;
  apex?: string;
  plaques: Plaque[];
  limitedSegs: Segment[];
  limitedWhole: boolean;
  hasSegments: boolean;
}

export function vesselSentence(i: SentenceInput): string {
  const head = i.apex ? `${i.subject} ${i.apex},` : i.subject;
  const has = i.plaques.length > 0;
  const allLimited =
    i.limitedWhole ||
    (i.hasSegments && i.limitedSegs.length === SEGMENTS.length);
  const pText = has ? plaquesText(i.plaques) : '';
  const limPhrase = (segs: Segment[]) =>
    `${segs.length === 1 ? 'segmento' : 'segmentos'} ${joinPt(segs.map((s) => SEGMENT_NAME[s]))} ${P.limitedOne}`;

  if (allLimited)
    return has
      ? `${head} com ${pText}; demais segmentos ${P.limitedOne}.`
      : `${head} ${P.limitedOne}.`;
  if (!has && !i.limitedSegs.length) return `${head} ${P.normal}.`;
  if (!has) {
    const clean = SEGMENTS.filter((s) => !i.limitedSegs.includes(s));
    return `${head} ${P.normal} ${segmentsLoc(clean)}; ${limPhrase(i.limitedSegs)}.`;
  }
  if (!i.limitedSegs.length) return `${head} com ${pText}.`;
  return `${head} com ${pText}; ${limPhrase(i.limitedSegs)}.`;
}

function mainVesselLine(v: MainVessel): ReportLine {
  const limitedSegs =
    v.id === 'TCE' ? [] : sortSegs(SEGMENTS.filter((s) => v.limited[s]));
  let text = vesselSentence({
    subject: VESSEL_NAME[v.id].text,
    apex: v.id === 'DA' && v.apex ? P.apex[v.apex] : undefined,
    plaques: v.plaques,
    limitedSegs,
    limitedWhole: !!v.limitedWhole,
    hasSegments: v.id !== 'TCE',
  });
  const sources = [v.id, ...v.plaques.map((p) => p.id)];
  if (v.intramyocardial) {
    text += ` ${P.intramyocardial(SEGMENT_NAME[v.intramyocardial.segment])}`;
    sources.push(`${v.id}.intramiocardico`);
  }
  return { text, sources };
}

/** Nome do ramo no início de frase (sem importância). */
function branchBaseName(b: Branch, siblings: number): string {
  const n = BRANCH_NAME[b.kind];
  if (b.kind === 'diagonal' || b.kind === 'marginal') {
    return siblings > 1 && b.order
      ? `${ORDINAL_M[b.order - 1] ?? `${b.order}º`} ${n.sing}`
      : n.sing;
  }
  if (b.kind === 'dp') {
    const mods = [
      b.dpVariant?.dupla ? P.dpDupla : '',
      b.dpVariant?.precoce ? P.dpPrecoce : '',
    ].filter(Boolean);
    return [n.sing, ...mods].join(' ');
  }
  return n.sing;
}

function branchSubject(b: Branch, siblings: number): string {
  const imp = b.importance ? ` ${IMPORTANCE[b.importance]}` : '';
  return `${branchBaseName(b, siblings)}${imp}`;
}

const isClean = (b: Branch) => !b.plaques.length && !b.limited;

function branchLines(list: Branch[]): ReportLine[] {
  const out: ReportLine[] = [];
  const byKind = new Map<BranchKind, Branch[]>();
  for (const b of list) byKind.set(b.kind, [...(byKind.get(b.kind) ?? []), b]);

  for (const [kind, bs] of byKind) {
    const siblings = bs.length;
    const clean = bs.filter(isClean);
    const dirty = bs.filter((b) => !isClean(b));
    const groupable =
      (kind === 'diagonal' || kind === 'marginal') && clean.length >= 2;

    const emitClean = () => {
      if (!clean.length) return;
      if (groupable) {
        const sameImp = clean.every(
          (b) => b.importance === clean[0]!.importance
        );
        let subject: string;
        if (sameImp && clean.length === siblings) {
          const imp = clean[0]!.importance
            ? ` ${IMPORTANCE[clean[0]!.importance]}`
            : '';
          subject = `${cap(COUNT_M[clean.length] ?? String(clean.length))} ${BRANCH_NAME[kind].plur}${imp}`;
        } else {
          subject = cap(joinPt(clean.map((b) => branchSubject(b, siblings))));
        }
        out.push({
          text: `${subject}, ${P.normal}.`,
          sources: clean.map((b) => b.id),
        });
      } else {
        for (const b of clean) out.push(branchLine(b, siblings));
      }
    };

    // Mantém a ordem anatômica: limpos agrupados na posição do primeiro limpo.
    const firstCleanOrder = clean[0]?.order ?? Infinity;
    for (const b of dirty.filter((d) => (d.order ?? 0) < firstCleanOrder))
      out.push(branchLine(b, siblings));
    emitClean();
    for (const b of dirty.filter((d) => (d.order ?? 0) >= firstCleanOrder))
      out.push(branchLine(b, siblings));
  }
  return out;
}

function branchLine(b: Branch, siblings: number): ReportLine {
  const subject = cap(branchSubject(b, siblings));
  const segs = new Set(b.plaques.flatMap((p) => p.segments));
  const text = vesselSentence({
    subject:
      b.importance && b.plaques.length === 0 && !b.limited
        ? `${subject},`
        : subject,
    plaques: b.plaques,
    limitedSegs: [],
    limitedWhole: !!b.limited,
    hasSegments: segs.size > 0,
  });
  return { text, sources: [b.id, ...b.plaques.map((p) => p.id)] };
}

// ---------------------------------------------------------------------------
// Achados adicionais
// ---------------------------------------------------------------------------

function additionalSection(exam: Exam): ReportSection {
  const a = exam.additional ?? {};
  const L: ReportLine[] = [];
  const push = (text: string, id: string) =>
    L.push({ text, sources: [`adicional.${id}`] });
  if (a.ateromatoseAortica)
    push(P.additional.ateromatoseAortica, 'ateromatoseAortica');
  if (a.atrios) push(P.additional[a.atrios], 'atrios');
  if (a.hipertrofiaVentricularEsquerda)
    push(P.additional.hipertrofiaVentricularEsquerda, 'hve');
  if (a.septoSigmoide) push(P.additional.septoSigmoide, 'septoSigmoide');
  if (a.ectasiaRaizAortica)
    push(
      P.additional.ectasia('da raiz aórtica', formatCm(a.ectasiaRaizAortica)),
      'ectasiaRaiz'
    );
  if (a.ectasiaAortaAscendente)
    push(
      P.additional.ectasia(
        'da aorta ascendente',
        formatCm(a.ectasiaAortaAscendente)
      ),
      'ectasiaAscendente'
    );
  if (a.ectasiaTroncoPulmonar)
    push(
      P.additional.ectasia(
        'do tronco da artéria pulmonar',
        formatCm(a.ectasiaTroncoPulmonar)
      ),
      'ectasiaTP'
    );
  if (a.esternorrafia) push(P.additional.esternorrafia, 'esternorrafia');
  if (a.achadosToracicosEstudoDirigido)
    push(P.additional.achadosToracicos, 'toracicos');
  return { id: 'adicionais', lines: L };
}

// ---------------------------------------------------------------------------
// Conclusão
// ---------------------------------------------------------------------------

interface LocatedPlaque {
  plaque: Plaque;
  noun: Noun;
  key: string;
}

function allPlaques(exam: Exam): LocatedPlaque[] {
  const a = exam.angio;
  if (!a) return [];
  const out: LocatedPlaque[] = [];
  for (const v of a.vessels)
    if (v.present)
      for (const p of v.plaques)
        out.push({ plaque: p, noun: VESSEL_NAME[v.id], key: v.id });
  const siblingsOf = (b: Branch) =>
    a.branches.filter((x) => x.kind === b.kind && x.parent === b.parent).length;
  for (const b of a.branches) {
    const base = branchBaseName(b, siblingsOf(b));
    for (const p of b.plaques)
      out.push({
        plaque: p,
        noun: { text: base, gender: BRANCH_NAME[b.kind].gender },
        key: b.id,
      });
  }
  return out;
}

function locationText(prep: 'em' | 'de', noun: Noun, segs: Segment[]): string {
  if (segs.length)
    return `${segmentsLoc(segs, prep)} ${contract('de', noun.gender)} ${noun.text}`;
  return `${contract(prep, noun.gender)} ${noun.text}`;
}

function impressionSection(
  exam: Exam,
  hasCalcium: boolean,
  hasAngio: boolean
): ReportSection {
  const lines: ReportLine[] = [];
  if (hasCalcium)
    lines.push({
      text: P.impression.calcium[exam.calcium!.cacDrs],
      sources: ['calcio'],
    });

  if (hasAngio) {
    const located = allPlaques(exam);
    const significantFrom = GRADE_ORDER.indexOf('discreta');
    const relevant = located.filter(
      (l) => GRADE_ORDER.indexOf(l.plaque.grade) >= significantFrom
    );
    if (!relevant.length) {
      lines.push({
        text: P.impression.noSignificant,
        sources: located.map((l) => l.plaque.id),
      });
    } else {
      const grades = [...GRADE_ORDER]
        .reverse()
        .filter(
          (g) => GRADE_ORDER.indexOf(g) >= significantFrom
        ) as StenosisGrade[];
      for (const g of grades) {
        const ofGrade = relevant.filter((l) => l.plaque.grade === g);
        if (!ofGrade.length) continue;
        // agrupa por vaso/ramo
        const byVessel = new Map<
          string,
          { noun: Noun; segs: Set<Segment>; ids: string[] }
        >();
        for (const l of ofGrade) {
          const e = byVessel.get(l.key) ?? {
            noun: l.noun,
            segs: new Set<Segment>(),
            ids: [],
          };
          l.plaque.segments.forEach((s) => e.segs.add(s));
          e.ids.push(l.plaque.id);
          byVessel.set(l.key, e);
        }
        const prep = g === 'oclusao' || g === 'suboclusao' ? 'de' : 'em';
        const where = joinPt(
          [...byVessel.values()].map((e) =>
            locationText(prep, lowerBranch(e.noun), sortSegs(e.segs))
          )
        );
        const ids = [...byVessel.values()].flatMap((e) => e.ids);
        const text =
          g === 'oclusao'
            ? P.impression.occlusion(where)
            : g === 'suboclusao'
              ? P.impression.subocclusion(where)
              : P.impression.reduction(
                  g === 'discreta'
                    ? 'discreta'
                    : g === 'moderada'
                      ? 'moderada'
                      : 'importante',
                  where
                );
        lines.push({ text, sources: ids });
      }
    }
  }
  return {
    id: 'conclusao',
    title: lines.length ? P.impression.title : undefined,
    lines,
  };
}

/** "Primeiro ramo diagonal" → "primeiro ramo diagonal" no meio da frase; nomes de artéria ficam. */
function lowerBranch(n: Noun): Noun {
  return /^(Primeiro|Segundo|Terceiro|Quarto|Quinto|Sexto|Ramo)\b/.test(n.text)
    ? { ...n, text: n.text[0]!.toLowerCase() + n.text.slice(1) }
    : n;
}
