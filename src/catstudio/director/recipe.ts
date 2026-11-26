/**
 * CatStudio — diretor de arte: a "receita" de uma imagem. É o que o pedido em
 * texto vira (pelo interpretador local ou pela IA) e o que o renderizador
 * executa. Só descreve O QUE mostrar; não carrega nenhum dado do exame.
 */
import {
  HEMICLAVICULAR_RATIO,
  PARASTERNAL_MM,
  type Landmarks,
} from '@/src/catstudio/director/landmarks';

export const PLANES = ['axial', 'coronal', 'sagital'] as const;
export type PlaneName = (typeof PLANES)[number];

export const REFERENCES = [
  'centro',
  'linha-media',
  'hemiclavicular-esquerda',
  'hemiclavicular-direita',
  'paraesternal-esquerda',
  'paraesternal-direita',
  'axilar-media',
  'apice-pulmonar',
  'base-pulmonar',
  'ponto',
] as const;
export type Reference = (typeof REFERENCES)[number];

/** Quais referências fazem sentido em cada plano. */
export const REFERENCES_OF: Record<PlaneName, readonly Reference[]> = {
  sagital: [
    'centro',
    'linha-media',
    'hemiclavicular-esquerda',
    'hemiclavicular-direita',
    'paraesternal-esquerda',
    'paraesternal-direita',
    'ponto',
  ],
  coronal: ['centro', 'axilar-media', 'ponto'],
  axial: ['centro', 'apice-pulmonar', 'base-pulmonar', 'ponto'],
};

export const PROJECTIONS = ['fina', 'mip', 'minip', 'media', '3d'] as const;
export type Projection = (typeof PROJECTIONS)[number];

/** Eixos dos cortes: os do paciente (endireitado) ou os do tomógrafo. */
export const ALIGNMENTS = ['paciente', 'aparelho'] as const;
export type Alignment = (typeof ALIGNMENTS)[number];

/** O que a reconstrução 3D mostra sozinho (o resto fica transparente). */
export const ISOLATIONS = ['nada', 'pulmoes'] as const;
export type Isolation = (typeof ISOLATIONS)[number];

export const FIELDS = ['tudo', 'torax', 'abdome'] as const;
export type Field = (typeof FIELDS)[number];

/** Janelas de TC: [largura, nível]. */
export const WINDOWS = {
  'partes-moles': [400, 50],
  mediastino: [350, 40],
  pulmao: [1500, -600],
  osso: [1800, 400],
  abdome: [400, 40],
  angio: [800, 200],
  cerebro: [80, 40],
} as const;
export type WindowName = keyof typeof WINDOWS;

export const WINDOW_LABEL: Record<WindowName, string> = {
  'partes-moles': 'partes moles',
  mediastino: 'mediastino',
  pulmao: 'pulmão',
  osso: 'osso',
  abdome: 'abdome',
  angio: 'angio',
  cerebro: 'cérebro',
};

export interface Recipe {
  plano: PlaneName;
  referencia: Reference;
  /**
   * Deslocamento a partir da referência, em mm, no sentido do eixo do
   * paciente: sagital, + para a esquerda; coronal, + para trás; axial, +
   * para cima.
   */
  deslocamento: number;
  /** Com referência "ponto": posição no eixo do corte, em mm (LPS). */
  ponto: number;
  projecao: Projection;
  /**
   * Espessura da fatia, em mm (ignorada no corte fino). Na reconstrução 3D é
   * a profundidade: até onde se vê para dentro do plano.
   */
  espessura: number;
  janela: WindowName;
  campo: Field;
  /** Cor em volta da imagem, #rrggbb. */
  fundo: string;
  titulo: string;
  alinhamento: Alignment;
  isolar: Isolation;
}

export const THICKNESS_LIMITS = [1, 300] as const;
/** Profundidade inicial da reconstrução 3D, em mm. */
export const DEFAULT_DEPTH = 160;
/** Espessura inicial de uma fatia espessa, em mm. */
export const DEFAULT_THICKNESS = 10;

export const defaultRecipe = (): Recipe => ({
  plano: 'axial',
  referencia: 'centro',
  deslocamento: 0,
  ponto: 0,
  projecao: 'fina',
  espessura: DEFAULT_THICKNESS,
  janela: 'partes-moles',
  campo: 'tudo',
  fundo: '#000000',
  titulo: '',
  alinhamento: 'paciente',
  isolar: 'nada',
});

const oneOf = <T extends string>(
  value: unknown,
  options: readonly T[],
  fallback: T
): T => (options.includes(value as T) ? (value as T) : fallback);

const numberIn = (
  value: unknown,
  min: number,
  max: number,
  fallback: number
) =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;

/**
 * Confere uma receita vinda de fora (IA, armazenamento): o que faltar ou vier
 * fora do combinado volta ao padrão. Nunca lança erro.
 */
export function sanitizeRecipe(raw: unknown, base = defaultRecipe()): Recipe {
  if (!raw || typeof raw !== 'object') return { ...base };
  const r = raw as Record<string, unknown>;
  const plano = oneOf(r.plano, PLANES, base.plano);
  const wanted = oneOf(r.referencia, REFERENCES, base.referencia);
  return {
    plano,
    // referência que não existe neste plano (ex.: hemiclavicular num axial)
    referencia: REFERENCES_OF[plano].includes(wanted) ? wanted : 'centro',
    deslocamento: numberIn(r.deslocamento, -500, 500, base.deslocamento),
    ponto: numberIn(r.ponto, -5000, 5000, base.ponto),
    projecao: oneOf(r.projecao, PROJECTIONS, base.projecao),
    espessura: numberIn(r.espessura, ...THICKNESS_LIMITS, base.espessura),
    janela: oneOf(r.janela, Object.keys(WINDOWS) as WindowName[], base.janela),
    campo: oneOf(r.campo, FIELDS, base.campo),
    fundo:
      typeof r.fundo === 'string' && /^#[0-9a-f]{6}$/i.test(r.fundo)
        ? r.fundo.toLowerCase()
        : base.fundo,
    titulo: typeof r.titulo === 'string' ? r.titulo.slice(0, 120) : base.titulo,
    alinhamento: oneOf(r.alinhamento, ALIGNMENTS, base.alinhamento),
    isolar: oneOf(r.isolar, ISOLATIONS, base.isolar),
  };
}

