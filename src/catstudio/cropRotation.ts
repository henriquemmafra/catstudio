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

type Basis = [Vec3, Vec3, Vec3];

const dot3 = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const det3 = (m: Basis) =>
  dot3(m[0], [
    m[1][1] * m[2][2] - m[1][2] * m[2][1],
    m[1][2] * m[2][0] - m[1][0] * m[2][2],
    m[1][0] * m[2][1] - m[1][1] * m[2][0],
  ]);

/** O eixo da caixa (com sinal) mais alinhado com `target`, fora os usados. */
function closestAxis(axes: Basis, target: Vec3, used: Set<number>): Vec3 {
  let best = { k: -1, score: -1, sign: 1 };
  axes.forEach((axis, k) => {
    if (used.has(k)) return;
    const d = dot3(axis, target);
    if (Math.abs(d) > best.score)
      best = { k, score: Math.abs(d), sign: Math.sign(d) || 1 };
  });
  used.add(best.k);
  const axis = axes[best.k];
  return [axis[0] * best.sign, axis[1] * best.sign, axis[2] * best.sign];
}

/**
 * Rotação (em torno de `pivot`) que deixa a caixa de frente para a tela:
 * cada face fica paralela à tela ou de perfil. Cada eixo da caixa vai para a
 * direção da câmera mais próxima dele, então o giro é o menor possível.
 */
export function screenRotation(
  camera: { up: Vec3; direction: Vec3 },
  axes: Basis,
  pivot: Vec3
): Matrix {
  const back = vec3.normalize(vec3.create(), [
    -camera.direction[0],
    -camera.direction[1],
    -camera.direction[2],
  ]);
  const right = vec3.normalize(
    vec3.create(),
    vec3.cross(vec3.create(), camera.up, back)
  );
  const up = vec3.cross(vec3.create(), back, right);
  const targets: Basis = [
    [right[0], right[1], right[2]],
    [up[0], up[1], up[2]],
    [back[0], back[1], back[2]],
  ];
  // primeiro o eixo de profundidade, depois o vertical, por último o lateral
  const used = new Set<number>();
  const picked: Basis = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  [2, 1, 0].forEach((t) => {
    picked[t] = closestAxis(axes, targets[t], used);
  });
  // mesma orientação (mão direita) dos dois lados; uma caixa espelhada é a mesma
  if (Math.sign(det3(picked)) !== Math.sign(det3(targets)))
    targets[0] = [-targets[0][0], -targets[0][1], -targets[0][2]];
  // R = alvos · escolhidos^T (leva cada eixo escolhido ao seu alvo)
  const turn = mat4.create();
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++)
      turn[4 * c + r] = targets.reduce(
        (sum, t, n) => sum + t[r] * picked[n][c],
        0
      );
  const out = mat4.create();
  mat4.translate(out, out, pivot);
  mat4.multiply(out, out, turn);
  mat4.translate(out, out, [-pivot[0], -pivot[1], -pivot[2]]);
  return Array.from(out);
}

export function setBoxRotation(imageID: string, rotation: Matrix) {
  cropRotations[imageID] = rotation;
}
