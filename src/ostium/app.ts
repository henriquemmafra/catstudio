/**
 * Ostium — área de trabalho de pré-laudo de angio-TC de coronárias dentro do CatStudio.
 * Mapa coronário (3D e planificado) com placa marcada no ponto exato, escore de cálcio medido na
 * série aberta no CatStudio (clique e laço) e laudo construído ao vivo a partir dos achados.
 * A interface é DOM puro, montada dentro de OstiumWorkspace.vue; o estado é um só por aba.
 */
import {
  buildCalciumResult,
  generateReport,
  toPlainText,
  MESA_WHITE,
  SEGMENTS,
  type AdditionalFindings,
  type Branch,
  type BranchKind,
  type Dominance,
  type Exam,
  type Importance,
  type LimitationReason,
  type MainVessel,
  type MainVesselId,
  type Plaque,
  type PlaqueType,
  type Segment,
  type Sex,
  type StenosisGrade,
} from './core';
import type { CalciumVolume } from './core';
import {
  SEG_RANGE,
  isSegmented,
  segmentAt,
  segmentsOfSpan,
  span,
  clamp01,
} from './anatomy';
import {
  createScene,
  type CoronaryScene,
  type Pick,
  type SceneModel,
} from './scene';
import { TEMPLATE } from './template';
import {
  createCalciumView,
  TOOL_COLOR,
  type CalciumView,
  type Tool,
} from './calcium-view';

// ------------------------------------------------------------------ estado
type Mode = 'lento' | 'medio' | 'nave';
interface PlaqueState {
  id: string;
  vessel: string;
  t: number;
  len: number;
  type: PlaqueType;
  grade: StenosisGrade;
}
interface BranchState {
  id: string;
  kind: BranchKind;
  order: number;
  importance?: Importance;
  dupla?: boolean;
  precoce?: boolean;
}
interface State {
  age: number;
  sex: Sex;
  kind: Exam['kind'];
  showN: boolean;
  cac: Record<MainVesselId, number>;
  dominance: Dominance;
  plaques: PlaqueState[];
  limited: Record<string, LimitationReason>;
  apex: 'atinge' | 'contorna' | '';
  bridge: Segment | '';
  branches: BranchState[];
  additional: AdditionalFindings;
}
type Selection =
  | { kind: 'point'; vessel: string; t: number }
  | { kind: 'plaque'; id: string }
  | null;
let uid = 0;
const newId = (p = 'b') => `${p}${++uid}`;
const fresh = (): State => ({
  age: 58,
  sex: 'M',
  kind: 'escore_angio',
  showN: false,
  cac: { TCE: 0, DA: 0, CX: 0, CD: 0 },
  dominance: 'direita',
  plaques: [],
  limited: {},
  apex: 'atinge',
  bridge: '',
  branches: [
    { id: newId(), kind: 'diagonal', order: 1, importance: 'moderada' },
    { id: newId(), kind: 'marginal', order: 1, importance: 'moderada' },
    { id: newId(), kind: 'dp', order: 1 },
    { id: newId(), kind: 'vp', order: 1 },
  ],
  additional: {},
});
let S: State = fresh();
let sel: Selection = null;
let mode: Mode = 'lento';
let detected: Mode = 'lento';
let mapView: '3d' | 'plano' | 'calcio' = '3d';
let loadedKey: string | null = null;
let HOST: OstiumHost;
let ROOT: HTMLElement;

export interface OpenSeries {
  key: string;
  description: string;
  vol: CalciumVolume;
  thicknessKnown: boolean;
  contrast?: boolean;
  ageYears?: number;
  sex?: Sex;
}
export interface OstiumHost {
  /** Série exibida no CatStudio, já em UH; `error` explica por que não serve; null = nenhum exame aberto. */
  currentSeries(): OpenSeries | { error: string } | null;
  close(): void;
  visible(): boolean;
}
let calcView: CalciumView | null = null;
let cacFromImage = false;
let cacWarnings: string[] = [];
let tool: Tool = 'DA';
let spread = 0;
let scene3: CoronaryScene | null = null;
let lastLines: string[] = [];

const STORE = 'ostium.v03';
function save() {
  try {
    localStorage.setItem(STORE, JSON.stringify({ S, uid }));
  } catch {
    /* segue em memória */
  }
}
function load() {
  try {
    const o = JSON.parse(localStorage.getItem(STORE) ?? 'null');
    if (o?.S && Array.isArray(o.S.plaques) && Array.isArray(o.S.branches)) {
      S = { ...fresh(), ...o.S };
      for (const v of ['TCE', 'DA', 'CX', 'CD'] as const)
        S.cac[v] = Math.round(S.cac[v] ?? 0);
      uid = Math.max(uid, o.uid ?? 0);
      return true;
    }
  } catch {
    /* ignora */
  }
  return false;
}

// ------------------------------------------------------------------ utilidades DOM
const $ = <T extends Element = HTMLElement>(q: string) =>
  ROOT.querySelector(q) as T;
type Kid = Node | string | null | undefined | false;
function h(
  tag: string,
  attrs: Record<string, any> = {},
  ...kids: Kid[]
): HTMLElement {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'class') e.className = v;
    else if (v !== false && v != null)
      e.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of kids) if (c) e.append(c);
  return e;
}
const NS = 'http://www.w3.org/2000/svg';
function sv(
  tag: string,
  attrs: Record<string, any> = {},
  ...kids: Kid[]
): SVGElement {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, String(v));
  }
  for (const c of kids) if (c) e.append(c);
  return e;
}
function chips<T extends string>(
  value: T | '',
  options: { v: T | ''; label: string; note?: string; color?: string }[],
  onPick: (v: T | '') => void
) {
  return h(
    'div',
    { class: 'chips' },
    ...options.map((o) =>
      h(
        'button',
        {
          class: 'chip',
          type: 'button',
          'aria-pressed': String(o.v === value),
          onclick: () => {
            onPick(o.v);
            changed();
          },
        },
        o.color ? h('i', { style: `background:${o.color}` }) : null,
        o.label,
        o.note ? h('small', {}, o.note) : null
      )
    )
  );
}
function segctl<T extends string>(
  root: HTMLElement,
  value: T | null,
  options: [T, string][],
  onPick: (v: T) => void
) {
  root.replaceChildren(
    ...options.map(([v, label]) =>
      h(
        'button',
        {
          type: 'button',
          'aria-pressed': String(v === value),
          onclick: () => onPick(v),
        },
        label
      )
    )
  );
}
const field = (label: string, ...kids: Kid[]) =>
  h('div', { class: 'field' }, h('div', { class: 'lab' }, label), ...kids);

// ------------------------------------------------------------------ vocabulário
const GRADE: Record<
  StenosisGrade,
  { label: string; note: string; abbr: string; color: string }
