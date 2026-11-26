/**
 * CatStudio — escultura do 3D: tirar a mesa e tudo o que está fora do corpo.
 *
 * O corpo é a maior estrutura de tecido do exame. A mesa, o colchão, o
 * travesseiro e os cabos encostam nele por contatos finos, então antes de
 * procurar a maior estrutura o tecido é "descascado" (erosão), o que solta
 * esses contatos; depois o corpo é engordado de volta até a pele. Tudo o que
 * sobra fora do contorno do corpo é escondido. O ar de dentro (pulmões,
 * traqueia, alças) fica: o "fora" é procurado corte a corte a partir da borda
 * da imagem, e em cada corte a traqueia está cercada de pescoço.
 */
import { type Dims, type Grid, flood, newFill } from './mask';

/** A partir daqui é tecido (HU); abaixo, ar, colchão e espuma. */
export const TISSUE_HU = -300;
/**
 * Uma camada só: solta contatos de até 2 voxels (roupa, lençol, cabo) sem
 * apagar uma parede torácica fina, que duas camadas levariam embora.
 */
export const PEEL_LAYERS = 1;
export const REGROW_LAYERS = 3;

interface Row {
  start: number;
  /** distância até a linha vizinha em cada sentido; 0 na borda do volume */
  near: [number, number, number, number];
}

/**
 * As linhas do volume com os vizinhos de cada uma. Na borda o vizinho que
 * falta é a própria linha: o exame acaba ali, o corpo não.
 */
function forEachRow(dims: Dims, visit: (row: Row) => void) {
  const [nx, ny, nz] = dims;
  const slice = nx * ny;
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      visit({
        start: nx * (j + ny * k),
        near: [
          j > 0 ? -nx : 0,
          j < ny - 1 ? nx : 0,
          k > 0 ? -slice : 0,
          k < nz - 1 ? slice : 0,
        ],
      });
}

/** Erosão de uma linha: fica quem tem os seis vizinhos marcados. */
function erodeRow(mask: Uint8Array, out: Uint8Array, row: Row, nx: number) {
  const [a, b, c, d] = row.near;
  const first = row.start;
  const last = first + nx - 1;
  for (let index = first; index <= last; index++)
    out[index] =
      mask[index] &
      mask[index + a] &
      mask[index + b] &
      mask[index + c] &
      mask[index + d];
  for (let index = first + 1; index < last; index++)
    out[index] &= mask[index - 1] & mask[index + 1];
  out[first] &= mask[first + 1];
  out[last] &= mask[last - 1];
}

/** Dilatação de uma linha: entra quem tem algum vizinho marcado. */
function dilateRow(mask: Uint8Array, out: Uint8Array, row: Row, nx: number) {
  const [a, b, c, d] = row.near;
  const first = row.start;
  const last = first + nx - 1;
  for (let index = first; index <= last; index++)
    out[index] =
      mask[index] |
      mask[index + a] |
      mask[index + b] |
      mask[index + c] |
      mask[index + d];
  for (let index = first + 1; index < last; index++)
    out[index] |= mask[index - 1] | mask[index + 1];
  out[first] |= mask[first + 1];
  out[last] |= mask[last - 1];
}

/** Tira uma camada da superfície de `mask`. */
export function erode(mask: Uint8Array, dims: Dims): Uint8Array {
  const out = new Uint8Array(mask.length);
  forEachRow(dims, (row) => erodeRow(mask, out, row, dims[0]));
  return out;
}

/** Acrescenta uma camada a `mask`. */
export function dilate(mask: Uint8Array, dims: Dims): Uint8Array {
  const out = new Uint8Array(mask.length);
  forEachRow(dims, (row) => dilateRow(mask, out, row, dims[0]));
  return out;
}

/** Acrescenta uma camada a `mask`, só onde `allowed` deixa. */
export function dilateWithin(
  mask: Uint8Array,
  allowed: Uint8Array,
  dims: Dims
): Uint8Array {
  const out = dilate(mask, dims);
  for (let index = 0; index < out.length; index++)
    out[index] = mask[index] | (out[index] & allowed[index]);
  return out;
}

/** A maior estrutura ligada de `mask` (vazia se não houver nenhuma). */
export function largestComponent(mask: Uint8Array, dims: Dims): Uint8Array {
  const grid: Grid = {
    dims,
    scalars: mask,
    hidden: new Uint8Array(mask.length),
  };
  const fill = newFill(grid, 1);
  let best = { seed: -1, count: 0 };
  for (let index = 0; index < mask.length; index++) {
    const count = flood(fill, index);
    if (count > best.count) best = { seed: index, count };
  }
  const out = new Uint8Array(mask.length);
  if (best.seed < 0) return out;
  const again = newFill(grid, 1);
  const count = flood(again, best.seed);
  for (let n = 0; n < count; n++) out[again.queue.data[n]] = 1;
  return out;
}

