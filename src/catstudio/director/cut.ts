/**
 * CatStudio — diretor de arte: desenha o corte pedido. É uma reconstrução
 * multiplanar feita em CPU, direto sobre os voxels do exame, uma vez por
 * pedido: não usa a placa de vídeo nem redesenha enquanto se ajusta.
 */
import type { Landmarks } from '@/src/catstudio/director/landmarks';
import {
  NORMAL_AXIS,
  WINDOWS,
  cutPosition,
  type Recipe,
} from '@/src/catstudio/director/recipe';
import {
  sample,
  type Vec3,
  type WorldVolume,
} from '@/src/catstudio/director/volume';

export interface Frame {
  /** canto superior esquerdo da imagem, no centro da fatia (mm, LPS) */
  origin: Vec3;
  /** direção da imagem para a direita e para baixo (unitários) */
  u: Vec3;
  v: Vec3;
  normal: Vec3;
  /** tamanho do campo, em mm */
  width: number;
  height: number;
  /** letras de orientação: esquerda, direita, alto e baixo da imagem */
  labels: { left: string; right: string; top: string; bottom: string };
}

const MARGIN = 12;
/** Folga acima do ápice e abaixo da base ao recortar tórax ou abdome. */
const FIELD_MARGIN = 45;

/** Faixa vertical (z) mostrada conforme o campo pedido. */
function zRange(recipe: Recipe, lm: Landmarks): [number, number] {
  const [low, high] = [lm.body[0][2] - MARGIN, lm.body[1][2] + MARGIN];
  if (recipe.campo === 'torax' && lm.basis === 'pulmoes')
    return [
      Math.max(low, lm.baseZ - FIELD_MARGIN),
      Math.min(high, lm.apexZ + FIELD_MARGIN),
    ];
  if (recipe.campo === 'abdome' && lm.basis === 'pulmoes')
    return [low, Math.min(high, lm.baseZ + FIELD_MARGIN)];
  return [low, high];
}

/**
 * Enquadramento do corte, na convenção radiológica:
 *  - sagital: anterior à esquerda da imagem, cranial no alto;
 *  - coronal: direita do paciente à esquerda da imagem, cranial no alto;
 *  - axial: direita do paciente à esquerda da imagem, anterior no alto.
 */
export function frameOf(recipe: Recipe, lm: Landmarks): Frame {
  const at = cutPosition(recipe, lm);
  const [min, max] = lm.body;
  const x: [number, number] = [min[0] - MARGIN, max[0] + MARGIN];
  const y: [number, number] = [min[1] - MARGIN, max[1] + MARGIN];
  const z = zRange(recipe, lm);
  if (recipe.plano === 'sagital')
    return {
      origin: [at, y[0], z[1]],
      u: [0, 1, 0],
      v: [0, 0, -1],
      normal: [1, 0, 0],
      width: y[1] - y[0],
      height: z[1] - z[0],
      labels: { left: 'A', right: 'P', top: 'S', bottom: 'I' },
    };
  if (recipe.plano === 'coronal')
    return {
      origin: [x[0], at, z[1]],
      u: [1, 0, 0],
      v: [0, 0, -1],
      normal: [0, 1, 0],
      width: x[1] - x[0],
      height: z[1] - z[0],
      labels: { left: 'D', right: 'E', top: 'S', bottom: 'I' },
    };
  return {
    origin: [x[0], y[0], at],
    u: [1, 0, 0],
    v: [0, 1, 0],
    normal: [0, 0, 1],
    width: x[1] - x[0],
    height: y[1] - y[0],
    labels: { left: 'D', right: 'E', top: 'A', bottom: 'P' },
  };
}

export interface CutImage {
  width: number;
  height: number;
  /** mm por pixel */
  pixel: number;
  /** densidade (UH) de cada pixel */
  values: Float32Array;
}

/** Maior número de amostras ao longo da espessura. */
const MAX_STEPS = 48;

/** Tamanho em pixels para o campo caber em `maxSide`, sem passar da resolução do exame. */
export function imageSize(frame: Frame, vol: WorldVolume, maxSide: number) {
  const pixel = Math.max(
    vol.minSpacing,
    Math.max(frame.width, frame.height) / maxSide
  );
  return {
    pixel,
    width: Math.max(1, Math.round(frame.width / pixel)),
    height: Math.max(1, Math.round(frame.height / pixel)),
  };
}

/** Deslocamentos (mm) das amostras ao longo da espessura, centrados no corte. */
export function slabOffsets(recipe: Recipe, vol: WorldVolume): number[] {
  if (recipe.projecao === 'fina') return [0];
  const count = Math.min(
    MAX_STEPS,
    Math.max(2, Math.round(recipe.espessura / vol.minSpacing) + 1)
  );
  return Array.from(
    { length: count },
    (_, i) => (i / (count - 1) - 0.5) * recipe.espessura
  );
}

type Projector = (x: number, y: number, z: number) => number;