> = {
  minima: { label: 'Mínima', note: '1–24%', abbr: 'mín', color: '#8fe57c' },
  discreta: {
    label: 'Discreta',
    note: '25–49%',
    abbr: 'disc',
    color: '#f3c84f',
  },
  moderada: {
    label: 'Moderada',
    note: '50–69%',
    abbr: 'mod',
    color: '#ff9b3f',
  },
  importante: {
    label: 'Importante',
    note: '70–94%',
    abbr: 'imp',
    color: '#ff4a4a',
  },
  suboclusao: {
    label: 'Suboclusão',
    note: '95–99%',
    abbr: 'sub',
    color: '#ff72b6',
  },
  oclusao: { label: 'Oclusão', note: '100%', abbr: 'ocl', color: '#a68dff' },
};
const GRADES = Object.keys(GRADE) as StenosisGrade[];
const VNAME: Record<string, string> = {
  TCE: 'Tronco da Coronária Esquerda',
  DA: 'Descendente Anterior',
  CX: 'Circunflexa',
  CD: 'Coronária Direita',
};
const SEGNAME: Record<Segment, string> = {
  proximal: 'proximal',
  medio: 'médio',
  distal: 'distal',
};
const LIMITS: { v: LimitationReason | ''; label: string }[] = [
  { v: '', label: 'Adequada' },
  { v: 'movimento', label: 'Limitada: movimento' },
  { v: 'calcificacao', label: 'Limitada: calcificação' },
  { v: 'ruido', label: 'Limitada: ruído' },
  { v: 'outro', label: 'Limitada: outro' },
];
const BLABEL: Record<BranchKind, (o: number) => string> = {
  diagonal: (o) => `D${o}`,
  marginal: (o) => `Mg${o}`,
  diagonalis: () => 'Dgls',
  dp: () => 'DP',
  vp: () => 'VP',
};
const BNAME: Record<BranchKind, (o: number, n: number) => string> = {
  diagonal: (o, n) => (n > 1 ? `${o}º ramo diagonal` : 'Ramo diagonal'),
  marginal: (o, n) => (n > 1 ? `${o}º ramo marginal` : 'Ramo marginal'),
  diagonalis: () => 'Artéria Diagonalis',
  dp: () => 'Descendente Posterior',
  vp: () => 'Ventricular Posterior',
};
const MAXSLOT: Record<BranchKind, number> = {
  diagonal: 3,
  marginal: 3,
  diagonalis: 1,
  dp: 1,
  vp: 1,
};
const KINDS: BranchKind[] = ['diagonal', 'marginal', 'diagonalis', 'dp', 'vp'];
function parentOf(kind: BranchKind): MainVesselId {
  if (kind === 'diagonal') return 'DA';
  if (kind === 'marginal') return 'CX';
  if (kind === 'diagonalis') return 'TCE';
  if (S.dominance === 'esquerda') return 'CX';
  if (S.dominance === 'codominante' && kind === 'vp') return 'CX';
  return 'CD';
}
const branchesOf = (kind: BranchKind) =>
  S.branches.filter((b) => b.kind === kind).sort((a, b) => a.order - b.order);
const branchById = (id: string) => S.branches.find((b) => b.id === id);
const limitKey = (vessel: string, t: number) =>
  isSegmented(vessel) ? `${vessel}.${segmentAt(vessel, t)}` : vessel;
const plaqueAt = (vessel: string, t: number) =>
  S.plaques.find(
    (p) =>
      p.vessel === vessel &&
      t >= span(p.t, p.len)[0] - 0.01 &&
      t <= span(p.t, p.len)[1] + 0.01
  );
const selVessel = () =>
  sel?.kind === 'point'
    ? sel.vessel
    : sel?.kind === 'plaque'
      ? S.plaques.find((p) => p.id === (sel as any).id)?.vessel
      : undefined;

function pick(p: Pick) {
  if (p.kind === 'ghost') return addBranch(p.branchKind);
  if (p.kind === 'plaque') sel = { kind: 'plaque', id: p.id };
  else {
    const hit = plaqueAt(p.vessel, p.t);
    sel = hit
      ? { kind: 'plaque', id: hit.id }
      : { kind: 'point', vessel: p.vessel, t: p.t };
  }
  renderMaps();
  renderInspector();
}
function addBranch(kind: BranchKind) {
  const b: BranchState = {
    id: newId(),
    kind,
    order: branchesOf(kind).length + 1,
    importance: kind === 'dp' || kind === 'vp' ? undefined : 'pequena',
  };
  S.branches.push(b);
  sel = { kind: 'point', vessel: b.id, t: 0.5 };
  changed();
}
function removeBranch(b: BranchState) {
  S.branches = S.branches.filter((x) => x !== b);
  S.plaques = S.plaques.filter((p) => p.vessel !== b.id);
  delete S.limited[b.id];
  branchesOf(b.kind).forEach((x, i) => (x.order = i + 1));
  sel = null;
  changed();
}

// ------------------------------------------------------------------ mapa planificado
const PATH: Record<string, string> = {
  TCE: 'M283,104 L326,116',
  'DA.proximal': 'M326,116 C338,150 344,185 346,220',
  'DA.medio': 'M346,220 C350,285 350,335 342,395',
  'DA.distal': 'M342,395 C334,450 324,498 312,540',
  'CX.proximal': 'M326,116 C370,106 420,112 452,140',
  'CX.medio': 'M452,140 C478,170 486,230 484,290',
  'CX.distal': 'M484,290 C482,350 468,410 440,455',
  'CD.proximal': 'M208,106 C165,112 135,150 128,210',
  'CD.medio': 'M128,210 C122,280 128,345 150,405',
  'CD.distal': 'M150,405 C170,450 215,478 262,488',
};
const SLOT: Record<
  string,
  { d: string; lx: number; ly: number; anchor?: string }[]
> = {
  diagonal: [
    { d: 'M343,186 C365,200 392,236 400,282', lx: 408, ly: 290 },
    { d: 'M349,272 C370,286 392,322 396,364', lx: 404, ly: 372 },
    { d: 'M348,346 C366,360 382,394 384,432', lx: 392, ly: 440 },
  ],
  marginal: [
    { d: 'M469,166 C496,176 526,206 536,250', lx: 540, ly: 266 },
    { d: 'M485,252 C510,266 536,300 541,346', lx: 545, ly: 362 },
    { d: 'M483,332 C505,346 526,382 526,422', lx: 530, ly: 438 },
  ],
  diagonalis: [{ d: 'M326,116 C356,134 388,160 404,198', lx: 412, ly: 206 }],
  'dp.CD': [
    { d: 'M262,488 C274,508 284,530 288,556', lx: 270, ly: 566, anchor: 'end' },
  ],
  'vp.CD': [{ d: 'M262,488 C300,482 340,470 372,452', lx: 380, ly: 470 }],
  'dp.CX': [
    { d: 'M440,455 C392,480 332,506 290,554', lx: 272, ly: 566, anchor: 'end' },
  ],
  'vp.CX': [{ d: 'M440,455 C434,482 428,508 418,532', lx: 426, ly: 546 }],
};
const slotKey = (kind: BranchKind) =>
  kind === 'dp' || kind === 'vp' ? `${kind}.${parentOf(kind)}` : kind;