interface SliceFlood {
  body: Uint8Array;
  outside: Uint8Array;
  stack: Int32Array;
  size: number;
}

function seed(flooding: SliceFlood, index: number) {
  if (flooding.body[index] || flooding.outside[index]) return;
  flooding.outside[index] = 1;
  flooding.stack[flooding.size] = index;
  flooding.size += 1;
}

/** Marca, num corte, o que não é corpo e está ligado à borda da imagem. */
function floodSliceOutside(flooding: SliceFlood, dims: Dims, k: number) {
  const [nx, ny] = dims;
  const start = k * nx * ny;
  const end = start + nx * ny;
  for (let i = 0; i < nx; i++) {
    seed(flooding, start + i);
    seed(flooding, end - nx + i);
  }
  for (let j = 0; j < ny; j++) {
    seed(flooding, start + j * nx);
    seed(flooding, start + j * nx + nx - 1);
  }
  while (flooding.size) {
    flooding.size -= 1;
    const index = flooding.stack[flooding.size];
    const column = (index - start) % nx;
    if (column > 0) seed(flooding, index - 1);
    if (column < nx - 1) seed(flooding, index + 1);
    if (index - nx >= start) seed(flooding, index - nx);
    if (index + nx < end) seed(flooding, index + nx);
  }
}

function floodOutside(body: Uint8Array, dims: Dims): Uint8Array {
  const flooding: SliceFlood = {
    body,
    outside: new Uint8Array(body.length),
    stack: new Int32Array(dims[0] * dims[1]),
    size: 0,
  };
  for (let k = 0; k < dims[2]; k++) floodSliceOutside(flooding, dims, k);
  return flooding.outside;
}

/** Frestas no contorno do corpo mais estreitas que isto (×2) não vazam. */
export const SEAL_LAYERS = 2;

/**
 * 1 = fora do contorno do corpo, corte a corte. O contorno é engrossado antes
 * da busca, para o "fora" não entrar no pulmão por uma parede torácica fina
 * que a erosão tenha furado; depois o "fora" volta a encostar na pele.
 */
export function outsideOf(body: Uint8Array, dims: Dims): Uint8Array {
  let sealed: Uint8Array = body;
  for (let n = 0; n < SEAL_LAYERS; n++) sealed = dilate(sealed, dims);
  let outside = floodOutside(sealed, dims);
  const notBody = new Uint8Array(body.length);
  for (let index = 0; index < body.length; index++)
    notBody[index] = body[index] ^ 1;
  for (let n = 0; n < SEAL_LAYERS; n++)
    outside = dilateWithin(outside, notBody, dims);
  return outside;
}

/** A máscara do corpo (1 = corpo, com a pele). */
export function bodyMask(grid: Grid, tissue = TISSUE_HU): Uint8Array {
  const all = new Uint8Array(grid.hidden.length);
  for (let index = 0; index < all.length; index++)
    if (!grid.hidden[index] && grid.scalars[index] >= tissue) all[index] = 1;
  let core: Uint8Array = all;
  for (let n = 0; n < PEEL_LAYERS; n++) core = erode(core, grid.dims);
  let body: Uint8Array = largestComponent(core, grid.dims);
  for (let n = 0; n < REGROW_LAYERS; n++)
    body = dilateWithin(body, all, grid.dims);
  return body;
}

export interface TableResult {
  /** voxels escondidos agora */
  hidden: number;
  /** voxels de tecido (mesa, cabos, travesseiro) entre os escondidos */
  tissue: number;
  /** voxels do corpo */
  body: number;
}

/**
 * Esconde tudo o que está fora do corpo. Não faz nada (e devolve zeros) se
 * não achar um corpo.
 */
export function removeOutsideBody(grid: Grid, tissue = TISSUE_HU): TableResult {
  const body = bodyMask(grid, tissue);
  const result: TableResult = { hidden: 0, tissue: 0, body: 0 };
  for (let index = 0; index < body.length; index++) result.body += body[index];
  if (!result.body) return result;
  const outside = outsideOf(body, grid.dims);
  for (let index = 0; index < outside.length; index++) {
    if (!outside[index] || grid.hidden[index]) continue;
    grid.hidden[index] = 1;
    result.hidden += 1;
    if (grid.scalars[index] >= tissue) result.tissue += 1;
  }
  return result;
}
