/**
 * CatStudio — escultura do 3D: as ferramentas do painel.
 */
export type SculptMode =
  | 'lasso-remove'
  | 'lasso-keep'
  | 'pick-remove'
  | 'pick-keep'
  | 'grow-remove'
  | 'grow-keep'
  | 'grow-highlight'
  | 'pick-bone'
  | 'brush-remove';

/** Como o gesto funciona: contornar, clicar, segurar ou passar a borracha. */
export type Gesture = 'lasso' | 'pick' | 'grow' | 'brush';

export const gestureOf = (mode: SculptMode | null): Gesture | null =>
  mode ? (mode.split('-')[0] as Gesture) : null;

/** Em que grupo do painel a ferramenta aparece. */
export type ToolGroup = 'apagar' | 'manter' | 'destacar';

export interface SculptTool {
  mode: SculptMode;
  group: ToolGroup;
  icon: string;
  /** rótulo curto, embaixo do ícone */
  short: string;
  title: string;
  hint: string;
}

export const GROUP_TITLE: Record<ToolGroup, string> = {
  apagar: 'Apagar',
  manter: 'Manter só',
  destacar: 'Destacar',
};

export const SCULPT_TOOLS: SculptTool[] = [
  {
    mode: 'brush-remove',
    group: 'apagar',
    icon: 'mdi-brush',
    short: 'Borracha',
    title: 'Borracha',
    hint: 'Passe com o botão esquerdo apertado: a borracha apaga a superfície por onde passa. Passe de novo para ir mais fundo.',
  },
  {
    mode: 'lasso-remove',
    group: 'apagar',
    icon: 'mdi-lasso',
    short: 'Laço',
    title: 'Laço: apagar',
    hint: 'Contorne com o botão esquerdo o que quer apagar. O laço continua ligado; Esc ou outro clique no botão desliga.',
  },
  {
    mode: 'pick-remove',
    group: 'apagar',
    icon: 'mdi-cursor-default-click-outline',
    short: 'Clique',
    title: 'Clique: apagar',
    hint: 'Clique numa estrutura (osso, mesa, cabo) para apagá-la inteira. Arrastar continua girando.',
  },
  {
    mode: 'grow-remove',
    group: 'apagar',
    icon: 'mdi-source-branch-minus',
    short: 'Crescer',
    title: 'Crescer: apagar',
    hint: 'Aperte e segure: o que cresce a partir do ponto vai sendo apagado. Solte para parar.',
  },
  {
    mode: 'lasso-keep',
    group: 'manter',
    icon: 'mdi-selection-ellipse',
    short: 'Laço',
    title: 'Laço: manter',
    hint: 'Contorne o que quer manter; o resto some. O laço continua ligado; Esc desliga.',
  },
  {
    mode: 'pick-keep',
    group: 'manter',
    icon: 'mdi-target',
    short: 'Clique',
    title: 'Clique: manter',
    hint: 'Clique na estrutura que deve ficar; o resto some. Arrastar continua girando.',
  },
  {
    mode: 'grow-keep',
    group: 'manter',
    icon: 'mdi-source-branch',
    short: 'Crescer',
    title: 'Crescer: manter',
    hint: 'Aperte e segure em cima do vaso: a seleção cresce ao longo dele e o resto some. Solte para parar.',
  },
  {
    mode: 'grow-highlight',
    group: 'destacar',
    icon: 'mdi-marker',
    short: 'Crescer',
    title: 'Crescer: destacar',
    hint: 'Aperte e segure em cima do vaso ou órgão: ele vai sendo pintado na cor de destaque e o resto fica translúcido. Solte para parar; repita para somar outros.',
  },
];

export const toolsIn = (group: ToolGroup) =>
  SCULPT_TOOLS.filter((tool) => tool.group === group);

export const BONE_PICK_HINT =
  'Clique numa estrutura para dizer que é osso, ou que não é. Arrastar continua girando.';

export const hintFor = (mode: SculptMode | null): string => {
  if (mode === 'pick-bone') return BONE_PICK_HINT;
  return SCULPT_TOOLS.find((tool) => tool.mode === mode)?.hint ?? '';
};
