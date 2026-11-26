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
  sculptOf,
  setBone,
} from './state';
import { type Grower, grownVoxels, growLayers, startGrow } from './grow';
import { BONE_LOW, countBone, detectBone, toggleBone } from './bone';

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
  return (
    sculptOf(target.imageID, dims)?.hidden ??
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
  let message = 'Não achei fragmentos desse tamanho.';
  editSculpt(target.imageID, dimsOf(target.base), (hidden) => {
    const result = removeFragments(
      gridOf(target, hidden),
      threshold,
      minVoxels
    );
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

/**
 * Começa a crescer a partir do que está sob o cursor. Devolve null se não há
 * estrutura ali.
 */
export function startGrowStroke(
  target: SculptTarget,
  request: PickRequest
): GrowStroke | null {
  const seed = voxelUnder(target, request.point, request.threshold);
  if (seed < 0) return null;
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
