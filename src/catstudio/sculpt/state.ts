/**
 * CatStudio — escultura do 3D: a máscara de cada exame e o desfazer.
 *
 * Fica fora dos componentes de propósito: a máscara sobrevive à troca de
 * layout e à recriação das vistas.
 */
import { reactive } from 'vue';
import { type Dims, packMask, unpackMask, voxelCount } from './mask';

export const UNDO_LEVELS = 12;

export interface Sculpt {
  dims: Dims;
  hidden: Uint8Array;
  /** máscaras anteriores, em bits */
  undo: Uint8Array[];
  /** quantos voxels estão escondidos */
  count: number;
}

const sculpts = new Map<string, Sculpt>();

/** Muda a cada edição; as vistas 3D reagem a este número. */
export const sculptVersions = reactive<Record<string, number>>({});

const bump = (imageID: string) => {
  sculptVersions[imageID] = (sculptVersions[imageID] ?? 0) + 1;
};

const sameDims = (a: Dims, b: Dims) =>
  a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

/** A máscara do exame, se servir para um volume deste tamanho. */
export function sculptOf(imageID: string, dims: Dims): Sculpt | null {
  const sculpt = sculpts.get(imageID);
  return sculpt && sameDims(sculpt.dims, dims) ? sculpt : null;
}

function ensure(imageID: string, dims: Dims): Sculpt {
  const existing = sculptOf(imageID, dims);
  if (existing) return existing;
  // volume de outro tamanho (mudou a qualidade do 3D): começa de novo
  const sculpt: Sculpt = {
    dims: [dims[0], dims[1], dims[2]],
    hidden: new Uint8Array(voxelCount(dims)),
    undo: [],
    count: 0,
  };
  sculpts.set(imageID, sculpt);
  return sculpt;
}

function countHidden(hidden: Uint8Array) {
  let total = 0;
  for (let i = 0; i < hidden.length; i++) total += hidden[i];
  return total;
}

/**
 * Aplica uma edição à máscara. `edit` devolve quantos voxels mudou; se for
 * zero, nada é guardado no desfazer.
 */
export function editSculpt(
  imageID: string,
  dims: Dims,
  edit: (hidden: Uint8Array) => number
): number {
  const sculpt = ensure(imageID, dims);
  const before = packMask(sculpt.hidden);
  const changed = edit(sculpt.hidden);
  if (!changed) return 0;
  sculpt.undo.push(before);
  if (sculpt.undo.length > UNDO_LEVELS) sculpt.undo.shift();
  sculpt.count = countHidden(sculpt.hidden);
  bump(imageID);
  return changed;
}

export function undoSculpt(imageID: string): boolean {
  const sculpt = sculpts.get(imageID);
  const previous = sculpt?.undo.pop();
  if (!sculpt || !previous) return false;
  unpackMask(previous, sculpt.hidden);
  sculpt.count = countHidden(sculpt.hidden);
  bump(imageID);
  return true;
}

/** Volta o exame inteiro (dá para desfazer). */
export function resetSculpt(imageID: string): boolean {
  const sculpt = sculpts.get(imageID);
  if (!sculpt?.count) return false;
  editSculpt(imageID, sculpt.dims, (hidden) => {
    hidden.fill(0);
    return 1;
  });
  return true;
}

export interface SculptSummary {
  hiddenVoxels: number;
  undoLevels: number;
}

/** Resumo reativo para a interface. */
export function sculptSummary(imageID: string | null): SculptSummary {
  // a leitura da versão é o que torna o resumo reativo
  const version = imageID ? sculptVersions[imageID] : undefined;
  const sculpt = imageID && version !== undefined ? sculpts.get(imageID) : null;
  return {
    hiddenVoxels: sculpt?.count ?? 0,
    undoLevels: sculpt?.undo.length ?? 0,
  };
}

/** Esquece a escultura (ao fechar o exame). */
export function forgetSculpts() {
  [...sculpts.keys()].forEach((imageID) => {
    sculpts.delete(imageID);
    delete sculptVersions[imageID];
  });
}