function renderFlat() {
  const svg = $<SVGSVGElement>('#flat');
  svg.replaceChildren();
  const paths: Record<string, SVGPathElement> = {}; // chave: 'DA.proximal' | 'TCE' | id do ramo
  /** vaso + t → caminho e fração dentro dele */
  const locate = (
    vessel: string,
    t: number
  ): [SVGPathElement, number] | null => {
    if (isSegmented(vessel)) {
      const sg = segmentAt(vessel, t)!;
      const [a, b] = SEG_RANGE[vessel][sg];
      const p = paths[`${vessel}.${sg}`];
      return p ? [p, (t - a) / (b - a)] : null;
    }
    const p = paths[vessel];
    return p ? [p, t] : null;
  };
  const pointAt = (vessel: string, t: number) => {
    const l = locate(vessel, t);
    return l
      ? l[0].getPointAtLength(l[0].getTotalLength() * clamp01(l[1]))
      : null;
  };

  const element = (
    key: string,
    vessel: string,
    range: [number, number],
    d: string,
    branch: boolean,
    label: string
  ) => {
    const lim = !!S.limited[key];
    const ves = sv('path', {
      class: `ves${branch ? ' br' : ''}${lim ? ' limited' : ''}`,
      d,
    }) as SVGPathElement;
    paths[key] = ves;
    const onClick = (ev: MouseEvent) => {
      const pt = svg.createSVGPoint();
      pt.x = ev.clientX;
      pt.y = ev.clientY;
      const q = pt.matrixTransform(svg.getScreenCTM()!.inverse());
      const L = ves.getTotalLength();
      let best = 0.5,
        bd = Infinity;
      for (let i = 0; i <= 40; i++) {
        const r = ves.getPointAtLength((L * i) / 40);
        const dd = (r.x - q.x) ** 2 + (r.y - q.y) ** 2;
        if (dd < bd) {
          bd = dd;
          best = i / 40;
        }
      }
      pick({
        kind: 'vessel',
        vessel,
        t: range[0] + best * (range[1] - range[0]),
      });
    };
    svg.append(
      sv(
        'g',
        {
          class: `el${selVessel() === vessel ? ' on' : ''}`,
          'data-vessel': vessel,
          tabindex: 0,
          role: 'button',
          'aria-label': label,
          onclick: onClick,
          onkeydown: (ev: KeyboardEvent) => {
            if (ev.key === 'Enter' || ev.key === ' ') {
              ev.preventDefault();
              pick({ kind: 'vessel', vessel, t: (range[0] + range[1]) / 2 });
            }
          },
        },
        sv('path', { class: `halo${branch ? ' br' : ''}`, d }),
        ves,
        sv('path', { class: 'hit', d })
      )
    );
  };

  for (const kind of KINDS) {
    const slots = SLOT[slotKey(kind)]!;
    const list = branchesOf(kind);
    list.forEach((b, i) => {
      const sl = slots[i];
      if (!sl) return;
      element(
        b.id,
        b.id,
        [0, 1],
        sl.d,
        true,
        BNAME[kind](b.order, list.length)
      );
      svg.append(
        sv(
          'text',
          { x: sl.lx, y: sl.ly, 'text-anchor': sl.anchor ?? 'start' },
          BLABEL[kind](b.order)
        )
      );
    });
    const next = slots[list.length];
    if (next)
      svg.append(
        sv(
          'g',
          {
            class: 'gh',
            tabindex: 0,
            role: 'button',
            'aria-label': `Adicionar ${BLABEL[kind](list.length + 1)}`,
            onclick: () => addBranch(kind),
            onkeydown: (ev: KeyboardEvent) => {
              if (ev.key === 'Enter') addBranch(kind);
            },
          },
          sv('path', { class: 'ghost', d: next.d }),
          sv('path', { class: 'hit', d: next.d }),
          sv(
            'text',
            { x: next.lx, y: next.ly, 'text-anchor': next.anchor ?? 'start' },
            `+ ${BLABEL[kind](list.length + 1)}`
          )
        )
      );
  }
  for (const key of Object.keys(PATH)) {
    const [v, sg] = key.split('.') as [string, Segment | undefined];
    element(
      key,
      v,
      sg && isSegmented(v) ? SEG_RANGE[v][sg] : [0, 1],
      PATH[key]!,
      false,
      sg ? `${VNAME[v]}, segmento ${SEGNAME[sg]}` : VNAME[v]!
    );
  }
  svg.append(
    sv('circle', { class: 'aorta', cx: 245, cy: 92, r: 40 }),
    sv('text', { class: 'big', x: 245, y: 97, 'text-anchor': 'middle' }, 'Ao')
  );
  for (const [x, y] of [
    [346, 220],
    [342, 395],
    [452, 140],
    [484, 290],
    [128, 210],
    [150, 405],
    [326, 116],
  ] as const)
    svg.append(sv('circle', { class: 'joint', cx: x, cy: y, r: 3.2 }));
  for (const [t, x, y, a] of [
    ['TCE', 304, 96, 'middle'],
    ['DA', 322, 300, 'end'],
    ['CX', 404, 100, 'middle'],
    ['CD', 106, 300, 'end'],
  ] as const)
    svg.append(sv('text', { class: 'big', x, y, 'text-anchor': a }, t));

  const badge = (x: number, y: number, txt: string, color: string) => {
    const w = txt.length * 6.2 + 8;
    svg.append(
      sv(
        'g',
        { class: 'badge' },
        sv('rect', {
          x: x - w / 2,
          y: y - 8,
          width: w,
          height: 16,
          rx: 4,
          style: `stroke:${color}`,
        }),
        sv('text', { x, y: y + 3.6, style: `fill:${color}` }, txt)
      )
    );
  };
  // placas: trecho pintado sobre o vaso
  for (const p of S.plaques) {
    const [a, b] = span(p.t, p.len);
    const color = GRADE[p.grade].color;
    const keys = isSegmented(p.vessel)
      ? SEGMENTS.map(
          (sg) =>
            [`${p.vessel}.${sg}`, SEG_RANGE[p.vessel as 'DA'][sg]] as const
        )
      : [[p.vessel, [0, 1]] as const];
    for (const [key, [r0, r1]] of keys) {
      const base = paths[key];
      if (!base) continue;
      const f0 = (Math.max(a, r0) - r0) / (r1 - r0),
        f1 = (Math.min(b, r1) - r0) / (r1 - r0);
      if (f1 <= f0) continue;
      const d = base.getAttribute('d')!;
      const dash = `0 ${f0} ${f1 - f0} 1`;
      const wide = base.classList.contains('br') ? 10 : 14;
      if (sel?.kind === 'plaque' && sel.id === p.id)
        svg.append(
          sv('path', {
            class: 'pl',
            d,
            pathLength: 1,
            'stroke-dasharray': dash,
            style: `stroke:#f2ead3;stroke-width:${wide + 10};opacity:.3`,
          })
        );
      svg.append(
        sv('path', {
          class: 'pl',
          d,
          pathLength: 1,
          'stroke-dasharray': dash,
          'data-plaque': p.id,
          style: `stroke:${color};stroke-width:${wide}`,
        })
      );
    }
    const c = pointAt(p.vessel, (a + b) / 2);
    if (c) badge(c.x, c.y, GRADE[p.grade].abbr, color);
  }
  for (const key of Object.keys(S.limited)) {
    const base = paths[key];
    if (base) {
      const c = base.getPointAtLength(base.getTotalLength() / 2);
      badge(
        c.x,
        c.y + (S.plaques.some((p) => limitKey(p.vessel, p.t) === key) ? 20 : 0),
        'lim',
        '#aab7c9'
      );
    }
  }
  if (sel?.kind === 'point') {
    const c = pointAt(sel.vessel, sel.t);
    if (c)
      svg.append(sv('circle', { class: 'cursor', cx: c.x, cy: c.y, r: 9 }));
  }
}

