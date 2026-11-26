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

export interface Stroke {
  hidden: Uint8Array;
  /** avisa as vistas de que a máscara mudou */
  update(): void;
  /** desiste: volta a máscara de antes do gesto */
  cancel(): void;
}

/**
 * Abre uma edição que muda aos poucos (crescer enquanto o botão fica
 * apertado). O gesto inteiro vale um único nível de desfazer.
 */
export function beginStroke(imageID: string, dims: Dims): Stroke {
  const sculpt = ensure(imageID, dims);
  sculpt.undo.push(packMask(sculpt.hidden));
  if (sculpt.undo.length > UNDO_LEVELS) sculpt.undo.shift();
  const refresh = () => {
    sculpt.count = countHidden(sculpt.hidden);
    bump(imageID);
  };
  return {
    hidden: sculpt.hidden,
    update: refresh,
    cancel: () => {
      const before = sculpt.undo.pop();
      if (before) unpackMask(before, sculpt.hidden);
      refresh();
    },
  };
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

// ---------- osso ----------

interface Bone {
  dims: Dims;
  /** 0 = não é osso, 1 = osso, 2 = franja */
  label: Uint8Array;
}

const bones = new Map<string, Bone>();

export interface BoneView {
  /** voxels de osso (sem a franja); zero = nada detectado */
  voxels: number;
  /** 0 = escondido … 1 = como o resto */
  opacity: number;
}

/** Estado reativo do osso por exame, para a interface e para a vista. */
export const boneViews = reactive<Record<string, BoneView>>({});

export function boneOf(imageID: string, dims: Dims): Uint8Array | null {
  const bone = bones.get(imageID);
  return bone && sameDims(bone.dims, dims) ? bone.label : null;
}

export interface BoneUpdate {
  dims: Dims;
  label: Uint8Array;
  voxels: number;
}

export function setBone(imageID: string, update: BoneUpdate) {
  bones.set(imageID, {
    dims: [update.dims[0], update.dims[1], update.dims[2]],
    label: update.label,
  });
  boneViews[imageID] = {
    voxels: update.voxels,
    opacity: boneViews[imageID]?.opacity ?? 1,
  };
  bump(imageID);
}

export function clearBone(imageID: string) {
  bones.delete(imageID);
  delete boneViews[imageID];
  bump(imageID);
}

/** Como o osso entra no volume desenhado. */
export type BoneMode = 'none' | 'hide' | 'split';

export const boneModeFor = (opacity: number): BoneMode => {
  if (opacity >= 1) return 'none';
  return opacity <= 0 ? 'hide' : 'split';
};

export function setBoneOpacity(imageID: string, opacity: number) {
  const view = boneViews[imageID];
  if (!view) return;
  const next = Math.min(1, Math.max(0, opacity));
  const changesVolume = boneModeFor(next) !== boneModeFor(view.opacity);
  view.opacity = next;
  // entre 1% e 99% só muda um peso na placa; o volume não é refeito
  if (changesVolume) bump(imageID);
}

/** Esquece a escultura (ao fechar o exame). */
export function forgetSculpts() {
  [...sculpts.keys(), ...bones.keys()].forEach((imageID) => {
    sculpts.delete(imageID);
    bones.delete(imageID);
    delete boneViews[imageID];
    delete sculptVersions[imageID];
  });
}
