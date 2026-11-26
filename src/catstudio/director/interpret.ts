/**
 * CatStudio — diretor de arte: interpretador local do pedido. Entende o
 * vocabulário de um pedido de corte ("sagital na hemiclavicular esquerda, MIP
 * de 20 mm, janela de pulmão", "2 cm mais lateral") sem enviar nada a lugar
 * nenhum. É o que roda quando a IA não está configurada ou não responde.
 */
import {
  REFERENCES_OF,
  THICKNESS_LIMITS,
  defaultRecipe,
  type PlaneName,
  type Recipe,
  type Reference,
  type WindowName,
} from '@/src/catstudio/director/recipe';

export interface Interpretation {
  recipe: Recipe;
  /** algo do pedido foi reconhecido */
  understood: boolean;
  /** avisos para o usuário (lado presumido, direção que não se aplica…) */
  notes: string[];
}

/** minúsculas, sem acentos, espaços simples */
export function normalize(text: string) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const PLANE_WORDS: Array<[RegExp, PlaneName]> = [
  [/sagita/, 'sagital'],
  [/coronal|frontal/, 'coronal'],
  [/axial|transvers/, 'axial'],
];

type Side = 'esquerda' | 'direita';

function sideNear(t: string, word: RegExp): Side | null {
  const hit = t.match(
    new RegExp(
      `${word.source}\\w*\\s+(?:a\\s+|do lado\\s+)?(esquerd|direit|e\\b|d\\b)`
    )
  );
  const token = hit?.[1] ?? t.match(/esquerd|direit/)?.[0];
  if (!token) return null;
  return token.startsWith('e') ? 'esquerda' : 'direita';
}

interface ReferenceHit {
  reference: Reference;
  plane: PlaneName;
  note?: string;
}

function findReference(t: string): ReferenceHit | null {
  const sided = (word: RegExp, name: 'hemiclavicular' | 'paraesternal') => {
    const side = sideNear(t, word);
    return {
      reference: `${name}-${side ?? 'esquerda'}` as Reference,
      plane: 'sagital' as const,
      note: side
        ? undefined
        : `Você não disse o lado da linha ${name}: usei a esquerda.`,
    };
  };
  if (/(hemi|medio)-?\s?clavicular/.test(t))
    return sided(/(?:hemi|medio)-?\s?clavicular/, 'hemiclavicular');
  if (/para-?\s?esternal|parasternal/.test(t))
    return sided(/(?:para-?\s?esternal|parasternal)/, 'paraesternal');
  if (
    /linha (media|mediana)|mediossagital|medio-?sagital|sagital median/.test(t)
  )
    return { reference: 'linha-media', plane: 'sagital' };
  if (/axilar/.test(t)) return { reference: 'axilar-media', plane: 'coronal' };
  if (/apice/.test(t)) return { reference: 'apice-pulmonar', plane: 'axial' };
  if (/bases? (pulmonar|do pulmao|dos pulmoes)|diafragma/.test(t))
    return { reference: 'base-pulmonar', plane: 'axial' };
  if (/\bno centro\b|\bcentral\b/.test(t))
    return { reference: 'centro', plane: 'axial' };
  return null;
}

const DIRECTIONS =
  'lateral|medial|anterior|posterior|frente|tras|acima|abaixo|cima|baixo|cranial|caudal|superior|inferior|esquerda|direita';

/** Sinal do deslocamento no eixo do corte; 0 = a direção não vale neste plano. */
function directionSign(
  word: string,
  plane: PlaneName,
  lateralSign: number
): number {
  const table: Record<PlaneName, Record<string, number>> = {
    sagital: {
      esquerda: 1,
      direita: -1,
      lateral: lateralSign,
      medial: -lateralSign,
    },
    coronal: { posterior: 1, tras: 1, anterior: -1, frente: -1 },
    axial: {
      acima: 1,
      cima: 1,
      cranial: 1,
      superior: 1,
      abaixo: -1,
      baixo: -1,
      caudal: -1,
      inferior: -1,
    },
  };
  return table[plane][word] ?? 0;
}

const toMm = (value: string, unit: string) =>
  parseFloat(value.replace(',', '.')) * (unit.startsWith('c') ? 10 : 1);