// ------------------------------------------------------------------ mapa 3D
function sceneModel(): SceneModel {
  const branches = S.branches.map((b) => ({
    id: b.id,
    kind: b.kind,
    index: b.order - 1,
    parent: parentOf(b.kind),
    label: BLABEL[b.kind](b.order),
  }));
  const ghosts = KINDS.filter((k) => branchesOf(k).length < MAXSLOT[k]).map(
    (k) => ({
      kind: k,
      index: branchesOf(k).length,
      parent: parentOf(k),
      label: BLABEL[k](branchesOf(k).length + 1),
    })
  );
  return {
    dominance: S.dominance,
    branches,
    ghosts,
    plaques: S.plaques.map((p) => ({
      id: p.id,
      vessel: p.vessel,
      t: p.t,
      len: p.len,
      color: GRADE[p.grade].color,
      abbr: GRADE[p.grade].abbr,
    })),
    limited: new Set(Object.keys(S.limited)),
    cursor: sel?.kind === 'point' ? { vessel: sel.vessel, t: sel.t } : null,
    selectedPlaque: sel?.kind === 'plaque' ? sel.id : null,
  };
}
function renderMaps() {
  const view = mapView === '3d' && !scene3 ? 'plano' : mapView;
  $('#stage3').style.display = view === '3d' ? '' : 'none';
  $('#flat').style.display = view === 'plano' ? '' : 'none';
  $('#cacstage').style.display = view === 'calcio' ? '' : 'none';
  $('#legend').style.display = view === 'calcio' ? 'none' : '';
  $('#dominance').style.display = view === 'calcio' ? 'none' : '';
  if (view === '3d') {
    scene3!.resize();
    scene3!.update(sceneModel());
  } else if (view === 'plano') renderFlat();
  else renderCalcBar();
  segctl(
    $('#viewsw'),
    view,
    [
      ['calcio', 'Cálcio'],
      ['3d', '3D'],
      ['plano', 'Planificado'],
    ],
    (v) => {
      mapView = v;
      renderMaps();
    }
  );
  ($('#viewsw').children[1] as HTMLButtonElement).disabled = !scene3;
}

// ------------------------------------------------------------------ exame (DICOM local) e escore na imagem
const say = (text: string) => {
  $('#cacmsg').textContent = text;
};
function renderCalcBar() {
  $('#cacempty').style.display = calcView ? 'none' : '';
  $('#cactools').style.display = calcView ? '' : 'none';
  $('#cacfoot').style.display = calcView ? '' : 'none';
  if (!calcView) return;
  const opts: [Tool, string][] = [
    ['TCE', 'TCE'],
    ['DA', 'DA'],
    ['CX', 'CX'],
    ['CD', 'CD'],
    ['excluir', 'Excluir'],
  ];
  $('#tools').replaceChildren(
    ...opts.map(([v, label], i) =>
      h(
        'button',
        {
          class: 'chip',
          type: 'button',
          'aria-pressed': String(v === tool),
          title: `Tecla ${i < 4 ? i + 1 : 0}`,
          onclick: () => {
            tool = v;
            calcView!.setTool(v);
            renderCalcBar();
          },
        },
        v === 'excluir'
          ? null
          : h('i', { style: `background:rgb(${TOOL_COLOR[v].join(',')})` }),
        label
      )
    )
  );
  segctl(
    $('#spread'),
    String(spread),
    [
      ['0', 'Só este corte'],
      ['1', '±1'],
      ['2', '±2'],
    ],
    (v) => {
      spread = Number(v);
      calcView!.setSpread(spread);
      renderCalcBar();
    }
  );
}
function useOpenSeries() {
  const s = HOST.currentSeries();
  mapView = 'calcio';
  if (!s || 'error' in s) {
    calcView?.destroy();
    calcView = null;
    loadedKey = null;
    renderMaps();
    $('#cacstatus').textContent = s
      ? s.error
      : 'Nenhum exame aberto. Volte ao CatStudio, abra a pasta do exame e selecione a série do escore de cálcio.';
    return;
  }
  calcView?.destroy();
  calcView = null;
  renderMaps();
  $('#cacstatus').textContent = 'Detectando focos ≥ 130 UH…';
  setTimeout(() => {
    try {
      calcView = createCalciumView($('#cacbox'), s.vol, {
        score: (r) => {
          S.cac = { ...r.perVessel };
          cacWarnings = s.thicknessKnown
            ? r.warnings
            : [
                ...r.warnings,
                'Espessura de corte não informada no DICOM: usado o espaçamento entre cortes.',
              ];
          cacFromImage = true;
          renderPanels();
          renderReport();
          save();
        },
        slice: (z, n) => {
          $('#slicelab').textContent = `Corte ${z + 1} de ${n}`;
          const sl = $<HTMLInputElement>('#slider');
          sl.max = String(n - 1);
          sl.value = String(z);
        },
        message: say,
      });
      loadedKey = s.key;
      if (s.ageYears) S.age = s.ageYears;
      if (s.sex) S.sex = s.sex;
      calcView.setTool(tool);
      calcView.setSpread(spread);
      $('#seriesname').textContent = s.description || 'Série sem nome';
      const odd = Math.abs(s.vol.sliceThickness - 3) > 0.3 || s.contrast;
      say(
        `${odd ? `Atenção: esta série não parece a do escore (${s.vol.sliceThickness} mm${s.contrast ? ', com contraste' : ''}). ` : ''}${calcView.candidateCount} focos candidatos. Escolha o vaso e clique no foco; arraste para contornar só uma parte.`
      );
      $('#cacstatus').textContent = '';
      changed();
    } catch (e) {
      $('#cacstatus').textContent =
        `Não foi possível ler a série: ${(e as Error).message}`;
    }
  }, 30);
}

