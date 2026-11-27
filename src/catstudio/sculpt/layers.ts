/**
 * CatStudio — escultura do 3D: camadas de tecido para mostrar/esconder com
 * um botão (fora do corpo, pele, gordura, músculos e órgãos, vasos, osso).
 *
 * Classificação por densidade e posição, feita uma vez por exame no volume que
 * o 3D desenha. É heurística, não segmentação:
 *  - fora do corpo: tudo fora do contorno do paciente (mesa, cabos, ar);
 *  - pele: os primeiros ~3 mm do corpo a partir da superfície;
 *  - gordura: −190 a −30 UH;
 *  - músculos e órgãos: −30 a 150 UH (fígado, coração sem contraste, rins…);
 *  - vasos: ≥ 150 UH que não é osso — só existe em exame com contraste;
 *  - osso: estruturas densas e heterogêneas (ver bone.ts).
 * O ar de dentro (pulmões, alças) não tem botão: já é transparente.
 */
import { type Dims, type Grid } from './mask';
import { bodyMask, erode, outsideOf } from './body';
import { BONE_LOW, detectBone } from './bone';

export const LAYERS = [
  'fora',
  'pele',
  'gordura',
  'moles',
  'vasos',
  'osso',
] as const;
export type Layer = (typeof LAYERS)[number];

export const LAYER_TITLE: Record<Layer, string> = {
  fora: 'Fora do corpo',
  pele: 'Pele',
  gordura: 'Gordura',
  moles: 'Músculos e órgãos',
  vasos: 'Vasos (contraste)',
  osso: 'Osso',
};

/** Código de cada camada no volume de rótulos (0 = ar de dentro). */
export const LAYER_CODE: Record<Layer, number> = {
  fora: 1,
  pele: 2,
  gordura: 3,
  moles: 4,
  vasos: 5,
  osso: 6,
};

/** Espessura da "pele", em mm. */
export const SKIN_MM = 3;
export const FAT_HU: [number, number] = [-190, -30];
export const SOFT_TOP_HU = 150;
/** Abaixo desta fração do corpo, não há contraste: o botão de vasos some. */
export const MIN_VESSEL_FRACTION = 0.0005;

export interface LayerSet {
  dims: Dims;
  labels: Uint8Array;
  /** voxels por camada */
  counts: Record<Layer, number>;
  /** rótulos de osso (para o controle de osso translúcido) */
  bone: Uint8Array;
  boneVoxels: number;
}

function insideLabel(hu: number, isBone: boolean): number {
  if (isBone) return LAYER_CODE.osso;
  if (hu >= SOFT_TOP_HU) return LAYER_CODE.vasos;
  if (hu >= FAT_HU[1]) return LAYER_CODE.moles;
  if (hu >= FAT_HU[0]) return LAYER_CODE.gordura;
  return 0;
}

/**
 * Camada de cada voxel. `spacing` em mm: o maior espaçamento entre voxels
 * (a pele é tirada em camadas de voxel iguais nos três eixos; usar o maior
 * evita que, em cortes grossos, a "pele" coma o que está embaixo dela).
 */
export function classify(
  grid: Pick<Grid, 'dims' | 'scalars'>,
  spacing: number,
  voxelMm3 = spacing ** 3
): LayerSet {
  const { dims, scalars } = grid;
  const total = dims[0] * dims[1] * dims[2];
  const free: Grid = { dims, scalars, hidden: new Uint8Array(total) };
  // "dentro" é tudo o que está no contorno do corpo, inclusive o que fica
  // solto dentro do pulmão (um nódulo cercado de ar não é "fora do corpo")
  const outside = outsideOf(bodyMask(free), dims);
  const body = new Uint8Array(total);
  for (let i = 0; i < total; i++) body[i] = outside[i] ^ 1;
  let core: Uint8Array = body;
  const peel = Math.max(1, Math.round(SKIN_MM / Math.max(spacing, 0.1)));
  for (let n = 0; n < peel; n++) core = erode(core, dims);
  // estruturas menores que 1 cm³ não são avaliadas como osso
  const minVoxels = Math.max(20, Math.ceil(1000 / voxelMm3));
  const bone = detectBone(free, { low: BONE_LOW, minVoxels });
  const labels = new Uint8Array(total);
  const counts = Object.fromEntries(LAYERS.map((l) => [l, 0])) as Record<
    Layer,
    number
  >;
  const byCode = LAYERS.reduce<Layer[]>((list, layer) => {
    list[LAYER_CODE[layer]] = layer;
    return list;
  }, []);
  for (let i = 0; i < total; i++) {
    let code: number;
    if (!body[i]) code = LAYER_CODE.fora;
    else if (bone.label[i] > 0) code = LAYER_CODE.osso;
    else if (!core[i] && scalars[i] > FAT_HU[0]) code = LAYER_CODE.pele;
    else code = insideLabel(scalars[i], false);
    labels[i] = code;
    if (code) counts[byCode[code]] += 1;
  }
  return { dims, labels, counts, bone: bone.label, boneVoxels: bone.voxels };
}

/** A camada vale a pena ter botão? (vasos só com contraste) */
export function available(set: LayerSet, layer: Layer): boolean {
  if (layer !== 'vasos') return set.counts[layer] > 0;
  const body = LAYERS.reduce(
    (sum, l) => sum + (l === 'fora' ? 0 : set.counts[l]),
    0
  );
  return set.counts.vasos > MIN_VESSEL_FRACTION * body;
}

/** 1 = escondido por estar numa camada desligada; null se nada está desligado. */
export function hiddenByLayers(
  set: LayerSet,
  visible: Record<Layer, boolean>
): Uint8Array | null {
  const off = new Uint8Array(8);
  let any = false;
  LAYERS.forEach((layer) => {
    if (visible[layer]) return;
    off[LAYER_CODE[layer]] = 1;
    any = true;
  });
  if (!any) return null;
  const out = new Uint8Array(set.labels.length);
  for (let i = 0; i < out.length; i++) out[i] = off[set.labels[i]];
  return out;
}

export const allVisible = (): Record<Layer, boolean> =>
  Object.fromEntries(LAYERS.map((l) => [l, true])) as Record<Layer, boolean>;
