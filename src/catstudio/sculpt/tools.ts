/**
 * CatStudio — escultura do 3D: liga as contas da máscara à vista (câmera,
 * volume desenhado, caixa de corte).
 */
import { mat4 } from 'gl-matrix';
import type vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import type vtkPlane from '@kitware/vtk.js/Common/DataModel/Plane';
import type { VtkViewApi } from '@/src/types/vtk-types';
import {
  type Dims,
  type Grid,
  type Point,
  type Vec3,
  firstHit,
  hideBall,
  keepStructure,
  lassoCut,
  rasterPolygon,
  removeFragments,
  removeStructure,
  visibleThreshold,
} from './mask';
import {
  beginStroke,
  boneOf,
  boneViews,
  editSculpt,
  highlightMask,
  layersOf,
  setBone,
  setLayers,
  updateHighlight,
} from './state';
import { type Grower, grownVoxels, growLayers, startGrow } from './grow';
import { BONE_LOW, countBone, detectBone, toggleBone } from './bone';
import { removeOutsideBody } from './body';
import { classify } from './layers';
import { hiddenOf as hiddenNow, union } from './useSculptedImage';

export interface SculptTarget {
  view: VtkViewApi;
  imageID: string;
  /** o volume que a vista 3D desenha, sem a escultura */
  base: vtkImageData;
  /** largura ÷ altura da vista */
  aspect: number;
  /** planos da caixa de corte (visível do lado positivo) */
  planes?: vtkPlane[] | null;
}

const dimsOf = (image: vtkImageData) => image.getDimensions() as Dims;

function gridOf(target: SculptTarget, hidden: Uint8Array): Grid {
  return {
    dims: dimsOf(target.base),
    scalars: target.base.getPointData().getScalars().getData(),
    hidden,
  };
}

/** cm³ de `voxels` voxels do volume desenhado */
export function volumeMl(image: vtkImageData, voxels: number): number {
  const [sx, sy, sz] = image.getSpacing();
  return (voxels * sx * sy * sz) / 1000;
}

export function formatMl(ml: number): string {
  if (ml >= 100) return `${Math.round(ml)} cm³`;
  return `${ml.toFixed(1).replace('.', ',')} cm³`;
}

/** índice do voxel → coordenadas de recorte da câmera */
export function indexToClip(target: SculptTarget): Float64Array {
  const camera = target.view.renderer.getActiveCamera();
  // o vtk devolve a matriz por linha; o gl-matrix trabalha por coluna
  const projection = mat4.transpose(
    new Float64Array(16) as unknown as mat4,
    camera.getCompositeProjectionMatrix(target.aspect, -1, 1)
  );
  const out = new Float64Array(16);
  mat4.multiply(
    out as unknown as mat4,
    projection,
    target.base.getIndexToWorld()
  );
  return out;
}

/** Laço: apaga o que está dentro, ou deixa só o que está dentro. */
export function lasso(
  target: SculptTarget,
  points: Point[],
  keepInside: boolean
): string {
  if (points.length < 3) return 'Laço pequeno demais: contorne a região.';
  const shape = rasterPolygon(points);
  const toClip = indexToClip(target);
  const changed = editSculpt(target.imageID, dimsOf(target.base), (hidden) =>
    lassoCut(gridOf(target, hidden), { toClip, shape, keepInside })
  );
  if (!changed) return 'O laço não pegou nada.';
  return keepInside ? 'Ficou só o que estava no laço.' : 'Região apagada.';
}

/**
 * Para cada plano, coeficientes [a, b, c, d] tais que a·i + b·j + c·k + d ≥ 0
 * quando o voxel está do lado visível.
 */
function planeCoefficients(target: SculptTarget): number[][] {
  const { base } = target;
  const at = (index: Vec3, plane: vtkPlane) => {
    const world = base.indexToWorld(index);
    const origin = plane.getOrigin();
    const normal = plane.getNormal();
    return (
      (world[0] - origin[0]) * normal[0] +
      (world[1] - origin[1]) * normal[1] +
      (world[2] - origin[2]) * normal[2]
    );
  };
  return (target.planes ?? []).map((plane) => {
    const d = at([0, 0, 0], plane);
    return [
      at([1, 0, 0], plane) - d,
      at([0, 1, 0], plane) - d,
      at([0, 0, 1], plane) - d,
      d,
    ];
  });
}

