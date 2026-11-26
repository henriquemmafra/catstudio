/**
 * Fantoma de tronco para os testes do diretor de arte, definido no espaço do
 * paciente (LPS, mm) e amostrado em grades com orientações diferentes.
 *
 *  - corpo: cilindro elíptico (170 × 110 mm de semieixos), z de 0 a 400, 40 UH
 *  - pulmões: elipsoides de ar centrados em x = ±75, z = 280 (semieixos
 *    55 × 70 × 100): borda lateral em x = ±130, ápice em z = 380, base em 180
 *  - gás intestinal: esfera de ar de 15 mm no abdome (não é pulmão)
 *  - "hérnia": esfera de 300 UH, raio 12, em (85, −80, 80): parede anterior
 *    do abdome, do lado esquerdo do paciente
 */
import {
  makeVolume,
  type Vec3,
  type WorldVolume,
} from '@/src/catstudio/director/volume';

export const HERNIA: Vec3 = [85, -80, 80];
export const LUNG_EDGE = 130;
export const APEX_Z = 380;
export const BASE_Z = 180;

export interface PhantomOptions {
  /** sem pulmões (exame só de abdome) */
  noLungs?: boolean;
  /** pulmão direito do paciente pequeno (colapsado) */
  smallRightLung?: boolean;
  /** mesa do tomógrafo atrás das costas, larga e fora de centro */
  table?: boolean;
}

export function density([x, y, z]: Vec3, opt: PhantomOptions = {}): number {
  if (opt.table && y > 112 && y < 126 && x < 110) return 200;
  if (z < 0 || z > 400 || (x / 170) ** 2 + (y / 110) ** 2 > 1) return -1000;
  const sphere = (c: Vec3, r: number) =>
    Math.hypot(x - c[0], y - c[1], z - c[2]) < r;
  if (sphere(HERNIA, 12)) return 300;
  if (sphere([0, -20, 100], 15)) return -900;
  if (!opt.noLungs) {
    const lung = (cx: number, scale: number) =>
      ((x - cx) / (55 * scale)) ** 2 +
        (y / (70 * scale)) ** 2 +
        ((z - 280) / (100 * scale)) ** 2 <
      1;
    if (lung(75, 1)) return -850;
    if (lung(-75, opt.smallRightLung ? 0.45 : 1)) return -850;
  }
  return 40;
}

/** Preenche a grade com a densidade do ponto do paciente de cada voxel. */
function fill(
  dims: Vec3,
  pointOf: (i: number, j: number, k: number) => Vec3,
  opt: PhantomOptions
) {
  const data = new Int16Array(dims[0] * dims[1] * dims[2]);
  let o = 0;
  for (let k = 0; k < dims[2]; k++)
    for (let j = 0; j < dims[1]; j++)
      for (let i = 0; i < dims[0]; i++) {
        data[o] = density(pointOf(i, j, k), opt);
        o += 1;
      }
  return data;
}

const cells = (mm: number, step: number) => Math.round(mm / step) + 1;

/** Grade axial comum: i = x, j = y, k = z, com o passo dado. */
export function axialPhantom(step = 4, opt: PhantomOptions = {}): WorldVolume {
  const origin: Vec3 = [-190, -130, -20];
  const dims: Vec3 = [cells(380, step), cells(260, step), cells(440, step)];
  const data = fill(
    dims,
    (i, j, k) => [
      origin[0] + i * step,
      origin[1] + j * step,
      origin[2] + k * step,
    ],
    opt
  );
  return makeVolume(data, dims, origin, [
    [step, 0, 0],
    [0, step, 0],
    [0, 0, step],
  ]);
}

/**
 * O mesmo corpo numa grade virada: i corre de cima para baixo (−z), j da
 * esquerda para a direita do paciente (−x) e k de trás para a frente (−y),
 * como numa série adquirida em outro plano e com os eixos invertidos.
 */
export function rotatedPhantom(step = 4): WorldVolume {
  const origin: Vec3 = [190, 130, 420];
  const dims: Vec3 = [cells(440, step), cells(380, step), cells(260, step)];
  const data = fill(
    dims,
    (i, j, k) => [
      origin[0] - j * step,
      origin[1] - k * step,
      origin[2] - i * step,
    ],
    {}
  );
  return makeVolume(data, dims, origin, [
    [0, 0, -step],
    [-step, 0, 0],
    [0, -step, 0],
  ]);
}
