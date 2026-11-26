/**
 * CatStudio — plano de um corte do volume, no espaço do paciente, para a
 * fatia espessa (MIP/MinIP) acompanhar o corte exibido.
 */
type Index = [number, number, number];

interface IndexToWorld {
  indexToWorld(index: Index): ArrayLike<number>;
}

/** Origem (centro do corte na origem dos outros eixos) e normal unitária. */
export function slicePlane(
  image: IndexToWorld,
  ijkAxis: number,
  slice: number
) {
  const at = (value: number) => {
    const index: Index = [0, 0, 0];
    index[ijkAxis] = value;
    return image.indexToWorld(index);
  };
  const origin = at(slice);
  const next = at(slice + 1);
  const normal = [
    next[0] - origin[0],
    next[1] - origin[1],
    next[2] - origin[2],
  ];
  const length = Math.hypot(normal[0], normal[1], normal[2]) || 1;
  return {
    origin: [origin[0], origin[1], origin[2]],
    normal: normal.map((n) => n / length),
  };
}
