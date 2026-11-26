import { describe, expect, it } from 'vitest';
import { KIND, type ValveMesh } from '../valve';
import {
  DEFAULT_LIGHT,
  createValveRenderer,
  lightVector,
  type ValveLight,
  type ValveView,
} from '../valveRender';
import {
  defaultLook,
  describeDirection,
  isLight,
  parseColor,
  sanitizeLook,
} from '../valveLook';

const SIZE = 160;
const ZOOM = 3; // pixels por mm
const C = SIZE / 2;

/**
 * Cena de teste: um piso de 40 × 40 mm em z = −5 mm e, 10 mm à frente dele,
 * um quadrado de 8 × 8 mm. Com luz a 45° de altura, a sombra do quadrado cai
 * no piso 10 mm (30 pixels) para o lado oposto ao da luz.
 */
function scene(): ValveMesh {
  const quad = (half: number, z: number) => [
    [-half, -half, z],
    [half, -half, z],
    [half, half, z],
    [-half, half, z],
  ];
  const corners = [...quad(20, -5), ...quad(4, 5)];
  return {
    positions: new Float32Array(corners.flat()),
    normals: new Float32Array(corners.flatMap(() => [0, 0, 1])),
    kinds: new Uint8Array(8).fill(KIND.leaflet),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]),
  };
}

const view = (extra: Partial<ValveView> = {}): ValveView => ({
  spin: 0,
  tilt: 0,
  flip: false,
  rot: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  zoom: ZOOM,
  style: 'solid',
  ...extra,
});

const light = (extra: Partial<ValveLight> = {}): ValveLight => ({
  ...DEFAULT_LIGHT,
  height: 45,
  ...extra,
});

/** Brilho médio (0–255) de um quadrado de 9 × 9 pixels. */
function brightness(rgba: Uint8ClampedArray, x: number, y: number) {
  let sum = 0;
  for (let dy = -4; dy <= 4; dy++)
    for (let dx = -4; dx <= 4; dx++) {
      const o = 4 * (x + dx + SIZE * (y + dy));
      sum += (rgba[o] + rgba[o + 1] + rgba[o + 2]) / 3;
    }
  return sum / 81;
}

const draw = (extra: Partial<ValveView>) =>
  createValveRenderer(SIZE, SIZE).draw(scene(), view(extra)).slice();

describe('modo Valvas: cor do fundo', () => {
  const corner = (rgba: Uint8ClampedArray, y: number) =>
    Array.from(rgba.slice(4 * (2 + SIZE * y), 4 * (2 + SIZE * y) + 3));

  it('sem cor escolhida mantém o azul-escuro padrão', () => {
    const rgba = draw({});
    expect(corner(rgba, 0)).toEqual([3, 8, 16]);
    const bottom = corner(rgba, SIZE - 1);
    expect(bottom[2]).toBeGreaterThan(bottom[0]);
    expect(bottom[2]).toBeLessThan(45);
  });

  it('usa a cor escolhida, com o alto um pouco mais escuro', () => {
    const rgba = draw({ background: [255, 255, 255] });
    expect(corner(rgba, SIZE - 1).every((c) => c >= 253)).toBe(true);
    expect(corner(rgba, 0)).toEqual([217, 217, 217]);
  });

  it('preto fica preto de alto a baixo', () => {
    const rgba = draw({ background: [0, 0, 0] });
    expect(corner(rgba, 0)).toEqual([0, 0, 0]);
    expect(corner(rgba, SIZE - 1)).toEqual([0, 0, 0]);
  });

  it('vale também para o holograma', () => {
    const rgba = draw({ style: 'holo', background: [10, 60, 20] });
    expect(corner(rgba, SIZE - 1)[1]).toBeGreaterThan(55);
  });

  it('não muda a cor do tecido', () => {
    const dark = draw({ background: [0, 0, 0] });
    const white = draw({ background: [255, 255, 255] });
    expect(brightness(white, C, C)).toBeCloseTo(brightness(dark, C, C), 5);
  });
});

