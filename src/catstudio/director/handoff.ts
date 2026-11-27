/**
 * CatStudio — diretor de arte → vista 3D.
 *
 * "Editar no 3D" leva a imagem pedida ao diretor para a vista 3D comum, como
 * ponto de partida: a câmera olhando como o diretor olhou, a caixa de corte
 * no plano (girada junto com o paciente, se ele estava torto no aparelho),
 * as cores e o fundo, e — com "só os pulmões" — o resto escondido. A partir
 * daí, todas as ferramentas da vista 3D valem.
 */
import { reactive } from 'vue';
import type { Matrix } from '@/src/catstudio/cropRotation';
import { rotationAbout } from '@/src/catstudio/cropRotation';
import { frameOf, lungMaskOf } from './cut';
import { useViewStore } from '@/src/store/views';
import type { Landmarks, LungMask } from './landmarks';
import { inLungs } from './landmarks';
import { NORMAL_AXIS, cutPosition, type Recipe } from './recipe';
import { rotateXY, type Roll } from './alignment';
import { styleForWindow, viewDirection } from './render3d';
import type { Vec3, WorldVolume } from './volume';

export interface CameraPose {
  focalPoint: Vec3;
  /** para onde a câmera olha */
  direction: Vec3;
  viewUp: Vec3;
}

/** Caixa de corte nos eixos do paciente; `rotation` leva ao aparelho. */
export interface CropRequest {
  Sagittal: [number, number];
  Coronal: [number, number];
  Axial: [number, number];
  rotation: Matrix | null;
}

export interface Handoff {
  imageID: string;
  camera: CameraPose;
  crop: CropRequest | null;
  /** id da paleta por tecido */
  palette: string;
  background: string;
  /** só o que fica dentro (pulmões isolados), em coordenadas do aparelho */
  keepOnly: ((x: number, y: number, z: number) => boolean) | null;
}

/** O último pedido; as vistas 3D reagem ao número. */
export const handoff = reactive<{ request: Handoff | null; seq: number }>({
  request: null,
  seq: 0,
});

export function sendToView(request: Handoff) {
  handoff.request = request;
  handoff.seq += 1;
}

/** A paleta do diretor com as mesmas cores da imagem dele. */
export function paletteFor(recipe: Recipe): string {
  if (recipe.isolar === 'pulmoes') return 'diretor-pulmao';
  return `diretor-${styleForWindow(recipe.janela)}`;
}

const MARGIN = 15;

/** Faixa mantida no eixo do corte: do plano para longe do observador. */
export function keptRange(
  recipe: Recipe,
  lm: Landmarks,
  look: number
): [number, number] {
  const axis = NORMAL_AXIS[recipe.plano];
  const low = lm.body[0][axis] - MARGIN;
  const high = lm.body[1][axis] + MARGIN;
  const at = cutPosition(recipe, lm);
  const depth = recipe.projecao === '3d' ? recipe.espessura : Infinity;
  return look > 0
    ? [at, Math.min(high, at + depth)]
    : [Math.max(low, at - depth), at];
}

const AXIS_NAME = ['Sagittal', 'Coronal', 'Axial'] as const;

/** O pedido a mandar para a vista 3D. */
export function buildHandoff(
  imageID: string,
  recipe: Recipe,
  space: { lm: Landmarks; roll: Roll; lungs: LungMask | null }
): Handoff {
  const { lm, roll } = space;
  // giro só existe quando a receita está nos eixos do paciente
  const angle = recipe.alinhamento === 'paciente' ? roll.angle : 0;
  const toWorld = (p: Vec3) => rotateXY(p, roll.center, angle);
  const toWorldDir = (v: Vec3) => rotateXY(v, [0, 0], angle);
  const toPatient = (p: Vec3) => rotateXY(p, roll.center, -angle);
  const frame = frameOf(recipe, lm);
  const look = viewDirection(frame);
  const center: Vec3 = [0, 1, 2].map(
    (a) =>
      frame.origin[a] +
      (frame.u[a] * frame.width) / 2 +
      (frame.v[a] * frame.height) / 2
  ) as Vec3;
  const whole = recipe.isolar === 'pulmoes';
  const axis = NORMAL_AXIS[recipe.plano];
  const box = [0, 1, 2].map((a) => [
    lm.body[0][a] - MARGIN,
    lm.body[1][a] + MARGIN,
  ]) as [number, number][];
  if (!whole) box[axis] = keptRange(recipe, lm, look[axis]);
  const crop: CropRequest = {
    Sagittal: box[0],
    Coronal: box[1],
    Axial: box[2],
    rotation: angle
      ? rotationAbout([roll.center[0], roll.center[1], 0], [0, 0, 1], angle)
      : null,
  };
  const lungs = whole ? space.lungs : null;
  return {
    imageID,
    camera: {
      focalPoint: toWorld(center),
      direction: toWorldDir(look),
      viewUp: toWorldDir([-frame.v[0], -frame.v[1], -frame.v[2]]),
    },
    crop: whole ? null : crop,
    palette: paletteFor(recipe),
    background: recipe.fundo,
    keepOnly: lungs
      ? (x, y, z) => {
          const p = toPatient([x, y, z]);
          return inLungs(lungs, p[0], p[1], p[2]);
        }
      : null,
  };
}

export const cropAxes = AXIS_NAME;

/**
 * Manda a imagem para a vista 3D. Devolve um aviso se não der (o layout sem
 * vista 3D), ou null.
 */
export function handOff(
  imageID: string,
  recipe: Recipe,
  space: { vol: WorldVolume; lm: Landmarks; roll: Roll }
): string | null {
  if (!useViewStore().visibleViews.some((view) => view.type === '3D'))
    return 'Este layout não tem vista 3D. Escolha um layout com 3D e tente de novo.';
  sendToView(
    buildHandoff(imageID, recipe, {
      lm: space.lm,
      roll: space.roll,
      lungs: recipe.isolar === 'pulmoes' ? lungMaskOf(space.vol) : null,
    })
  );
  return null;
}
