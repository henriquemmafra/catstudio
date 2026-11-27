/**
 * CatStudio — escultura do 3D: crescer a partir de um ponto.
 *
 * Enquanto o botão fica apertado, a seleção avança camada por camada a
 * partir do voxel clicado, seguindo o que é contínuo e denso (um vaso
 * contrastado, por exemplo). Soltar o botão para o crescimento: quanto mais
 * tempo, mais longe ao longo da estrutura.
 */
import {
  type Fill,
  type Grid,
  newFill,
  seedFill,
  visitNeighbours,
} from './mask';

export interface Grower {
  fill: Fill;
  /** início da camada mais recente na fila */
  head: number;
  /** true: sobra só o que cresceu; false: o que cresceu é apagado */
  keep: boolean;
  /** onde o crescimento é pintado, e com que valor */
  target: Uint8Array;
  value: number;
}

export interface GrowOptions {
  threshold: number;
  keep: boolean;
  /** pinta 1 nesta máscara (destaque) em vez de mexer no que está escondido */
  into?: Uint8Array;
}

/**
 * Começa a crescer em `seed`. Devolve null se o voxel não é estrutura
 * visível. A máscara de `grid` passa a refletir o resultado a cada passo.
 */
export function startGrow(
  grid: Grid,
  seed: number,
  options: GrowOptions
): Grower | null {
  const fill = newFill(grid, options.threshold);
  // o que estava escondido antes continua barrando o caminho, mesmo que a
  // máscara mude durante o crescimento
  fill.blocked = grid.hidden.slice();
  if (!seedFill(fill, seed)) return null;
  const into = options.into ?? null;
  if (options.keep && !into) grid.hidden.fill(1);
  const grower: Grower = {
    fill,
    head: 0,
    keep: options.keep,
    target: into ?? grid.hidden,
    value: into || !options.keep ? 1 : 0,
  };
  paint(grower, 0);
  return grower;
}

function paint(grower: Grower, from: number) {
  const { queue } = grower.fill;
  const { target, value } = grower;
  for (let n = from; n < queue.length; n++) target[queue.data[n]] = value;
}

/** Avança `layers` camadas. Devolve o tamanho da seleção em voxels. */
export function growLayers(grower: Grower, layers: number): number {
  const { queue } = grower.fill;
  const before = queue.length;
  for (let layer = 0; layer < layers; layer++) {
    const end = queue.length;
    for (let n = grower.head; n < end; n++)
      visitNeighbours(grower.fill, queue.data[n]);
    grower.head = end;
  }
  paint(grower, before);
  return queue.length;
}

export const grownVoxels = (grower: Grower) => grower.fill.queue.length;
