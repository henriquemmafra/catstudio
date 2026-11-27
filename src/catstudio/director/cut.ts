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
  scene3D,
  styleForWindow,
  viewDirection,
  type Scene3D,
} from '@/src/catstudio/director/render3d';
import {
  findLungMask,
  lungWeight,
  type LungMask,
} from '@/src/catstudio/director/landmarks';
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
  /** reconstrução 3D do órgão inteiro: até onde os raios vão, em mm */
  depth?: number;
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
  /** imagem já colorida (reconstrução 3D); sem ela, vale `values` + janela */
  rgba?: Uint8ClampedArray;
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
  if (recipe.projecao === 'fina' || recipe.projecao === '3d') return [0];
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
  /** reconstrução 3D: pinta o pixel direto na imagem colorida */
  paint?: Scene3D['paint'];
}

const hexToRgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

const lungMasks = new WeakMap<WorldVolume, LungMask>();

/** Região dos pulmões do volume (calculada uma vez por volume). */
export function lungMaskOf(vol: WorldVolume): LungMask {
  const known = lungMasks.get(vol);
  if (known) return known;
  const mask = findLungMask(vol);
  lungMasks.set(vol, mask);
  return mask;
}

/**
 * Pulmões isolados: em vez de recortar no plano, olha o órgão inteiro de
 * fora. O plano vai para a borda do corpo do lado do observador e a
 * profundidade atravessa o corpo todo.
 */
function wholeBodyFrame(frame: Frame, lm: Landmarks, recipe: Recipe) {
  const axis = NORMAL_AXIS[recipe.plano];
  const look = viewDirection(frame)[axis];
  const near = look > 0 ? lm.body[0][axis] - MARGIN : lm.body[1][axis] + MARGIN;
  const origin = [...frame.origin] as Vec3;
  origin[axis] = near;
  return { origin, depth: lm.body[1][axis] - lm.body[0][axis] + 2 * MARGIN };
}

export function newJob(
  vol: WorldVolume,
  recipe: Recipe,
  lm: Landmarks,
  maxSide: number
): CutJob {
  const frame = frameOf(recipe, lm);
  const size = imageSize(frame, vol, maxSide);
  // a reconstrução 3D só usa a imagem colorida: os valores ficam vazios
  const image: CutImage = {
    ...size,
    values: new Float32Array(
      recipe.projecao === '3d' ? 0 : size.width * size.height
    ),
  };
  const job: CutJob = { frame, image, project: projector(vol, frame, recipe) };
  if (recipe.projecao === '3d') {
    const whole = recipe.isolar === 'pulmoes';
    const lungs = whole ? lungMaskOf(vol) : null;
    if (whole) Object.assign(frame, wholeBodyFrame(frame, lm, recipe));
    const scene = scene3D(vol, frame, size, {
      style: whole ? 'pulmao' : styleForWindow(recipe.janela),
      depth: whole ? frame.depth! : recipe.espessura,
      background: hexToRgb(recipe.fundo),
      weight: lungs
        ? (x: number, y: number, z: number) => lungWeight(lungs, x, y, z)
        : undefined,
    });
    image.rgba = scene.rgba;
    job.paint = scene.paint;
  }
  return job;
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
      const x = rx + u[0] * px;
      const y = ry + u[1] * px;
      const z = rz + u[2] * px;
      if (job.paint) job.paint(col + width * row, x, y, z);
      else values[col + width * row] = job.project(x, y, z);
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

/** A imagem em RGBA: a reconstrução 3D como está; os cortes, com a janela. */
export function toGray(image: CutImage, recipe: Recipe): Uint8ClampedArray {
  if (image.rgba) return image.rgba;
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
    janela: target.projecao === '3d' ? 'partes-moles' : target.janela,
    campo: 'tudo',
  };
}