// ------------------------------------------------------------------ inspetor
function renderInspector() {
  const box = $('#inspector');
  box.replaceChildren(h('h3', {}, 'Ponto selecionado'));
  if (!sel) {
    box.append(
      h(
        'div',
        { class: 'hint' },
        'Clique no ponto do vaso onde está a placa. O segmento citado no laudo é definido pela posição marcada. Linhas tracejadas adicionam ramos.'
      )
    );
    return;
  }
  const plaque =
    sel.kind === 'plaque'
      ? S.plaques.find((p) => p.id === (sel as any).id)
      : undefined;
  if (sel.kind === 'plaque' && !plaque) {
    sel = null;
    return renderInspector();
  }
  const vessel = plaque ? plaque.vessel : ((sel as any).vessel as string);
  const t = plaque ? plaque.t : ((sel as any).t as number);
  const branch = branchById(vessel);
  const title = branch
    ? BNAME[branch.kind](branch.order, branchesOf(branch.kind).length)
    : VNAME[vessel]!;
  const where = () => {
    if (!isSegmented(vessel))
      return branch
        ? `Ramo da ${VNAME[parentOf(branch.kind)]}`
        : 'Vaso inteiro';
    const segs = plaque
      ? segmentsOfSpan(vessel, ...span(plaque.t, plaque.len))
      : [segmentAt(vessel, t)!];
    return `${segs.length > 1 ? 'Segmentos' : 'Segmento'} ${segs.map((x) => SEGNAME[x]).join(' e ')}`;
  };
  const sub = h('div', { class: 'sub', id: 'where' }, where());
  box.append(h('div', { class: 'title' }, title), sub);

  const types = [
    { v: 'nao_calcificada' as PlaqueType, label: 'Não calcificada' },
    {
      v: 'parcialmente_calcificada' as PlaqueType,
      label: 'Parcialmente calcificada',
    },
    { v: 'calcificada' as PlaqueType, label: 'Calcificada' },
  ];
  if (!plaque) {
    box.append(
      field(
        'Marcar placa neste ponto',
        chips<PlaqueType>('', types, (v) => {
          if (!v) return;
          const p: PlaqueState = {
            id: newId('p'),
            vessel,
            t,
            len: isSegmented(vessel) ? 0.08 : 0.3,
            type: v,
            grade: 'discreta',
          };
          S.plaques.push(p);
          sel = { kind: 'plaque', id: p.id };
        })
      )
    );
  } else {
    box.append(
      field(
        'Placa',
        chips<PlaqueType>(plaque.type, types, (v) => {
          if (v) plaque.type = v;
        })
      )
    );
    box.append(
      field(
        'Redução luminal',
        chips<StenosisGrade>(
          plaque.grade,
          GRADES.map((g) => ({
            v: g,
            label: GRADE[g].label,
            note: GRADE[g].note,
            color: GRADE[g].color,
          })),
          (v) => {
            if (v) plaque.grade = v;
          }
        )
      )
    );
    box.append(
      field(
        'Extensão da placa ao longo do vaso',
        h('input', {
          id: 'len',
          type: 'range',
          min: 4,
          max: 70,
          step: 1,
          value: Math.round(plaque.len * 100),
          oninput: (ev: Event) => {
            plaque.len = Number((ev.target as HTMLInputElement).value) / 100;
            $('#where').textContent = where();
            renderMaps();
            renderReport();
            save();
          },
        })
      )
    );
    box.append(
      h(
        'div',
        {},
        h(
          'button',
          {
            class: 'btn danger',
            type: 'button',
            onclick: () => {
              S.plaques = S.plaques.filter((p) => p !== plaque);
              sel = { kind: 'point', vessel, t };
              changed();
            },
          },
          'Remover placa'
        )
      )
    );
  }
  const lk = limitKey(vessel, t);
  box.append(
    field(
      isSegmented(vessel)
        ? `Avaliação do segmento ${SEGNAME[segmentAt(vessel, t)!]}`
        : 'Avaliação do vaso',
      chips<LimitationReason>(S.limited[lk] ?? '', LIMITS, (v) => {
        if (v) S.limited[lk] = v;
        else delete S.limited[lk];
      })
    )
  );
  if (vessel === 'DA') {
    box.append(
      field(
        'Apex (vaso)',
        chips(
          S.apex,
          [
            { v: 'atinge', label: 'Atinge' },
            { v: 'contorna', label: 'Contorna' },
            { v: '', label: 'Não citar' },
          ],
          (x) => (S.apex = x as State['apex'])
        )
      )
    );
    box.append(
      field(
        'Trajeto intramiocárdico (vaso)',
        chips<Segment>(
          S.bridge,
          [
            { v: '', label: 'Não' },
            { v: 'proximal', label: 'Proximal' },
            { v: 'medio', label: 'Médio' },
            { v: 'distal', label: 'Distal' },
          ],
          (x) => (S.bridge = x)
        )
      )
    );
  }
  if (branch) {
    box.append(
      field(
        'Importância',
        chips<Importance>(
          branch.importance ?? '',
          [
            { v: '', label: 'Não citar' },
            { v: 'pequena', label: 'Pequena' },
            { v: 'moderada', label: 'Moderada' },
            { v: 'grande', label: 'Grande' },
          ],
          (v) => (branch.importance = v || undefined)
        )
      )
    );
    if (branch.kind === 'dp')
      box.append(
        field(
          'Variante',
          h(
            'div',
            { class: 'chips' },
            h(
              'button',
              {
                class: 'chip',
                type: 'button',
                'aria-pressed': String(!!branch.dupla),
                onclick: () => {
                  branch.dupla = !branch.dupla;
                  changed();
                },
              },
              'Dupla'
            ),
            h(
              'button',
              {
                class: 'chip',
                type: 'button',
                'aria-pressed': String(!!branch.precoce),
                onclick: () => {
                  branch.precoce = !branch.precoce;
                  changed();
                },
              },
              'Origem precoce'
            )
          )
        )
      );
    box.append(
      h(
        'div',
        {},
        h(
          'button',
          {
            class: 'btn danger',
            type: 'button',
            onclick: () => removeBranch(branch),
          },
          'Ramo ausente: remover do laudo'
        )
      )
    );
  }
}