/** Soma dos deslocamentos pedidos ("2 cm mais lateral", "um pouco acima"). */
function findShift(
  t: string,
  plane: PlaneName,
  lateralSign: number,
  notes: string[]
): number | null {
  let total = 0;
  let found = false;
  const apply = (amount: number, word: string) => {
    const sign = directionSign(word, plane, lateralSign);
    if (!sign) {
      notes.push(`"${word}" não se aplica a um corte ${plane}.`);
      return;
    }
    total += sign * amount;
    found = true;
  };
  const numeric = new RegExp(
    `(\\d+(?:[.,]\\d+)?)\\s*(cm|mm|centimetros?|milimetros?)\\s+(?:mais\\s+)?(?:para\\s+(?:a|o)\\s+|a\\s+|para\\s+)?(${DIRECTIONS})\\b`,
    'g'
  );
  let rest = t;
  [...t.matchAll(numeric)].forEach((m) => {
    apply(toMm(m[1], m[2]), m[3]);
    rest = rest.replace(m[0], ' ');
  });
  const vague = new RegExp(
    `(um pouco |pouco |bem )?mais\\s+(?:para\\s+(?:a|o)\\s+|a\\s+|para\\s+)?(${DIRECTIONS})\\b`,
    'g'
  );
  [...rest.matchAll(vague)].forEach((m) => {
    const amount =
      { 'um pouco ': 5, 'pouco ': 5, 'bem ': 30 }[m[1] ?? ''] ?? 10;
    apply(amount, m[2]);
  });
  return found ? total : null;
}

function findProjection(t: string): Recipe['projecao'] | null {
  if (/\bminip\b|minima intensidade/.test(t)) return 'minip';
  if (/\bmip\b|maxima intensidade/.test(t)) return 'mip';
  if (/corte fino|(?<!mais )\bfin[oa]\b/.test(t)) return 'fina';
  // "média" como projeção, não a "linha média" nem a "axilar média"
  if (
    /fatia espessa|\bespess[oa]\b|\bslab\b|projecao media|(?<!linha |axilar )\bmedia de\b/.test(
      t
    )
  )
    return 'media';
  return null;
}

function findThickness(t: string): number | null {
  const hit =
    t.match(
      /(?:espessura|mip|minip|fatia|espess[oa]|media)\D{0,14}?(\d+(?:[.,]\d+)?)\s*(mm|cm)\b/
    ) ?? t.match(/(\d+(?:[.,]\d+)?)\s*(mm|cm)\s+de\s+espessura/);
  return hit ? toMm(hit[1], hit[2]) : null;
}

const WINDOW_WORDS: Array<[RegExp, WindowName]> = [
  [/pulmao|pulmonar|parenquima/, 'pulmao'],
  [/mediast/, 'mediastino'],
  [/partes moles/, 'partes-moles'],
  [/oss[oe]|ossea/, 'osso'],
  [/abdom/, 'abdome'],
  [/angio|vascular/, 'angio'],
  [/cerebr|encefal/, 'cerebro'],
];

/** Janela pedida com todas as letras ("janela de pulmão"). */
function explicitWindow(t: string): WindowName | null {
  const hit = t.match(/janela\s+(?:de\s+|do\s+|da\s+|para\s+)?([a-z ]{3,14})/);
  if (!hit) return null;
  return WINDOW_WORDS.find(([word]) => word.test(hit[1]))?.[1] ?? null;
}

/** Janela sugerida pelo que se quer mostrar, na ordem de prioridade. */
function hintedWindow(t: string): WindowName | null {
  // "ápice pulmonar" e "base pulmonar" são posições, não pedem janela de pulmão
  const text = t.replace(
    /(apice|bases?) (pulmonar|do pulmao|dos pulmoes)/g,
    ' '
  );
  const hints: Array<[RegExp, WindowName]> = [
    [/hernia|abdom|partes moles|parede|musculo/, 'partes-moles'],
    [/aorta|arteria|vasos?\b|vascular|angio|coronar/, 'angio'],
    [/mediast|coracao|cardiac/, 'mediastino'],
    [/pulmao|pulmoes|pulmonar|parenquima|enfisema|nodulo/, 'pulmao'],
    [/oss[oe]s?\b|ossea|fratura|costela|coluna|esterno/, 'osso'],
    [/cerebr|encefal|cranio/, 'cerebro'],
    [/torax|toracic/, 'mediastino'],
  ];
  return hints.find(([word]) => word.test(text))?.[1] ?? null;
}

function findField(t: string): Recipe['campo'] | null {
  if (
    /corpo (todo|inteiro)|campo (todo|inteiro|completo)|mostra(r)? tudo/.test(t)
  )
    return 'tudo';
  const only = t.match(
    /(?:so|apenas|somente)\s+(?:o\s+|a\s+)?(torax|abdome|abdomen)/
  );
  if (only) return only[1] === 'torax' ? 'torax' : 'abdome';
  return null;
}

const BACKGROUNDS: Record<string, string> = {
  branco: '#ffffff',
  preto: '#000000',
  cinza: '#5a5f66',
};

/** O pedido em andamento: texto normalizado, receita e o que já se entendeu. */
interface Draft {
  t: string;
  recipe: Recipe;
  /** o pedido começa uma imagem nova (não é ajuste da atual) */
  fresh: boolean;
  understood: boolean;
  notes: string[];
}

