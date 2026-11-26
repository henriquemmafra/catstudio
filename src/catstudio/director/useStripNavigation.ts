/**
 * CatStudio — diretor de arte: andar pela fita de cortes (controle
 * deslizante, botões de 5 mm, roda do mouse, setas). Andar não entra no
 * "desfazer": só os pedidos entram.
 */
import { computed, type Ref } from 'vue';
import type { Recipe } from './recipe';
import { STRIP_STEP } from './strip';

export interface NavigationOptions {
  recipe: Ref<Recipe | null>;
  /** perguntando à IA ou lendo o exame: não anda */
  blocked: () => boolean;
  limits: (recipe: Recipe) => [number, number] | null;
  render: () => void;
}

const NUDGE_LABELS = {
  sagital: ['direita', 'esquerda'],
  coronal: ['frente', 'trás'],
  axial: ['abaixo', 'acima'],
} as const;

export function useStripNavigation(options: NavigationOptions) {
  const { recipe } = options;

  /** Faixa do controle de posição, em deslocamento (mm). */
  const position = computed(() => {
    const target = recipe.value;
    const limits = target ? options.limits(target) : null;
    if (!target || !limits || target.isolar === 'pulmoes') return null;
    return { min: limits[0], max: limits[1], value: target.deslocamento };
  });

  function moveTo(shift: number) {
    const target = recipe.value;
    const range = position.value;
    if (!target || !range || options.blocked()) return;
    const next = Math.min(range.max, Math.max(range.min, shift));
    if (Math.abs(next - target.deslocamento) < 0.05) return;
    recipe.value = { ...target, deslocamento: next };
    options.render();
  }

  function nudge(mm: number) {
    if (recipe.value) moveTo(recipe.value.deslocamento + mm);
  }

  /** Roda do mouse no corte: um passo da fita por clique da roda. */
  function onWheel(event: WheelEvent) {
    if (!recipe.value || !event.deltaY) return;
    event.preventDefault();
    const down = event.deltaY > 0 ? 1 : -1;
    // no axial, rodar para baixo desce (caudal), como nas estações de laudo
    const sign = recipe.value.plano === 'axial' ? -down : down;
    nudge(sign * STRIP_STEP);
  }

  function onKey(event: KeyboardEvent) {
    const target = event.target as HTMLElement | null;
    if (target?.closest('textarea, input')) return;
    if (event.key === 'ArrowRight') nudge(STRIP_STEP);
    else if (event.key === 'ArrowLeft') nudge(-STRIP_STEP);
    else return;
    event.preventDefault();
  }

  const nudgeLabels = computed(
    () => NUDGE_LABELS[recipe.value?.plano ?? 'axial']
  );

  return { position, moveTo, nudge, onWheel, onKey, nudgeLabels };
}