// ------------------------------------------------------------------ painéis
function numInput(
  id: string,
  value: number | undefined,
  on: (v: number) => void,
  attrs: Record<string, any> = {}
) {
  return h('input', {
    id,
    class: 'num',
    type: 'number',
    value: value ?? '',
    ...attrs,
    oninput: (ev: Event) => {
      on(parseFloat((ev.target as HTMLInputElement).value) || 0);
      renderReport();
      save();
    },
  });
}
function renderPanels() {
  $('#exam').replaceChildren(
    h('h3', {}, 'Exame'),
    h(
      'div',
      { class: 'row' },
      h(
        'label',
        { class: 'f', for: 'age' },
        'Idade',
        numInput('age', S.age, (v) => (S.age = v), { min: 18, max: 110 })
      ),
      h('span', { class: 'f' }, 'Sexo'),
      chips<Sex>(
        S.sex,
        [
          { v: 'M', label: 'Masculino' },
          { v: 'F', label: 'Feminino' },
        ],
        (v) => {
          if (v) S.sex = v;
        }
      )
    ),
    field(
      'Tipo de exame',
      chips(
        S.kind,
        [
          { v: 'escore_angio', label: 'Escore + angio' },
          { v: 'angio', label: 'Só angio' },
          { v: 'escore', label: 'Só escore' },
        ],
        (v) => {
          if (v) S.kind = v as Exam['kind'];
        }
      )
    )
  );
  const cal = $('#calcium');
  cal.style.display = S.kind === 'angio' ? 'none' : '';
  cal.replaceChildren(
    h(
      'div',
      { class: 'row' },
      h('h3', {}, 'Escore de cálcio'),
      h(
        'span',
        { class: 'tag' },
        cacFromImage ? 'medido na imagem' : 'digitado por vaso'
      )
    ),
    h(
      'div',
      { class: 'cac' },
      ...(['TCE', 'DA', 'CX', 'CD'] as const).map((v) =>
        h(
          'label',
          { for: `cac-${v}` },
          v,
          numInput(
            `cac-${v}`,
            cacFromImage ? Math.round(S.cac[v]) : S.cac[v],
            (x) => (S.cac[v] = Math.max(0, x)),
            { min: 0, step: 1, disabled: cacFromImage }
          )
        )
      )
    ),
    h('div', { class: 'kpis', id: 'kpis' }),
    h(
      'div',
      {},
      h(
        'button',
        {
          class: 'chip',
          type: 'button',
          'aria-pressed': String(S.showN),
          onclick: () => {
            S.showN = !S.showN;
            changed();
          },
        },
        'Citar N do CAC-DRS no texto'
      )
    )
  );
  const A = S.additional;
  const toggle = (key: keyof AdditionalFindings, label: string) =>
    h(
      'button',
      {
        class: 'chip',
        type: 'button',
        'aria-pressed': String(!!A[key]),
        onclick: () => {
          (A as any)[key] = !A[key] || undefined;
          changed();
        },
      },
      label
    );
  const cm = (
    key:
      | 'ectasiaRaizAortica'
      | 'ectasiaAortaAscendente'
      | 'ectasiaTroncoPulmonar',
    label: string
  ) =>
    h(
      'label',
      { class: 'f', for: key },
      label,
      numInput(key, A[key], (v) => (A[key] = v > 0 ? v : undefined), {
        min: 0,
        step: 0.1,
        placeholder: 'cm',
      })
    );
  $('#additional').replaceChildren(
    h('h3', {}, 'Achados adicionais'),
    h(
      'div',
      { class: 'chips' },
      toggle('ateromatoseAortica', 'Ateromatose aórtica'),
      toggle('hipertrofiaVentricularEsquerda', 'HVE'),
      toggle('septoSigmoide', 'Septo sigmoide'),
      toggle('esternorrafia', 'Esternorrafia'),
      toggle(
        'achadosToracicosEstudoDirigido',
        'Achados torácicos no estudo dirigido'
      )
    ),
    field(
      'Átrios',
      chips(
        A.atrios ?? '',
        [
          { v: '', label: 'Normais' },
          { v: 'aumento_atrio_esquerdo', label: 'Aumento do AE' },
          { v: 'aumento_biatrial', label: 'Aumento biatrial' },
        ],
        (v) => (A.atrios = (v || undefined) as AdditionalFindings['atrios'])
      )
    ),
    field(
      'Ectasia, maior diâmetro em cm',
      h(
        'div',
        { class: 'row' },
        cm('ectasiaRaizAortica', 'Raiz'),
        cm('ectasiaAortaAscendente', 'Ascendente'),
        cm('ectasiaTroncoPulmonar', 'Tronco pulmonar')
      )
    )
  );
}