/** Plano do pedido: o dito; senão o da referência, se ela não couber no atual. */
function resolvePlane(
  t: string,
  current: Recipe | null,
  ref: ReferenceHit | null
) {
  const stated = PLANE_WORDS.find(([word]) => word.test(t))?.[1] ?? null;
  if (stated) return { plano: stated, stated: true };
  const plano = current?.plano ?? defaultRecipe().plano;
  const fits = ref && current && REFERENCES_OF[plano].includes(ref.reference);
  return { plano: ref && !fits ? ref.plane : plano, stated: false };
}

function applyReference(draft: Draft, ref: ReferenceHit | null) {
  if (!ref) return;
  const { recipe } = draft;
  draft.understood = true;
  recipe.deslocamento = 0;
  if (REFERENCES_OF[recipe.plano].includes(ref.reference)) {
    recipe.referencia = ref.reference;
    if (ref.note) draft.notes.push(ref.note);
    return;
  }
  recipe.referencia = 'centro';
  draft.notes.push(
    `A referência pedida não se aplica a um corte ${recipe.plano}: usei o centro.`
  );
}

function applyShift(draft: Draft, lateralSign: number) {
  const { recipe } = draft;
  let side = lateralSign;
  if (recipe.referencia.endsWith('esquerda')) side = 1;
  if (recipe.referencia.endsWith('direita')) side = -1;
  const shift = findShift(draft.t, recipe.plano, side, draft.notes);
  if (shift === null) return;
  recipe.deslocamento += shift;
  draft.understood = true;
}

const clampThickness = (value: number) =>
  Math.min(THICKNESS_LIMITS[1], Math.max(THICKNESS_LIMITS[0], value));

/** "mais espesso" dobra a fatia (ou abre uma de 10 mm); "mais fino" a divide. */
function relativeThickness(t: string, recipe: Recipe): number | null {
  if (/mais espess|engross/.test(t))
    return recipe.projecao === 'fina' ? 10 : recipe.espessura * 2;
  if (/mais fin|afin/.test(t) && recipe.projecao !== 'fina')
    return recipe.espessura / 2;
  return null;
}

function applyProjection(draft: Draft) {
  const { t, recipe } = draft;
  const thickness = findThickness(t) ?? relativeThickness(t, recipe);
  const projection = findProjection(t);
  if (projection) recipe.projecao = projection;
  if (thickness !== null) {
    recipe.espessura = clampThickness(thickness);
    // só a espessura, num corte fino: vira fatia espessa em média
    if (recipe.projecao === 'fina' && projection !== 'fina')
      recipe.projecao = 'media';
  }
  if (projection || thickness !== null) draft.understood = true;
}

function applyLook(draft: Draft) {
  const { t, recipe } = draft;
  const window = explicitWindow(t) ?? (draft.fresh ? hintedWindow(t) : null);
  const field = findField(t);
  const background = t.match(/fundo\s+(branco|preto|cinza)/);
  if (window) recipe.janela = window;
  if (field) recipe.campo = field;
  if (background) recipe.fundo = BACKGROUNDS[background[1]];
  if (window || field || background) draft.understood = true;
}

/**
 * Transforma o pedido em receita. Com uma receita em uso e sem um plano novo
 * no texto, o pedido é um ajuste dela ("2 cm mais lateral", "MIP de 20 mm").
 * `lateralSign` diz para que lado fica "lateral" no corte sagital atual
 * (+1 = esquerda do paciente).
 */
export function interpret(
  text: string,
  current: Recipe | null,
  lateralSign = 1
): Interpretation {
  const t = normalize(text);
  const ref = findReference(t);
  const { plano, stated } = resolvePlane(t, current, ref);
  const fresh = !current || plano !== current.plano;
  const draft: Draft = {
    t,
    fresh,
    recipe: fresh
      ? {
          ...defaultRecipe(),
          plano,
          fundo: current?.fundo ?? defaultRecipe().fundo,
        }
      : { ...current },
    understood: stated,
    notes: [],
  };

  applyReference(draft, ref);
  applyShift(draft, lateralSign);
  applyProjection(draft);
  applyLook(draft);

  if (!draft.understood)
    draft.notes.push(
      'Não entendi o pedido. Diga o plano e onde cortar, por exemplo: "sagital na linha hemiclavicular esquerda, janela de partes moles".'
    );
  return {
    recipe: draft.recipe,
    understood: draft.understood,
    notes: draft.notes,
  };
}

/** Para que lado fica "lateral" num corte sagital, dada a posição dele. */
export const lateralSignOf = (position: number, midlineX: number) =>
  position >= midlineX ? 1 : -1;