describe('modo Valvas: direção da luz e sombra', () => {
  // ponto do piso 30 px à direita / à esquerda do centro, fora do quadrado
  const RIGHT = C + 30;
  const LEFT = C - 30;

  it('luz da esquerda joga a sombra para a direita', () => {
    const lit = draw({ light: light({ direction: 270, shadow: 0 }) });
    const shaded = draw({ light: light({ direction: 270 }) });
    expect(brightness(shaded, RIGHT, C)).toBeLessThan(
      0.6 * brightness(lit, RIGHT, C)
    );
    // do outro lado o piso continua iluminado
    expect(brightness(shaded, LEFT, C)).toBeCloseTo(
      brightness(lit, LEFT, C),
      0
    );
  });

  it('luz da direita joga a sombra para a esquerda', () => {
    const lit = draw({ light: light({ direction: 90, shadow: 0 }) });
    const shaded = draw({ light: light({ direction: 90 }) });
    expect(brightness(shaded, LEFT, C)).toBeLessThan(
      0.6 * brightness(lit, LEFT, C)
    );
    expect(brightness(shaded, RIGHT, C)).toBeCloseTo(
      brightness(lit, RIGHT, C),
      0
    );
  });

  it('luz de cima joga a sombra para baixo', () => {
    const lit = draw({ light: light({ direction: 0, shadow: 0 }) });
    const shaded = draw({ light: light({ direction: 0 }) });
    expect(brightness(shaded, C, C + 30)).toBeLessThan(
      0.6 * brightness(lit, C, C + 30)
    );
  });

  it('luz mais baixa alonga a sombra', () => {
    // a 45° a sombra vai até ~42 px do centro; a 20°, o centro dela fica a
    // ~82 px, fora do piso — em 60 px só a luz baixa escurece
    const far = C + 55;
    const high = draw({ light: light({ direction: 270, height: 45 }) });
    const low = draw({ light: light({ direction: 270, height: 25 }) });
    const open = draw({
      light: light({ direction: 270, height: 25, shadow: 0 }),
    });
    expect(brightness(low, far, C)).toBeLessThan(
      0.7 * brightness(open, far, C)
    );
    const highOpen = draw({
      light: light({ direction: 270, height: 45, shadow: 0 }),
    });
    expect(brightness(high, far, C)).toBeCloseTo(
      brightness(highOpen, far, C),
      0
    );
  });

  it('a força da sombra gradua o escurecimento', () => {
    const at = (shadow: number) =>
      brightness(draw({ light: light({ direction: 270, shadow }) }), RIGHT, C);
    const [none, half, full] = [at(0), at(0.5), at(1)];
    expect(half).toBeLessThan(none - 5);
    expect(full).toBeLessThan(half - 5);
  });

  it('a intensidade da luz clareia e escurece o tecido', () => {
    const at = (intensity: number) =>
      brightness(draw({ light: light({ intensity }) }), C, C);
    expect(at(0.3)).toBeLessThan(at(1) - 10);
    expect(at(2)).toBeGreaterThan(at(1) + 10);
  });

  it('a luz padrão dos controles reproduz a luz original', () => {
    const original = draw({});
    const viaControls = draw({ light: { ...DEFAULT_LIGHT } });
    let total = 0;
    for (let i = 0; i < original.length; i++)
      total += Math.abs(original[i] - viaControls[i]);
    expect(total / original.length).toBeLessThan(1.5);
  });

  it('lightVector é unitário e segue o relógio', () => {
    const top = lightVector(0, 45);
    expect(Math.hypot(top[0], top[1], top[2])).toBeCloseTo(1);
    expect(top[1]).toBeLessThan(0); // y da tela cresce para baixo
    expect(lightVector(90, 45)[0]).toBeGreaterThan(0);
    expect(lightVector(270, 45)[0]).toBeLessThan(0);
    // altura fora da faixa é limitada (nunca luz no plano da tela)
    expect(lightVector(0, 0)[2]).toBeGreaterThan(0.2);
  });
});

describe('modo Valvas: aparência guardada', () => {
  it('lê cores #rrggbb e recusa o resto', () => {
    expect(parseColor('#ff8000')).toEqual([255, 128, 0]);
    expect(parseColor('')).toBeUndefined();
    expect(parseColor('red')).toBeUndefined();
    expect(parseColor('#fff')).toBeUndefined();
  });

  it('distingue fundo claro de escuro', () => {
    expect(isLight('#ffffff')).toBe(true);
    expect(isLight('#000000')).toBe(false);
    expect(isLight('')).toBe(false);
  });

  it('valores guardados inválidos voltam ao padrão ou à faixa', () => {
    expect(sanitizeLook(null)).toEqual(defaultLook());
    expect(sanitizeLook('x')).toEqual(defaultLook());
    const look = sanitizeLook({
      background: 'javascript:alert(1)',
      light: { direction: -90, height: 500, intensity: 'forte', shadow: -2 },
    });
    expect(look.background).toBe('');
    expect(look.light).toEqual({
      direction: 270,
      height: 85,
      intensity: 1,
      shadow: 0,
    });
  });

  it('mantém uma escolha válida', () => {
    const saved = {
      background: '#FFFFFF',
      light: { direction: 45, height: 30, intensity: 1.5, shadow: 0.4 },
    };
    expect(sanitizeLook(saved)).toEqual({
      background: '#ffffff',
      light: saved.light,
    });
  });

  it('descreve de onde a luz vem', () => {
    expect(describeDirection(0)).toBe('de cima');
    expect(describeDirection(90)).toBe('da direita');
    expect(describeDirection(322)).toBe('de cima, à esquerda');
    expect(describeDirection(355)).toBe('de cima');
  });
});