/** Eixo do paciente perpendicular ao plano: 0 = x, 1 = y, 2 = z. */
export const NORMAL_AXIS: Record<PlaneName, 0 | 1 | 2> = {
  sagital: 0,
  coronal: 1,
  axial: 2,
};

/** Posição da referência no eixo do corte, em mm, antes do deslocamento. */
export function referencePosition(recipe: Recipe, lm: Landmarks): number {
  switch (recipe.referencia) {
    case 'ponto':
      return recipe.ponto;
    case 'hemiclavicular-esquerda':
      return lm.midlineX + HEMICLAVICULAR_RATIO * lm.halfWidthLeft;
    case 'hemiclavicular-direita':
      return lm.midlineX - HEMICLAVICULAR_RATIO * lm.halfWidthRight;
    case 'paraesternal-esquerda':
      return lm.midlineX + PARASTERNAL_MM;
    case 'paraesternal-direita':
      return lm.midlineX - PARASTERNAL_MM;
    case 'apice-pulmonar':
      return lm.apexZ;
    case 'base-pulmonar':
      return lm.baseZ;
    case 'axilar-media':
      return lm.midCoronalY;
    case 'linha-media':
      return lm.midlineX;
    default:
      return [lm.midlineX, lm.midCoronalY, lm.center[2]][
        NORMAL_AXIS[recipe.plano]
      ];
  }
}

/** Posição final do corte, mantida dentro do corpo. */
export function cutPosition(recipe: Recipe, lm: Landmarks): number {
  const axis = NORMAL_AXIS[recipe.plano];
  const wanted = referencePosition(recipe, lm) + recipe.deslocamento;
  return Math.min(lm.body[1][axis], Math.max(lm.body[0][axis], wanted));
}

const REFERENCE_LABEL: Record<Reference, string> = {
  centro: 'no centro',
  'linha-media': 'na linha média',
  'hemiclavicular-esquerda': 'na linha hemiclavicular esquerda',
  'hemiclavicular-direita': 'na linha hemiclavicular direita',
  'paraesternal-esquerda': 'na linha paraesternal esquerda',
  'paraesternal-direita': 'na linha paraesternal direita',
  'axilar-media': 'na linha axilar média',
  'apice-pulmonar': 'no ápice pulmonar',
  'base-pulmonar': 'na base pulmonar',
  ponto: 'no ponto marcado',
};

/** As referências de superfície são estimadas, não medidas. */
export const isEstimated = (reference: Reference) =>
  reference.startsWith('hemiclavicular') ||
  reference.startsWith('paraesternal');

const mm = (value: number) => `${Math.round(Math.abs(value))} mm`;

const SHIFT_WORDS: Record<PlaneName, [string, string]> = {
  sagital: ['para a esquerda', 'para a direita'],
  coronal: ['para trás', 'para a frente'],
  axial: ['acima', 'abaixo'],
};

const STYLE_BY_WINDOW: Partial<Record<WindowName, string>> = {
  osso: 'só osso',
  angio: 'vasos em destaque',
};

/** Projeção e janela (ou, no 3D, profundidade e estilo de cor), em palavras. */
function lookParts(recipe: Recipe): string[] {
  if (recipe.projecao === '3d' && recipe.isolar === 'pulmoes')
    return ['reconstrução 3D só dos pulmões, inteiros, vistos de fora'];
  if (recipe.projecao === '3d')
    return [
      `reconstrução 3D recortada no plano, ${mm(recipe.espessura)} de profundidade`,
      `cores: ${STYLE_BY_WINDOW[recipe.janela] ?? 'tecidos'}`,
    ];
  const projection =
    recipe.projecao === 'fina'
      ? 'corte fino'
      : `${{ mip: 'MIP', minip: 'MinIP', media: 'média' }[recipe.projecao]} de ${mm(recipe.espessura)}`;
  return [projection, `janela de ${WINDOW_LABEL[recipe.janela]}`];
}

/** O que o diretor entendeu, em uma linha, para o usuário conferir. */
export function describeRecipe(recipe: Recipe, lm?: Landmarks): string {
  const parts = [`Corte ${recipe.plano} ${REFERENCE_LABEL[recipe.referencia]}`];
  if (isEstimated(recipe.referencia)) {
    const distance = lm
      ? `, a ${mm(referencePosition(recipe, lm) - lm.midlineX)} da linha média`
      : '';
    parts[0] += ` (estimada${distance})`;
  }
  if (Math.abs(recipe.deslocamento) >= 0.5) {
    const [plus, minus] = SHIFT_WORDS[recipe.plano];
    parts.push(
      `${mm(recipe.deslocamento)} ${recipe.deslocamento > 0 ? plus : minus}`
    );
  }
  parts.push(...lookParts(recipe));
  if (recipe.campo !== 'tudo')
    parts.push(recipe.campo === 'torax' ? 'só o tórax' : 'só o abdome');
  if (recipe.alinhamento === 'aparelho') parts.push('eixos do aparelho');
  return parts.join(' · ');
}
