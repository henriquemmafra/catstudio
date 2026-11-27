/**
 * CatStudio — escultura do 3D: a máscara de cada exame e o desfazer.
 *
 * Fica fora dos componentes de propósito: a máscara sobrevive à troca de
 * layout e à recriação das vistas.
 */
import { reactive } from 'vue';
import { type Dims, packMask, unpackMask, voxelCount } from './mask';
import {
  LAYERS,
  type Layer,
  type LayerSet,
  allVisible,
  available,
  hiddenByLayers,
} from './layers';

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

// ---------- camadas ----------

interface LayerState {
  set: LayerSet;
  /** 1 = escondido por camada desligada; null = todas ligadas */
  hidden: Uint8Array | null;
}

const layerStates = new Map<string, LayerState>();

export interface LayerView {
  visible: Record<Layer, boolean>;
  available: Record<Layer, boolean>;
  /** voxels por camada */
  counts: Record<Layer, number>;
}

/** Estado reativo das camadas por exame, para os botões. */
export const layerViews = reactive<Record<string, LayerView>>({});

export function setLayers(imageID: string, set: LayerSet) {
  layerStates.set(imageID, { set, hidden: null });
  layerViews[imageID] = {
    visible: allVisible(),
    available: Object.fromEntries(
      LAYERS.map((layer) => [layer, available(set, layer)])
    ) as Record<Layer, boolean>,
    counts: { ...set.counts },
  };
  bump(imageID);
}

export function layersOf(imageID: string, dims: Dims): LayerState | null {
  const state = layerStates.get(imageID);
  return state && sameDims(state.set.dims, dims) ? state : null;
}

export function setLayerVisible(imageID: string, layer: Layer, on: boolean) {
  const state = layerStates.get(imageID);
  const view = layerViews[imageID];
  if (!state || !view || view.visible[layer] === on) return;
  view.visible[layer] = on;
  state.hidden = hiddenByLayers(state.set, view.visible);
  bump(imageID);
}

// ---------- destaque ----------

interface Highlight {
  dims: Dims;
  /** 1 = destacado */
  mask: Uint8Array;
}

const highlights = new Map<string, Highlight>();

export interface HighlightView {
  voxels: number;
  /** quanto do resto aparece, 0–1 */
  rest: number;
  /** #rrggbb */
  color: string;
}

export const highlightViews = reactive<Record<string, HighlightView>>({});

export const DEFAULT_HIGHLIGHT: Omit<HighlightView, 'voxels'> = {
  rest: 0.25,
  color: '#ff3b30',
};

/** A máscara de destaque do exame (criada vazia se ainda não houver). */
export function highlightMask(imageID: string, dims: Dims): Uint8Array {
  const known = highlights.get(imageID);
  if (known && sameDims(known.dims, dims)) return known.mask;
  const mask = new Uint8Array(voxelCount(dims));
  highlights.set(imageID, { dims: [dims[0], dims[1], dims[2]], mask });
  return mask;
}

export function highlightOf(imageID: string, dims: Dims): Uint8Array | null {
  const known = highlights.get(imageID);
  const view = highlightViews[imageID];
  if (!known || !view?.voxels || !sameDims(known.dims, dims)) return null;
  return known.mask;
}

/** Avisa que a máscara de destaque mudou (depois de crescer). */
export function updateHighlight(imageID: string) {
  const known = highlights.get(imageID);
  if (!known) return;
  let voxels = 0;
  for (let i = 0; i < known.mask.length; i++) voxels += known.mask[i];
  const view = highlightViews[imageID] ?? { ...DEFAULT_HIGHLIGHT, voxels: 0 };
  highlightViews[imageID] = { ...view, voxels };
  bump(imageID);
}

export function clearHighlight(imageID: string) {
  highlights.delete(imageID);
  if (highlightViews[imageID]) highlightViews[imageID].voxels = 0;
  bump(imageID);
}

export function setHighlightLook(
  imageID: string,
  look: Partial<Omit<HighlightView, 'voxels'>>
) {
  const view = highlightViews[imageID];
  if (view) Object.assign(view, look);
}

/** Esquece a escultura (ao fechar o exame). */
export function forgetSculpts() {
  const ids = [
    ...sculpts.keys(),
    ...bones.keys(),
    ...layerStates.keys(),
    ...highlights.keys(),
  ];
  ids.forEach((imageID) => {
    sculpts.delete(imageID);
    bones.delete(imageID);
    layerStates.delete(imageID);
    highlights.delete(imageID);
    delete boneViews[imageID];
    delete layerViews[imageID];
    delete highlightViews[imageID];
    delete sculptVersions[imageID];
  });
}
