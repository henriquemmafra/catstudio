/**
 * CatStudio — GIF do 3D girando: as contas (ângulos de cada quadro e a
 * posição da câmera em cada um). Sem tela nem vtk aqui, para dar para testar.
 */
import { vec3, mat4 } from 'gl-matrix';

export const ARCS = [90, 180, 360] as const;
export type Arc = (typeof ARCS)[number];
/** giro: vai num sentido só e recomeça; vaivém: vai e volta */
export type Motion = 'giro' | 'vaivem';
/** vertical: gira de lado (como numa mesa giratória); horizontal: tomba */
export type Axis = 'vertical' | 'horizontal';

export interface SpinOptions {
  arc: Arc;
  motion: Motion;
  axis: Axis;
}

/** Quadros de uma passada, por arco (passo de 7,5° no giro completo). */
export const FRAMES: Record<Arc, number> = { 90: 24, 180: 36, 360: 48 };

/**
 * Ângulos (graus) de uma passada. A volta inteira não repete o último quadro
 * (ele é igual ao primeiro); os arcos parciais vão de -arco/2 a +arco/2, com
 * a vista atual no meio.
 */
export function sweep(arc: Arc): number[] {
  const n = FRAMES[arc];
  if (arc === 360) return Array.from({ length: n }, (_, i) => (360 * i) / n);
  return Array.from({ length: n }, (_, i) => -arc / 2 + (arc * i) / (n - 1));
}

/**
 * A ordem em que os quadros de uma passada aparecem no GIF: no vaivém a
 * passada volta de trás para a frente, sem repetir as pontas.
 */
export function playOrder(count: number, motion: Motion): number[] {
  const forward = Array.from({ length: count }, (_, i) => i);
  if (motion === 'giro') return forward;
  return [...forward, ...forward.slice(1, -1).reverse()];
}

export interface Pose {
  position: vec3;
  focalPoint: vec3;
  viewUp: vec3;
}

/** A câmera girada de `degrees` em volta do ponto para onde ela olha. */
export function turned(base: Pose, axis: Axis, degrees: number): Pose {
  const up = vec3.normalize(vec3.create(), base.viewUp);
  const back = vec3.sub(vec3.create(), base.position, base.focalPoint);
  const right = vec3.normalize(
    vec3.create(),
    vec3.cross(vec3.create(), up, back)
  );
  const about = axis === 'vertical' ? up : right;
  const turn = mat4.fromRotation(
    mat4.create(),
    (degrees * Math.PI) / 180,
    about
  );
  if (!turn) return base;
  const offset = vec3.transformMat4(vec3.create(), back, turn);
  return {
    position: vec3.add(vec3.create(), base.focalPoint, offset),
    focalPoint: base.focalPoint,
    viewUp: vec3.transformMat4(vec3.create(), up, turn),
  };
}

/** Tamanho do GIF: o lado maior vira `side`, sem aumentar a imagem. */
export function gifSize(
  width: number,
  height: number,
  side: number
): [number, number] {
  const scale = Math.min(1, side / Math.max(width, height, 1));
  return [
    Math.max(2, Math.round(width * scale)),
    Math.max(2, Math.round(height * scale)),
  ];
}