function insideCrop(target: SculptTarget) {
  const coefficients = planeCoefficients(target);
  if (!coefficients.length) return undefined;
  return (i: number, j: number, k: number) =>
    coefficients.every((c) => c[0] * i + c[1] * j + c[2] * k + c[3] >= 0);
}

/** A máscara atual, ou uma vazia se o exame ainda não foi esculpido. */
function hiddenOf(target: SculptTarget): Uint8Array {
  const dims = dimsOf(target.base);
  // escultura e camadas desligadas: o clique atravessa os dois
  return (
    hiddenNow(target.imageID, dims) ??
    new Uint8Array(dims[0] * dims[1] * dims[2])
  );
}

/** Voxel visível sob o ponto da vista (x, y normalizados, y para cima). */
export function voxelUnder(
  target: SculptTarget,
  point: Point,
  threshold: number
): number {
  const { renderer } = target.view;
  const toIndex = (depth: number) =>
    target.base.worldToIndex(
      renderer.normalizedDisplayToWorld(
        point[0],
        point[1],
        depth,
        target.aspect
      ) as Vec3
    ) as Vec3;
  return firstHit(gridOf(target, hiddenOf(target)), {
    from: toIndex(0),
    to: toIndex(1),
    threshold,
    accept: insideCrop(target),
  });
}

export interface PickRequest {
  point: Point;
  threshold: number;
  /** true: fica só a estrutura clicada; false: ela é apagada */
  keep: boolean;
}

/** Clique: apaga a estrutura sob o cursor, ou deixa só ela. */
export function pick(target: SculptTarget, request: PickRequest): string {
  const seed = voxelUnder(target, request.point, request.threshold);
  if (seed < 0)
    return 'Não achei nada nesse ponto. Clique em cima da estrutura ou baixe a densidade mínima.';
  let size = 0;
  editSculpt(target.imageID, dimsOf(target.base), (hidden) => {
    const grid = gridOf(target, hidden);
    size = request.keep
      ? keepStructure(grid, seed, request.threshold)
      : removeStructure(grid, seed, request.threshold);
    return size;
  });
  const volume = formatMl(volumeMl(target.base, size));
  return request.keep
    ? `Ficou só a estrutura clicada (${volume}).`
    : `Estrutura apagada (${volume}).`;
}

/** Tira as estruturas soltas menores que `maxMl` cm³. */
export function fragments(
  target: SculptTarget,
  threshold: number,
  maxMl: number
): string {
  const minVoxels = Math.max(2, Math.ceil(maxMl / volumeMl(target.base, 1)));
  const dims = dimsOf(target.base);
  // camadas desligadas também separam: o que sobra solto depois de esconder
  // os músculos é poeira, mesmo que antes estivesse grudado neles
  const layered = layersOf(target.imageID, dims)?.hidden ?? null;
  let message = 'Não achei fragmentos desse tamanho.';
  editSculpt(target.imageID, dims, (hidden) => {
    const blocked = union(hidden, layered)!.slice();
    const result = removeFragments(
      gridOf(target, blocked),
      threshold,
      minVoxels
    );
    for (let i = 0; i < hidden.length; i++)
      if (blocked[i] && !hidden[i] && !(layered && layered[i])) hidden[i] = 1;
    if (result.removed)
      message = `Tirei ${result.removed} fragmento(s), ${formatMl(
        volumeMl(target.base, result.voxels)
      )} no total. Ficaram ${result.kept} estrutura(s).`;
    return result.voxels;
  });
  return message;
}

/** Densidade a partir da qual o preset atual mostra alguma coisa. */
export function presetThreshold(
  view: VtkViewApi,
  base: vtkImageData
): { threshold: number; range: [number, number] } {
  const range = base.getPointData().getScalars().getRange() as [number, number];
  const opacity = view.renderer
    .getVolumes()[0]
    ?.getProperty()
    .getScalarOpacity(0);
  if (!opacity) return { threshold: range[0], range };
  const table = new Float32Array(512);
  opacity.getTable(range[0], range[1], table.length, table);
  return { threshold: Math.round(visibleThreshold(table, range)), range };
}