// ------------------------------------------------------------------ exame e laudo
function buildExam(): Exam & { mesaApprox: boolean } {
  const patient = { ageYears: S.age, sex: S.sex };
  const calcium = buildCalciumResult(
    S.cac,
    patient,
    cacFromImage ? cacWarnings : []
  );
  const plaquesOf = (vessel: string): Plaque[] =>
    S.plaques
      .filter((p) => p.vessel === vessel)
      .sort((a, b) => a.t - b.t)
      .map((p) => ({
        id: p.id,
        segments: segmentsOfSpan(vessel, ...span(p.t, p.len)),
        type: p.type,
        grade: p.grade,
        status: 'manual',
      }));
  const vessel = (id: MainVesselId): MainVessel => {
    const v: MainVessel = {
      id,
      present: true,
      plaques: plaquesOf(id),
      limited: {},
    };
    if (id === 'TCE') v.limitedWhole = S.limited.TCE;
    else
      for (const sg of SEGMENTS) {
        const r = S.limited[`${id}.${sg}`];
        if (r) v.limited[sg] = r;
      }
    if (id === 'DA') {
      if (S.apex) v.apex = S.apex;
      if (S.bridge) v.intramyocardial = { segment: S.bridge };
    }
    return v;
  };
  const branches: Branch[] = S.branches.map((b) => ({
    id: b.id,
    kind: b.kind,
    parent: parentOf(b.kind),
    order: b.order,
    importance: b.importance,
    plaques: plaquesOf(b.id),
    limited: S.limited[b.id] ? { reason: S.limited[b.id]! } : undefined,
    dpVariant:
      b.kind === 'dp' ? { dupla: b.dupla, precoce: b.precoce } : undefined,
  }));
  return {
    patient,
    kind: S.kind,
    detectorRows: 320,
    calcium,
    angio: {
      dominance: S.dominance,
      vessels: (['TCE', 'DA', 'CX', 'CD'] as const).map(vessel),
      branches,
    },
    additional: S.additional,
    mesaApprox: calcium.mesaApproximate,
  };
}
/** Fontes de uma linha do laudo → chaves do mapa (vasos e placas). */
function keysOf(sources: string[]): string[] {
  const out = new Set<string>();
  for (const s of sources) {
    if (S.plaques.some((p) => p.id === s)) out.add(s);
    else {
      const v = s.split('.')[0]!;
      if (VNAME[v] || branchById(v)) out.add(v);
    }
  }
  return [...out];
}
function flatHighlight(keys: string[]) {
  ROOT.querySelectorAll<SVGElement>('#flat g.el').forEach((g) =>
    g.classList.toggle('hl', keys.includes(g.dataset.vessel!))
  );
  ROOT.querySelectorAll<SVGElement>('#flat path.pl[data-plaque]').forEach((p) =>
    p.classList.toggle('hl', keys.includes(p.dataset.plaque!))
  );
}
function renderReport() {
  const exam = buildExam();
  const r = generateReport(exam, { showCacDrsN: S.showN });
  const out = $('#report');
  out.replaceChildren();
  const now: string[] = [];
  r.sections.forEach((sec, si) => {
    if (si) out.append(h('div', { class: 'line blank' }));
    for (const l of [
      ...(sec.title ? [{ text: sec.title, sources: [] as string[] }] : []),
      ...sec.lines,
    ]) {
      now.push(l.text);
      if (!l.text) {
        out.append(h('div', { class: 'line blank' }));
        continue;
      }
      const keys = keysOf(l.sources);
      const el = h(
        'div',
        {
          class: `line${keys.length ? ' src' : ''}${lastLines.length > 0 && !lastLines.includes(l.text) ? ' flash' : ''}`,
        },
        l.text
      );
      if (keys.length) {
        el.addEventListener('mouseenter', () => {
          scene3?.highlight(keys);
          flatHighlight(keys);
        });
        el.addEventListener('mouseleave', () => {
          scene3?.highlight([]);
          flatHighlight([]);
        });
        el.addEventListener('click', () => {
          const pid = keys.find((k) => S.plaques.some((p) => p.id === k));
          sel = pid
            ? { kind: 'plaque', id: pid }
            : { kind: 'point', vessel: keys[0]!, t: 0.5 };
          renderMaps();
          renderInspector();
        });
      }
      out.append(el);
    }
  });
  lastLines = now;
  out.dataset.text = toPlainText(r);

  const c = exam.calcium!;
  const k = ROOT.querySelector('#kpis');
  if (k)
    k.replaceChildren(
      h(
        'div',
        { class: 'kpi' },
        h('span', {}, 'Agatston'),
        h('b', {}, c.total.toLocaleString('pt-BR'))
      ),
      h(
        'div',
        { class: 'kpi' },
        h('span', {}, 'CAC-DRS'),
        h('b', {}, c.cacDrs === 'A0' ? 'A0' : `${c.cacDrs}/N${c.vesselCount}`)
      ),
      h(
        'div',
        { class: 'kpi', title: c.mesaNote ?? '' },
        h('span', {}, 'Percentil MESA'),
        h('b', {}, c.mesaPercentile === null ? '—' : String(c.mesaPercentile)),
        c.mesaPercentile !== null && exam.mesaApprox
          ? h('em', {}, 'aprox.')
          : null
      )
    );
  const warn = [...r.warnings];
  if (
    S.kind !== 'angio' &&
    c.total > 0 &&
    c.mesaPercentile !== null &&
    MESA_WHITE[S.sex].provisional
  )
    warn.push(
      'Percentil MESA calculado com tabela provisória. Validar contra a calculadora oficial antes de uso clínico.'
    );
  $('#warnings').replaceChildren(...warn.map((w) => h('li', {}, w)));
  $('#warnbox').style.display = warn.length ? '' : 'none';
  const nP = S.plaques.length,
    nL = Object.keys(S.limited).length;
  $('#status').replaceChildren(
    h('span', {}, `${nP} placa${nP === 1 ? '' : 's'}`),
    h('span', {}, `${nL} trecho${nL === 1 ? '' : 's'} com avaliação limitada`),
    h('span', {}, 'Atualizado a cada clique. Nenhum dado sai deste computador.')
  );
}

