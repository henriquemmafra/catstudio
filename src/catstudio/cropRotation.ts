/**
 * CatStudio — caixa de corte girada.
 *
 * A caixa de corte do VolView é sempre alinhada ao exame. Aqui ela ganha uma
 * rotação em torno do centro do volume: os seis planos de corte e as alças
 * da caixa giram juntos, e o exame fica parado. A rotação vale só para a
 * vista 3D; as linhas de corte das vistas 2D continuam mostrando a caixa
 * alinhada.
 */
import { type MaybeRef, computed, reactive, unref } from 'vue';
import { mat4, vec3 } from 'gl-matrix';
import vtkPlane from '@kitware/vtk.js/Common/DataModel/Plane';
import type { Maybe } from '@/src/types';
import { useCropStore } from '@/src/store/tools/crop';

export type Matrix = number[];
type Vec3 = [number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** Rotação da caixa por exame (mat4 por coluna, em coordenadas do paciente). */
export const cropRotations = reactive<Record<string, Matrix>>({});

export const rotationOf = (imageID: Maybe<string>): Matrix =>
  (imageID && cropRotations[imageID]) || IDENTITY;

export const isRotated = (imageID: Maybe<string>) =>
  !!imageID && imageID in cropRotations;

/** Gira `angle` radianos em torno do eixo `axis` que passa por `pivot`. */
export function rotationAbout(pivot: Vec3, axis: Vec3, angle: number): Matrix {
  const out = mat4.create();
  mat4.translate(out, out, pivot);
  mat4.rotate(out, out, angle, axis);
  mat4.translate(out, out, [-pivot[0], -pivot[1], -pivot[2]]);
  return Array.from(out);
}

/** Aplica mais um giro por cima da rotação atual da caixa. */
export function rotateBox(imageID: string, turn: Matrix) {
  const out = mat4.create();
  mat4.multiply(
    out,
    turn as unknown as mat4,
    rotationOf(imageID) as unknown as mat4
  );
  cropRotations[imageID] = Array.from(out);
}

export function resetBoxRotation(imageID: string) {
  delete cropRotations[imageID];
}

export function forgetBoxRotations() {
  Object.keys(cropRotations).forEach(resetBoxRotation);
}

export interface PlaneLike {
  origin: Vec3;
  normal: Vec3;
}

/** O plano depois da rotação: a origem gira e anda, a normal só gira. */
export function rotatePlane(plane: PlaneLike, rotation: Matrix): PlaneLike {
  const matrix = rotation as unknown as mat4;
  const origin = vec3.transformMat4(vec3.create(), plane.origin, matrix);
  const tip = vec3.transformMat4(
    vec3.create(),
    vec3.add(vec3.create(), plane.origin, plane.normal),
    matrix
  );
  const normal = vec3.normalize(tip, vec3.subtract(tip, tip, origin));
  return {
    origin: [origin[0], origin[1], origin[2]],
    normal: [normal[0], normal[1], normal[2]],
  };
}

/**
 * Giro de arrastar o mouse (dx, dy em pixels): na horizontal em torno do
 * "para cima" da câmera, na vertical em torno do "para a direita".
 */
export function dragTurn(
  camera: { up: Vec3; direction: Vec3 },
  pivot: Vec3,
  drag: { dx: number; dy: number; radiansPerPixel: number }
): Matrix {
  const right = vec3.cross(vec3.create(), camera.direction, camera.up);
  vec3.normalize(right, right);
  const horizontal = rotationAbout(
    pivot,
    camera.up,
    drag.dx * drag.radiansPerPixel
  );
  const vertical = rotationAbout(
    pivot,
    [right[0], right[1], right[2]],
    drag.dy * drag.radiansPerPixel
  );
  const out = mat4.create();
  mat4.multiply(
    out,
    vertical as unknown as mat4,
    horizontal as unknown as mat4
  );
  return Array.from(out);
}

/** Os planos de corte da vista 3D, já com a rotação da caixa. */
export function useBoxPlanes(imageID: MaybeRef<Maybe<string>>) {
  const aligned = useCropStore().getComputedVTKPlanes(imageID);
  return computed(() => {
    const id = unref(imageID);
    const planes = aligned.value;
    if (!planes || !isRotated(id)) return planes;
    const rotation = rotationOf(id);
    return planes.map((plane) =>
      vtkPlane.newInstance(
        rotatePlane(
          {
            origin: plane.getOrigin() as Vec3,
            normal: plane.getNormal() as Vec3,
          },
          rotation
        )
      )
    );
  });
}