// ---------- crescer enquanto o botão fica apertado ----------

export interface GrowStroke {
  /** avança um pouco; devolve o texto do andamento */
  step(): string;
  /** termina; devolve o texto do resultado */
  finish(): string;
}

const LAYERS_PER_STEP = 3;

function growText(target: SculptTarget, grower: Grower) {
  return formatMl(volumeMl(target.base, grownVoxels(grower)));
}

/** Crescer pintando o destaque (o que está escondido não muda). */
function startHighlightStroke(
  target: SculptTarget,
  request: PickRequest,
  seed: number
): GrowStroke | null {
  const dims = dimsOf(target.base);
  const into = highlightMask(target.imageID, dims);
  const blocked =
    hiddenNow(target.imageID, dims) ?? new Uint8Array(into.length);
  const grower = startGrow(gridOf(target, blocked), seed, {
    threshold: request.threshold,
    keep: false,
    into,
  });
  if (!grower) return null;
  updateHighlight(target.imageID);
  return {
    step: () => {
      growLayers(grower, LAYERS_PER_STEP);
      updateHighlight(target.imageID);
      return `Destacando… ${growText(target, grower)}. Solte para parar.`;
    },
    finish: () => `Destacado: ${growText(target, grower)}.`,
  };
}

/**
 * Começa a crescer a partir do que está sob o cursor. Devolve null se não há
 * estrutura ali.
 */
export function startGrowStroke(
  target: SculptTarget,
  request: PickRequest & { highlight?: boolean }
): GrowStroke | null {
  const seed = voxelUnder(target, request.point, request.threshold);
  if (seed < 0) return null;
  if (request.highlight) return startHighlightStroke(target, request, seed);
  const stroke = beginStroke(target.imageID, dimsOf(target.base));
  const grower = startGrow(gridOf(target, stroke.hidden), seed, request);
  if (!grower) {
    stroke.cancel();
    return null;
  }
  stroke.update();
  return {
    step: () => {
      growLayers(grower, LAYERS_PER_STEP);
      stroke.update();
      return `Crescendo… ${growText(target, grower)}. Solte para parar.`;
    },
    finish: () =>
      request.keep
        ? `Ficou só o que cresceu (${growText(target, grower)}).`
        : `Apaguei o que cresceu (${growText(target, grower)}).`,
  };
}

// ---------- osso ----------

/** Procura o osso no que está visível. */
export function findBone(target: SculptTarget): string {
  const grid = gridOf(target, hiddenOf(target));
  const minVoxels = Math.ceil(1 / volumeMl(target.base, 1));
  const result = detectBone(grid, { low: BONE_LOW, minVoxels });
  if (!result.voxels)
    return 'Não achei osso. Marque à mão com "Clique: osso sim/não".';
  setBone(target.imageID, { dims: grid.dims, ...result });
  return `Osso: ${result.components} estrutura(s), ${formatMl(
    volumeMl(target.base, result.voxels)
  )}. Corrija com "Clique: osso sim/não" se precisar.`;
}

/** Clique de correção: a estrutura passa a ser osso, ou deixa de ser. */
export function flipBone(target: SculptTarget, point: Point): string {
  const grid = gridOf(target, hiddenOf(target));
  const seed = voxelUnder(target, point, BONE_LOW);
  if (seed < 0) return 'Não achei estrutura densa nesse ponto.';
  const label =
    boneOf(target.imageID, grid.dims) ?? new Uint8Array(grid.hidden.length);
  const changed = toggleBone(grid, label, seed, BONE_LOW);
  if (!changed) return 'Não achei estrutura densa nesse ponto.';
  setBone(target.imageID, {
    dims: grid.dims,
    label,
    voxels: countBone(label),
  });
  return changed > 0
    ? 'Marcado como osso.'
    : 'Deixou de ser osso (volta a aparecer como o resto).';
}

