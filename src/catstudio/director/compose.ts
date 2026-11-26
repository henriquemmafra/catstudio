/**
 * CatStudio — diretor de arte: monta a imagem final num canvas (o corte, as
 * letras de orientação, a régua e a legenda) e o localizador com a linha do
 * corte. É o que vai para o PNG.
 */
import {
  toGray,
  type CutJob,
  type Locator,
} from '@/src/catstudio/director/cut';
import type { Recipe } from '@/src/catstudio/director/recipe';
import { isLight } from '@/src/catstudio/valveLook';

const PAD = 34;
const CAPTION = 30;

function imageCanvas(job: Locator, recipe: Recipe) {
  const { width, height } = job.image;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const pixels = new ImageData(width, height);
  pixels.data.set(toGray(job.image, recipe));
  canvas.getContext('2d')!.putImageData(pixels, 0, 0);
  return canvas;
}

/** Ampliação inteira para a imagem final ter por volta de 1100 px no lado maior. */
export function outputScale(width: number, height: number) {
  return Math.min(3, Math.max(1, Math.round(1100 / Math.max(width, height))));
}

/** Comprimento redondo (mm) para a régua: perto de um quinto da largura. */
export function rulerLength(widthMm: number) {
  const options = [10, 20, 50, 100];
  return options.reduce((best, mm) => (mm <= widthMm / 4 ? mm : best), 10);
}

export function drawCut(
  canvas: HTMLCanvasElement,
  job: CutJob,
  recipe: Recipe,
  caption: string
) {
  const { width, height, pixel } = job.image;
  const scale = outputScale(width, height);
  const w = width * scale;
  const h = height * scale;
  canvas.width = w + 2 * PAD;
  canvas.height = h + 2 * PAD + CAPTION;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = recipe.fundo;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(imageCanvas(job, recipe), PAD, PAD, w, h);

  const ink = isLight(recipe.fundo) ? '#111111' : '#f2f2f2';
  ctx.fillStyle = ink;
  ctx.strokeStyle = ink;
  ctx.font = '600 20px Roboto, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const { labels } = job.frame;
  ctx.fillText(labels.left, PAD / 2, PAD + h / 2);
  ctx.fillText(labels.right, PAD + w + PAD / 2, PAD + h / 2);
  ctx.fillText(labels.top, PAD + w / 2, PAD / 2);
  ctx.fillText(labels.bottom, PAD + w / 2, PAD + h + PAD / 2);

  // régua
  const mm = rulerLength(width * pixel);
  const length = (mm / pixel) * scale;
  const y = PAD + h + PAD + CAPTION / 2;
  const x1 = PAD + w;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x1 - length, y);
  ctx.lineTo(x1, y);
  ctx.moveTo(x1 - length, y - 5);
  ctx.lineTo(x1 - length, y + 5);
  ctx.moveTo(x1, y - 5);
  ctx.lineTo(x1, y + 5);
  ctx.stroke();
  ctx.font = '14px Roboto, Arial, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(`${mm / 10} cm`, x1 - length - 8, y);

  // legenda, encolhida para caber ao lado da régua
  ctx.textAlign = 'left';
  const room = w - length - 70;
  let size = 15;
  ctx.font = `${size}px Roboto, Arial, sans-serif`;
  while (size > 10 && ctx.measureText(caption).width > room) {
    size -= 1;
    ctx.font = `${size}px Roboto, Arial, sans-serif`;
  }
  ctx.fillText(caption, PAD, y, room);
}

export function drawLocator(
  canvas: HTMLCanvasElement,
  locator: Locator,
  recipe: Recipe,
  line: { vertical: boolean; at: number } | null
) {
  const { width, height } = locator.image;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(imageCanvas(locator, recipe), 0, 0);
  if (!line) return;
  ctx.strokeStyle = '#ffd166';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  if (line.vertical) {
    ctx.moveTo(line.at, 0);
    ctx.lineTo(line.at, height);
  } else {
    ctx.moveTo(0, line.at);
    ctx.lineTo(width, line.at);
  }
  ctx.stroke();
}