/** Função que projeta a fatia num ponto do plano, conforme a receita. */
function projector(vol: WorldVolume, frame: Frame, recipe: Recipe): Projector {
  const offsets = slabOffsets(recipe, vol);
  const [nx, ny, nz] = frame.normal;
  const at = (x: number, y: number, z: number, t: number) =>
    sample(vol, x + nx * t, y + ny * t, z + nz * t);
  if (offsets.length === 1) return (x, y, z) => sample(vol, x, y, z);
  if (recipe.projecao === 'mip')
    return (x, y, z) => {
      let best = -Infinity;
      for (let s = 0; s < offsets.length; s++)
        best = Math.max(best, at(x, y, z, offsets[s]));
      return best;
    };
  if (recipe.projecao === 'minip')
    return (x, y, z) => {
      let best = Infinity;
      for (let s = 0; s < offsets.length; s++)
        best = Math.min(best, at(x, y, z, offsets[s]));
      return best;
    };
  return (x, y, z) => {
    let sum = 0;
    for (let s = 0; s < offsets.length; s++) sum += at(x, y, z, offsets[s]);
    return sum / offsets.length;
  };
}

export interface CutJob {
  frame: Frame;
  image: CutImage;
  project: Projector;
}

export function newJob(
  vol: WorldVolume,
  recipe: Recipe,
  lm: Landmarks,
  maxSide: number
): CutJob {
  const frame = frameOf(recipe, lm);
  const size = imageSize(frame, vol, maxSide);
  return {
    frame,
    image: { ...size, values: new Float32Array(size.width * size.height) },
    project: projector(vol, frame, recipe),
  };
}

/**
 * Calcula as linhas [fromRow, toRow) do corte. Chamado em fatias para a
 * página continuar respondendo durante o desenho.
 */
export function renderRows(job: CutJob, fromRow: number, toRow: number) {
  const { origin, u, v } = job.frame;
  const { pixel, width, values } = job.image;
  for (let row = fromRow; row < toRow; row++) {
    const py = (row + 0.5) * pixel;
    const rx = origin[0] + v[0] * py;
    const ry = origin[1] + v[1] * py;
    const rz = origin[2] + v[2] * py;
    for (let col = 0; col < width; col++) {
      const px = (col + 0.5) * pixel;
      values[col + width * row] = job.project(
        rx + u[0] * px,
        ry + u[1] * px,
        rz + u[2] * px
      );
    }
  }
}

/** Corte inteiro de uma vez (testes e localizador). */
export function renderCut(
  vol: WorldVolume,
  recipe: Recipe,
  lm: Landmarks,
  maxSide: number
): CutJob {
  const job = newJob(vol, recipe, lm, maxSide);
  renderRows(job, 0, job.image.height);
  return job;
}

/** Aplica a janela: densidades → tons de cinza (RGBA). */
export function toGray(image: CutImage, recipe: Recipe): Uint8ClampedArray {
  const [windowWidth, level] = WINDOWS[recipe.janela];
  const low = level - windowWidth / 2;
  const rgba = new Uint8ClampedArray(4 * image.values.length);
  for (let i = 0; i < image.values.length; i++) {
    const gray = ((image.values[i] - low) / windowWidth) * 255;
    rgba[4 * i] = gray;
    rgba[4 * i + 1] = gray;
    rgba[4 * i + 2] = gray;
    rgba[4 * i + 3] = 255;
  }
  return rgba;
}

/** Um corte já desenhado, usado como localizador de outro. */
export type Locator = Pick<CutJob, 'frame' | 'image'>;

/** Posição no eixo do corte `target` (mm) de um pixel do localizador. */
export function positionFromPixel(
  locator: Locator,
  col: number,
  row: number,
  target: Recipe
): number {
  const axis = NORMAL_AXIS[target.plano];
  const { frame, image } = locator;
  return (
    frame.origin[axis] +
    frame.u[axis] * (col + 0.5) * image.pixel +
    frame.v[axis] * (row + 0.5) * image.pixel
  );
}

/**
 * Onde o corte `target` cruza a imagem do localizador: coluna ou linha, em
 * pixels. `null` se os dois planos forem paralelos.
 */
export function lineOnLocator(
  locator: Locator,
  target: Recipe,
  lm: Landmarks
): { vertical: boolean; at: number } | null {
  const axis = NORMAL_AXIS[target.plano];
  const { frame, image } = locator;
  const distance = cutPosition(target, lm) - frame.origin[axis];
  if (frame.u[axis])
    return { vertical: true, at: distance / frame.u[axis] / image.pixel };
  if (frame.v[axis])
    return { vertical: false, at: distance / frame.v[axis] / image.pixel };
  return null;
}

/** Plano do localizador: axial para sagital e coronal; coronal para axial. */
export function locatorRecipe(target: Recipe, lm: Landmarks): Recipe {
  const axial = target.plano !== 'axial';
  return {
    ...target,
    plano: axial ? 'axial' : 'coronal',
    referencia: 'ponto',
    ponto: axial ? lm.center[2] : lm.midCoronalY,
    deslocamento: 0,
    projecao: 'fina',
    campo: 'tudo',
  };
}