export const hasBone = (imageID: string) =>
  (boneViews[imageID]?.voxels ?? 0) > 0;

// ---------- mesa ----------

// ---------- camadas ----------

/** Separa os tecidos em camadas (uma vez por exame). */
export function computeLayers(target: SculptTarget): string {
  const dims = dimsOf(target.base);
  const set = classify(
    { dims, scalars: target.base.getPointData().getScalars().getData() },
    Math.max(...target.base.getSpacing()),
    volumeMl(target.base, 1) * 1000
  );
  setLayers(target.imageID, set);
  if (!boneOf(target.imageID, dims) && set.boneVoxels)
    setBone(target.imageID, {
      dims,
      label: set.bone,
      voxels: set.boneVoxels,
    });
  return set.counts.vasos
    ? 'Camadas prontas.'
    : 'Camadas prontas (sem contraste: não há vasos para separar).';
}

/** Esconde a mesa e tudo o mais que está fora do corpo. */
export function removeTable(target: SculptTarget): string {
  let message = 'Não achei o corpo neste exame; nada foi cortado.';
  editSculpt(target.imageID, dimsOf(target.base), (hidden) => {
    const result = removeOutsideBody(gridOf(target, hidden));
    if (!result.body) return 0;
    message = result.tissue
      ? `Tirei a mesa e o que estava fora do corpo (${formatMl(
          volumeMl(target.base, result.tissue)
        )} de material).`
      : 'Não havia mesa nem objetos fora do corpo; cortei só o ar de fora.';
    return result.hidden;
  });
  return message;
}

// ---------- borracha ----------

export interface BrushStroke {
  /** apaga uma bola em volta do que está sob o cursor */
  at(point: Point): void;
  finish(): string;
}

/** Borracha: esculpe a superfície por onde o cursor passa. */
export function startBrushStroke(
  target: SculptTarget,
  options: { threshold: number; radiusMm: number }
): BrushStroke {
  const stroke = beginStroke(target.imageID, dimsOf(target.base));
  const grid = gridOf(target, stroke.hidden);
  const spacing = target.base.getSpacing();
  const radius = spacing.map((mm) => options.radiusMm / mm) as Vec3;
  let erased = 0;
  return {
    at: (point) => {
      const center = voxelUnder(target, point, options.threshold);
      if (center < 0) return;
      erased += hideBall(grid, { center, radius });
      stroke.update();
    },
    finish: () => {
      if (!erased) {
        stroke.cancel();
        return 'A borracha não encostou em nada.';
      }
      return `Borracha: ${formatMl(volumeMl(target.base, erased))} apagados.`;
    },
  };
}

// ---------- só uma região (vindo do diretor de arte) ----------

/**
 * Esconde tudo o que está fora da região. `inside` recebe o ponto em mm
 * (coordenadas do aparelho). Devolve quantos voxels sumiram.
 */
type Inside = (x: number, y: number, z: number) => boolean;

/** Uma linha do volume: esconde o que está fora; devolve quantos. */
function keepRow(hidden: Uint8Array, inside: Inside, row: number[]): number {
  const [start, count, x0, y0, z0, dx, dy, dz] = row;
  let changed = 0;
  for (let i = 0; i < count; i++) {
    const index = start + i;
    if (hidden[index] || inside(x0 + dx * i, y0 + dy * i, z0 + dz * i))
      continue;
    hidden[index] = 1;
    changed += 1;
  }
  return changed;
}

export function keepRegion(target: SculptTarget, inside: Inside): number {
  const dims = dimsOf(target.base);
  const m = target.base.getIndexToWorld();
  return editSculpt(target.imageID, dims, (hidden) => {
    let changed = 0;
    for (let k = 0; k < dims[2]; k++)
      for (let j = 0; j < dims[1]; j++)
        changed += keepRow(hidden, inside, [
          dims[0] * (j + dims[1] * k),
          dims[0],
          m[4] * j + m[8] * k + m[12],
          m[5] * j + m[9] * k + m[13],
          m[6] * j + m[10] * k + m[14],
          m[0],
          m[1],
          m[2],
        ]);
    return changed;
  });
}
