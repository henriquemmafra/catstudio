/**
 * CatStudio — luz principal do modo Valvas: de onde vem, altura, intensidade
 * e força da sombra projetada.
 */
export interface ValveLight {
  /**
   * De onde a luz vem, em graus, como num relógio visto pelo observador:
   * 0 = de cima, 90 = da direita, 180 = de baixo, 270 = da esquerda. A sombra
   * cai para o lado oposto.
   */
  direction: number;
  /**
   * Altura da luz, em graus acima do plano da tela: 90 = de frente (junto do
   * observador, quase sem sombra), valores baixos = luz rasante, sombra longa.
   */
  height: number;
  /** Intensidade da luz principal; 1 = padrão. */
  intensity: number;
  /** Força da sombra projetada: 0 = sem sombra, 1 = padrão. */
  shadow: number;
}

export const LIGHT_LIMITS = {
  height: [15, 85],
  intensity: [0.3, 2],
  shadow: [0, 1],
} as const;

/** A luz padrão (de cima, à esquerda, vinda do observador). */
export const DEFAULT_LIGHT: ValveLight = Object.freeze({
  direction: 322,
  height: 54,
  intensity: 1,
  shadow: 1,
});

export const clampTo = (value: number, [min, max]: readonly [number, number]) =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));

/** Vetor unitário que aponta da cena para a luz (x direita, y baixo, z observador). */
export function lightVector(direction: number, height: number): number[] {
  const d = (direction * Math.PI) / 180;
  const e = (clampTo(height, LIGHT_LIMITS.height) * Math.PI) / 180;
  return [Math.sin(d) * Math.cos(e), -Math.cos(d) * Math.cos(e), Math.sin(e)];
}

/** Base do mapa de sombras: dois eixos perpendiculares à direção da luz. */
export function lightBasis(key: ArrayLike<number>) {
  const l = Math.hypot(key[2], key[0]);
  const la = [key[2] / l, 0, -key[0] / l];
  const lb = [
    key[1] * la[2] - key[2] * la[1],
    key[2] * la[0] - key[0] * la[2],
    key[0] * la[1] - key[1] * la[0],
  ];
  return { la, lb };
}
