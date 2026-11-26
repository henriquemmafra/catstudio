/**
 * CatStudio — diretor de arte: a "fita" de cortes vizinhos.
 *
 * Desenhar um corte (sobretudo em 3D) leva de décimos a alguns segundos.
 * Para andar pelo exame sem esperar a cada clique, os cortes vizinhos ao
 * atual (de 5 em 5 mm, do mais perto ao mais longe) são desenhados de antemão
 * enquanto a pessoa olha, e guardados. Andar com o controle deslizante, a
 * roda do mouse ou as setas mostra o que já está pronto na hora.
 */
import type { CutJob } from './cut';
import type { Recipe } from './recipe';

/** Distância entre cortes vizinhos, em mm. */
export const STRIP_STEP = 5;
/** Até onde se desenha de antemão, para cada lado, em mm. */
export const STRIP_REACH = 100;
/** Memória máxima dos cortes guardados. */
export const CACHE_BYTES = 160 * 1024 * 1024;

/** O que define a imagem, menos a posição: cortes da mesma fita. */
export function stripKey(recipe: Recipe): string {
  return JSON.stringify({ ...recipe, deslocamento: 0, titulo: '' });
}

/** Posição na fita: o deslocamento arredondado para o décimo de mm. */
export const offsetKey = (shift: number) => Math.round(shift * 10) / 10;

/**
 * Deslocamentos a desenhar de antemão, do mais perto ao mais longe do atual,
 * dentro de [min, max] (os limites do corpo, em deslocamento).
 */
export function stripOffsets(
  current: number,
  limits: [number, number],
  reach = STRIP_REACH,
  step = STRIP_STEP
): number[] {
  const out: number[] = [];
  for (let n = 1; n * step <= reach; n++)
    [current + n * step, current - n * step].forEach((at) => {
      if (at >= limits[0] - 1e-6 && at <= limits[1] + 1e-6)
        out.push(offsetKey(at));
    });
  return out;
}

export const jobBytes = (job: Pick<CutJob, 'image'>) =>
  job.image.values.byteLength + (job.image.rgba?.byteLength ?? 0);

interface Entry {
  key: string;
  offset: number;
  job: CutJob;
  /** desenho reduzido, só para mostrar enquanto o completo não fica pronto */
  preview: boolean;
}

/**
 * Cortes já desenhados. Quando passa do limite de memória, saem primeiro os
 * de outras fitas e depois os mais longe da posição atual.
 */
export class FrameCache {
  private entries = new Map<string, Entry>();

  private bytes = 0;

  constructor(private limit = CACHE_BYTES) {}

  private static id(key: string, offset: number, preview: boolean) {
    return `${preview ? 'p' : 'f'}|${offsetKey(offset)}|${key}`;
  }

  get(recipe: Recipe, preview = false): CutJob | null {
    const id = FrameCache.id(stripKey(recipe), recipe.deslocamento, preview);
    return this.entries.get(id)?.job ?? null;
  }

  has(recipe: Recipe) {
    return this.get(recipe) !== null;
  }

  put(recipe: Recipe, job: CutJob, preview = false) {
    const key = stripKey(recipe);
    const offset = offsetKey(recipe.deslocamento);
    const id = FrameCache.id(key, offset, preview);
    const old = this.entries.get(id);
    if (old) this.bytes -= jobBytes(old.job);
    this.entries.set(id, { key, offset, job, preview });
    this.bytes += jobBytes(job);
    // o completo substitui o reduzido
    if (!preview) this.drop(FrameCache.id(key, offset, true));
    this.evict(recipe);
  }

  private drop(id: string) {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.bytes -= jobBytes(entry.job);
    this.entries.delete(id);
  }

  /** Libera memória, poupando o que está perto de `current`. */
  evict(current: Recipe) {
    if (this.bytes <= this.limit) return;
    const key = stripKey(current);
    const here = current.deslocamento;
    const cost = (entry: Entry) =>
      entry.key === key ? Math.abs(entry.offset - here) : Infinity;
    const order = [...this.entries.entries()].sort(
      (a, b) => cost(b[1]) - cost(a[1])
    );
    for (const [id] of order) {
      if (this.bytes <= this.limit) break;
      this.drop(id);
    }
  }

  /** Quantos cortes da fita atual estão prontos (completos). */
  readyIn(current: Recipe, offsets: number[]): number {
    const key = stripKey(current);
    return offsets.filter((offset) =>
      this.entries.has(FrameCache.id(key, offset, false))
    ).length;
  }

  clear() {
    this.entries.clear();
    this.bytes = 0;
  }

  get size() {
    return this.entries.size;
  }

  get usedBytes() {
    return this.bytes;
  }
}
