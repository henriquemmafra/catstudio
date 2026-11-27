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

export interface SculptTool {
  mode: SculptMode;
  icon: string;
  title: string;
  hint: string;
}

export const SCULPT_TOOLS: SculptTool[] = [
  {
    mode: 'brush-remove',
    icon: 'mdi-brush',
    title: 'Borracha',
    hint: 'Passe com o botão esquerdo apertado: a borracha apaga a superfície por onde passa. Passe de novo para ir mais fundo.',
  },
  {
    mode: 'lasso-remove',
    icon: 'mdi-lasso',
    title: 'Laço: apagar',
    hint: 'Contorne com o botão esquerdo o que quer apagar.',
  },
  {
    mode: 'lasso-keep',
    icon: 'mdi-selection-ellipse',
    title: 'Laço: manter',
    hint: 'Contorne o que quer manter; o resto some.',
  },
  {
    mode: 'pick-remove',
    icon: 'mdi-cursor-default-click-outline',
    title: 'Clique: apagar',
    hint: 'Clique numa estrutura (osso, mesa, cabo) para apagá-la inteira. Arrastar continua girando.',
  },
  {
    mode: 'pick-keep',
    icon: 'mdi-target',
    title: 'Clique: manter',
    hint: 'Clique na estrutura que deve ficar; o resto some. Arrastar continua girando.',
  },
  {
    mode: 'grow-keep',
    icon: 'mdi-source-branch',
    title: 'Crescer: manter',
    hint: 'Aperte e segure em cima do vaso: a seleção cresce ao longo dele e o resto some. Solte para parar.',
  },
  {
    mode: 'grow-highlight',
    icon: 'mdi-marker',
    title: 'Crescer: destacar',
    hint: 'Aperte e segure em cima do vaso ou órgão: ele vai sendo pintado na cor de destaque e o resto fica translúcido. Solte para parar; repita para somar outros.',
  },
  {
    mode: 'grow-remove',
    icon: 'mdi-eraser',
    title: 'Crescer: apagar',
    hint: 'Aperte e segure: o que cresce a partir do ponto vai sendo apagado. Solte para parar.',
  },
];

export const BONE_PICK_HINT =
  'Clique numa estrutura para dizer que é osso, ou que não é. Arrastar continua girando.';

export const hintFor = (mode: SculptMode | null): string => {
  if (mode === 'pick-bone') return BONE_PICK_HINT;
  return SCULPT_TOOLS.find((tool) => tool.mode === mode)?.hint ?? '';
};