// ------------------------------------------------------------------ modos de desempenho
const STAGES: {
  name: string;
  how: Record<Mode, string>;
  ready: Record<Mode, boolean>;
}[] = [
  {
    name: 'Escore de cálcio',
    how: {
      lento: 'na imagem ou digitado',
      medio: 'focos detectados, vaso por clique',
      nave: 'vaso sugerido automaticamente',
    },
    ready: { lento: true, medio: true, nave: false },
  },
  {
    name: 'Árvore coronária',
    how: {
      lento: 'marcada no mapa',
      medio: '2 cliques nos óstios',
      nave: 'segmentação automática',
    },
    ready: { lento: true, medio: false, nave: false },
  },
  {
    name: 'Placas',
    how: {
      lento: 'marcadas no mapa',
      medio: 'marcadas no mapa',
      nave: 'candidatas automáticas',
    },
    ready: { lento: true, medio: true, nave: false },
  },
  {
    name: 'Laudo',
    how: {
      lento: 'redigido ao vivo',
      medio: 'redigido ao vivo',
      nave: 'rascunho automático',
    },
    ready: { lento: true, medio: true, nave: true },
  },
];
function renderHeader() {
  $('#pipeline').replaceChildren(
    ...STAGES.map((st) =>
      h(
        'div',
        {
          class: `stage${st.ready[mode] ? '' : ' soon'}`,
          title: st.ready[mode]
            ? `${st.how[mode]} · disponível nesta versão`
            : `${st.how[mode]} · em construção: nesta versão a entrada continua manual`,
        },
        h('i', {}),
        h('b', {}, st.name),
        h(
          'span',
          {},
          st.ready[mode] ? st.how[mode] : `${st.how[mode]} · em construção`
        )
      )
    )
  );
  segctl(
    $('#modes'),
    mode,
    [
      ['lento', 'PC lento'],
      ['medio', 'PC médio'],
      ['nave', 'PC nave'],
    ],
    (m) => {
      mode = m;
      renderHeader();
    }
  );
  segctl(
    $('#dominance'),
    S.dominance,
    [
      ['direita', 'Direita'],
      ['esquerda', 'Esquerda'],
      ['codominante', 'Codominante'],
    ],
    (d) => {
      S.dominance = d;
      changed();
    }
  );
}
async function detectHardware() {
  const nav = navigator as any;
  const mem: number | undefined = nav.deviceMemory;
  const cores: number = nav.hardwareConcurrency ?? 2;
  let renderer = '',
    webgl2 = false,
    webgpu = false;
  try {
    const gl = document
      .createElement('canvas')
      .getContext('webgl2') as WebGL2RenderingContext | null;
    if (gl) {
      webgl2 = true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      if (ext) renderer = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL));
    }
  } catch {
    /* sem WebGL */
  }
  try {
    if (nav.gpu) webgpu = !!(await nav.gpu.requestAdapter());
  } catch {
    /* sem WebGPU */
  }
  const discrete =
    /nvidia|geforce|rtx|gtx|quadro|radeon (rx|pro)|\barc\b/i.test(renderer) &&
    !/swiftshader|llvmpipe/i.test(renderer);
  const enoughMem = mem === undefined ? cores >= 8 : mem >= 8;
  detected =
    webgpu && discrete && enoughMem
      ? 'nave'
      : webgl2 && enoughMem && cores >= 4
        ? 'medio'
        : 'lento';
  mode = detected;
  const gpuName =
    renderer
      .replace(/^ANGLE \(([^,]*), ?([^,(]*).*$/, '$2')
      .trim()
      .slice(0, 40) || 'vídeo não identificado';
  $('#hw').textContent =
    `Detectado: PC ${{ lento: 'lento', medio: 'médio', nave: 'nave' }[detected]}`;
  $('#hw').title =
    `${mem ? `≥${mem} GB de RAM` : 'RAM não informada pelo navegador'} · ${cores} núcleos · ${gpuName}${webgpu ? ' · WebGPU' : ' · sem WebGPU'}`;
  renderHeader();
}

// ------------------------------------------------------------------ exemplos
function example(name: string) {
  S = fresh();
  const pl = (
    vessel: string,
    t: number,
    len: number,
    type: PlaqueType,
    grade: StenosisGrade
  ) => S.plaques.push({ id: newId('p'), vessel, t, len, type, grade });
  sel = null;
  if (name === 'doente') {
    S.age = 63;
    S.cac = { TCE: 0, DA: 112, CX: 0, CD: 44 };
    S.bridge = 'medio';
    pl('DA', 0.17, 0.1, 'parcialmente_calcificada', 'discreta');
    pl('DA', 0.44, 0.09, 'nao_calcificada', 'moderada');
    pl('CD', 0.14, 0.08, 'calcificada', 'minima');
    pl('CD', 0.82, 0.08, 'calcificada', 'minima');
    S.limited['CX.distal'] = 'movimento';
    S.branches[0]!.importance = 'grande';
    S.branches.push(
      { id: newId(), kind: 'diagonal', order: 2, importance: 'pequena' },
      { id: newId(), kind: 'marginal', order: 2, importance: 'moderada' }
    );
    S.additional = {
      ateromatoseAortica: true,
      atrios: 'aumento_atrio_esquerdo',
      ectasiaAortaAscendente: 4.1,
    };
    sel = { kind: 'plaque', id: S.plaques[1]!.id };
  } else if (name === 'grave') {
    S.age = 71;
    S.dominance = 'esquerda';
    S.apex = 'contorna';
    S.cac = { TCE: 20, DA: 480, CX: 150, CD: 610 };
    pl('TCE', 0.5, 0.4, 'calcificada', 'discreta');
    pl('DA', 0.28, 0.3, 'calcificada', 'importante');
    pl('CX', 0.15, 0.1, 'parcialmente_calcificada', 'importante');
    pl('CD', 0.5, 0.12, 'calcificada', 'oclusao');
    pl(S.branches[0]!.id, 0.3, 0.3, 'nao_calcificada', 'moderada');
    S.limited['CD.distal'] = 'calcificacao';
    S.additional = { esternorrafia: true };
    sel = { kind: 'plaque', id: S.plaques[3]!.id };
  }
  lastLines = [];
  changed();
}

// ------------------------------------------------------------------ ciclo
function changed() {
  renderHeader();
  renderMaps();
  renderInspector();
  renderPanels();
  renderReport();
  save();
}

/** Chamado pelo OstiumWorkspace quando a área é reaberta: realinha o 3D e avisa se a série aberta mudou. */
export function refreshOstium() {
  if (!ROOT) return;
  renderMaps();
  const s = HOST.currentSeries();
  if (
    mapView === 'calcio' &&
    calcView &&
    s &&
    !('error' in s) &&
    s.key !== loadedKey
  )
    say(
      'A série aberta no CatStudio mudou. Use "Ler série aberta" para medir nela; o escore atual continua sendo o da série anterior.'
    );
}

export function mountOstium(root: HTMLElement, host: OstiumHost) {
  ROOT = root;
  HOST = host;
  root.innerHTML = TEMPLATE;
  scene3 = createScene($<HTMLCanvasElement>('#gl'), $('#labels3'), pick);
  if (!scene3) {
    mapView = 'plano';
    $('#no3d').style.display = '';
  }
  segctl(
    $('#camera'),
    null,
    [
      ['anterior', 'Anterior'],
      ['esquerda', 'Esquerda'],
      ['direita', 'Direita'],
      ['posterior', 'Posterior'],
    ],
    (v) => scene3?.view(v)
  );
  $('#legend').replaceChildren(
    h(
      'span',
      {},
      h('i', { style: 'background:#f2ead3' }),
      'Sem redução luminal'
    ),
    ...GRADES.map((g) =>
      h(
        'span',
        {},
        h('i', { style: `background:${GRADE[g].color}` }),
        `${GRADE[g].label} ${GRADE[g].note}`
      )
    ),
    h('span', {}, h('i', { class: 'dash' }), 'Avaliação limitada')
  );
  $('#copy').addEventListener('click', async () => {
    const btn = $('#copy');
    try {
      await navigator.clipboard.writeText($('#report').dataset.text ?? '');
      btn.textContent = 'Copiado';
    } catch {
      const rg = document.createRange();
      rg.selectNodeContents($('#report'));
      const s = getSelection()!;
      s.removeAllRanges();
      s.addRange(rg);
      btn.textContent = 'Selecionado: Ctrl+C';
    }
    setTimeout(() => (btn.textContent = 'Copiar laudo'), 1800);
  });
  $<HTMLSelectElement>('#examples').addEventListener('change', (ev) => {
    const s = ev.target as HTMLSelectElement;
    if (s.value) example(s.value);
    s.value = '';
  });
  $('#reset').addEventListener('click', () => {
    S = fresh();
    sel = null;
    lastLines = [];
    calcView?.destroy();
    calcView = null;
    loadedKey = null;
    cacFromImage = false;
    cacWarnings = [];
    if (mapView === 'calcio') mapView = '3d';
    changed();
  });
  ROOT.querySelectorAll('.useseries').forEach((b) =>
    b.addEventListener('click', useOpenSeries)
  );
  $('#closeostium').addEventListener('click', () => HOST.close());
  $<HTMLInputElement>('#slider').addEventListener('input', (e) =>
    calcView?.gotoSlice(Number((e.target as HTMLInputElement).value))
  );
  $('#undo').addEventListener('click', () => calcView?.undo());
  $('#prevf').addEventListener('click', () => calcView?.nextFocus(-1));
  $('#nextf').addEventListener('click', () => calcView?.nextFocus(1));
  $('#zoom1').addEventListener('click', () => calcView?.resetZoom());
  window.addEventListener('keydown', (e) => {
    if (
      !HOST.visible() ||
      mapView !== 'calcio' ||
      !calcView ||
      (e.target as HTMLElement).matches('input, select, textarea')
    )
      return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') {
      e.preventDefault();
      calcView.undo();
    } else if (k === 'arrowdown') {
      e.preventDefault();
      calcView.gotoSlice(calcView.slice + 1);
    } else if (k === 'arrowup') {
      e.preventDefault();
      calcView.gotoSlice(calcView.slice - 1);
    } else if ('12340'.includes(k) || k === 'delete') {
      tool =
        (
          { '1': 'TCE', '2': 'DA', '3': 'CX', '4': 'CD' } as Record<
            string,
            Tool
          >
        )[k] ?? 'excluir';
      calcView.setTool(tool);
      renderCalcBar();
    }
  });
  if (load()) changed();
  else example('doente'); // primeira abertura: estado realista, carregado do exemplo
  void detectHardware();
}
