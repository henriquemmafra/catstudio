import { describe, it, expect } from 'vitest';
import { rotatePlane, screenRotation } from '../cropRotation';
import { DIRECTOR_PALETTES, tweaked } from '../palette';

type V = [number, number, number];
const AXES: [V, V, V] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];
const turn = (m: number[], v: V) =>
  rotatePlane({ origin: [0, 0, 0], normal: v }, m).normal;
const close = (a: number[], b: number[]) =>
  a.forEach((x, n) => expect(x).toBeCloseTo(b[n], 5));

describe('caixa de frente para a tela', () => {
  it('câmera torta: cada eixo da caixa vai para um eixo da tela', () => {
    const s = Math.SQRT1_2;
    // olhando de frente, girada 45° em torno do vertical
    const camera = { direction: [s, s, 0] as V, up: [0, 0, 1] as V };
    const m = screenRotation(camera, AXES, [0, 0, 0]);
    const along = AXES.map((a) => turn(m, a));
    // um dos eixos fica na linha de visão; o vertical continua vertical
    const depth = along.map((v) => Math.abs(v[0] * s + v[1] * s));
    expect(Math.max(...depth)).toBeCloseTo(1);
    close(along[2], [0, 0, 1]);
  });

  it('já de frente: não gira nada', () => {
    const m = screenRotation(
      { direction: [0, 1, 0], up: [0, 0, 1] },
      AXES,
      [5, 5, 5]
    );
    AXES.forEach((a) => close(turn(m, a), a));
    close(
      rotatePlane({ origin: [5, 5, 5], normal: [1, 0, 0] }, m).origin,
      [5, 5, 5]
    );
  });

  it('nunca espelha (só giro de verdade)', () => {
    const m = screenRotation(
      { direction: [0.3, 0.9, -0.3], up: [0.1, 0.3, 0.95] },
      AXES,
      [0, 0, 0]
    );
    const [x, y, z] = AXES.map((a) => turn(m, a));
    const cross: V = [
      x[1] * y[2] - x[2] * y[1],
      x[2] * y[0] - x[0] * y[2],
      x[0] * y[1] - x[1] * y[0],
    ];
    close(cross, z);
  });
});

describe('cores do diretor no 3D', () => {
  it('quatro paletas, com opacidade por milímetro convertida', () => {
    expect(DIRECTOR_PALETTES.map((p) => p.id)).toEqual([
      'diretor-tecidos',
      'diretor-osso',
      'diretor-vasos',
      'diretor-pulmao',
    ]);
    const tecidos = DIRECTOR_PALETTES[0];
    expect(tecidos.stops[0].color).toMatch(/^#[0-9a-f]{6}$/);
    const stops = tweaked(tecidos, { shift: 0, gain: 1 }, true);
    // 0,7 por mm vira 1 − e^−0,7 ≈ 0,50 por mm
    expect(stops[stops.length - 1].opacity).toBeCloseTo(1 - Math.exp(-0.7));
  });
});
