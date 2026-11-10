/**
 * CatStudio — marcação de volumes carregados sob demanda (sem dependência das
 * stores, para poder ser importado por elas). Ver memory.ts.
 */
import { reactive } from 'vue';

interface LazyImage {
  catstudioLazy: boolean;
  startLoad(): void;
  unloadData(): void;
}

export function isLazyImage(image: unknown): image is LazyImage {
  const img = image as Partial<LazyImage> | null | undefined;
  return (
    !!img && img.catstudioLazy === true && typeof img.unloadData === 'function'
  );
}

/**
 * Ligado por useMemoryPolicy (App.vue). Sem a política ativa (ex.: testes
 * unitários), os volumes carregam logo ao entrar no cache, como no VolView.
 */
export const memoryPolicy = { active: false };

/** Volumes que alguém está esperando carregar (ex.: camada sendo montada). */
export const pinned = reactive(new Map<string, number>());

export function pinImage(id: string) {
  pinned.set(id, (pinned.get(id) ?? 0) + 1);
}

export function unpinImage(id: string) {
  const n = (pinned.get(id) ?? 0) - 1;
  if (n > 0) pinned.set(id, n);
  else pinned.delete(id);
}
