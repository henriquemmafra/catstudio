/**
 * CatStudio — diretor de arte: desenha o corte pedido e, depois dele, os
 * vizinhos (ver strip.ts), sempre aos poucos para a página não travar.
 *
 * Ordem de trabalho:
 *  1. o corte pedido, se ainda não está pronto (no 3D, antes um esboço em
 *     resolução menor, que aparece em poucos décimos de segundo);
 *  2. os vizinhos, do mais perto ao mais longe.
 * Um pedido novo interrompe o que estiver em andamento.
 */
import { computed, ref, type Ref } from 'vue';
import { newJob, renderRows, type CutJob } from './cut';
import type { Landmarks } from './landmarks';
import { NORMAL_AXIS, cutPosition, type Recipe } from './recipe';
import { FrameCache, offsetKey, stripOffsets } from './strip';
import type { WorldVolume } from './volume';

export interface Space {
  vol: WorldVolume;
  lm: Landmarks;
}

/** Lado maior do corte, em pixels do exame, antes da ampliação final. */
export const MAX_SIDE = 900;
/** A reconstrução 3D custa dezenas de amostras por pixel: imagem menor. */
export const MAX_SIDE_3D = 640;
/** Esboço do 3D enquanto o completo não fica pronto. */
export const PREVIEW_SIDE_3D = 220;
/** Tempo de cada fatia de trabalho antes de devolver a vez à página. */
const SLICE_MS = 30;

const sideOf = (recipe: Recipe) =>
  recipe.projecao === '3d' ? MAX_SIDE_3D : MAX_SIDE;

const pause = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve);
  });

/** Deslocamentos possíveis antes de o corte sair do corpo. */
export function shiftLimits(recipe: Recipe, lm: Landmarks): [number, number] {
  const axis = NORMAL_AXIS[recipe.plano];
  const at = cutPosition({ ...recipe, deslocamento: 0 }, lm);
  return [lm.body[0][axis] - at, lm.body[1][axis] - at].map((v) =>
    offsetKey(v)
  ) as [number, number];
}

export interface StripOptions {
  open: () => boolean;
  spaceOf: (recipe: Recipe) => Space | null;
  /** mostra um corte pronto (ou o esboço dele) */
  draw: (job: CutJob, recipe: Recipe, preview: boolean) => void;
}

export function useStrip(options: StripOptions) {
  const cache = new FrameCache();
  const wanted: Ref<Recipe | null> = ref(null);
  /** andamento do corte pedido; vazio quando ele já está na tela */
  const drawing = ref('');
  const ready = ref(0);
  const total = ref(0);
  let pumping = false;

  const neighbours = (recipe: Recipe) => {
    const space = options.spaceOf(recipe);
    // pulmões isolados mostram o órgão inteiro: a posição não muda a imagem
    if (!space || recipe.isolar === 'pulmoes') return [];
    return stripOffsets(recipe.deslocamento, shiftLimits(recipe, space.lm));
  };

  function countReady() {
    const target = wanted.value;
    const list = target ? neighbours(target) : [];
    total.value = list.length;
    ready.value = target ? cache.readyIn(target, list) : 0;
  }

  async function renderJob(
    recipe: Recipe,
    side: number,
    still: () => boolean,
    label?: (percent: number) => string
  ): Promise<CutJob | null> {
    const space = options.spaceOf(recipe);
    if (!space) return null;
    const job = newJob(space.vol, recipe, space.lm, side);
    const { height } = job.image;
    let row = 0;
    while (row < height) {
      const start = performance.now();
      while (row < height && performance.now() - start < SLICE_MS) {
        const next = Math.min(height, row + 4);
        renderRows(job, row, next);
        row = next;
      }
      if (label) drawing.value = label(Math.round((100 * row) / height));
      await pause();
      if (!still()) return null;
    }
    return job;
  }

  const isWanted = (recipe: Recipe) => () =>
    options.open() && wanted.value === recipe;

  /** O corte pedido: esboço (3D) e depois o completo. */
  async function renderWanted(target: Recipe) {
    const solid = target.projecao === '3d';
    if (solid && !cache.get(target, true)) {
      const sketch = await renderJob(
        target,
        PREVIEW_SIDE_3D,
        isWanted(target),
        () => 'Esboçando o 3D…'
      );
      if (!sketch) return;
      cache.put(target, sketch, true);
      if (wanted.value === target) options.draw(sketch, target, true);
    }
    const job = await renderJob(
      target,
      sideOf(target),
      isWanted(target),
      (percent) => (solid ? `Reconstruindo em 3D… ${percent}%` : 'Desenhando…')
    );
    if (!job) return;
    cache.put(target, job);
    if (wanted.value === target) {
      drawing.value = '';
      options.draw(job, target, false);
    }
  }

  /** O próximo vizinho a desenhar; null se a fita está completa. */
  async function prefetch(target: Recipe): Promise<boolean> {
    const next = neighbours(target).find(
      (shift) => !cache.has({ ...target, deslocamento: shift })
    );
    if (next === undefined) return false;
    const recipe = { ...target, deslocamento: next };
    const job = await renderJob(recipe, sideOf(recipe), isWanted(target));
    if (job) cache.put(recipe, job);
    countReady();
    return true;
  }

  async function pump() {
    if (pumping) return;
    pumping = true;
    try {
      while (options.open() && wanted.value) {
        const target = wanted.value;
        if (!cache.has(target)) await renderWanted(target);
        else if (!(await prefetch(target))) break;
      }
    } finally {
      pumping = false;
    }
  }

  /** Mostra o corte da receita: na hora, se já estiver pronto. */
  function show(recipe: Recipe) {
    wanted.value = recipe;
    const job = cache.get(recipe);
    const sketch = job ? null : cache.get(recipe, true);
    if (job) {
      drawing.value = '';
      options.draw(job, recipe, false);
    } else {
      drawing.value = 'Desenhando…';
      if (sketch) options.draw(sketch, recipe, true);
    }
    countReady();
    pump();
  }

  function reset() {
    wanted.value = null;
    drawing.value = '';
    cache.clear();
    countReady();
  }

  const stripText = computed(() =>
    total.value
      ? `Cortes vizinhos prontos: ${ready.value} de ${total.value}`
      : ''
  );

  return { show, reset, drawing, ready, total, stripText, cache };
}
