import { describe, it, expect } from 'vitest';
import {
  PALETTES,
  type Stop,
  colorPoints,
  gradientCss,
  opacityAt,
  opacityNodes,
  parseHex,
  sanitizePalette,
  sortedStops,
  tweaked,
} from '../palette';
import { displayPresetName, PRESET_PREFIX } from '../paletteStore';
import { draggedTweak } from '../useWindowDrag';

const STOPS: Stop[] = [
  { name: 'Mole', hu: 100, color: '#000000', opacity: 0 },
  { name: 'Vaso', hu: 300, color: '#ff0000', opacity: 0.5 },
  { name: 'Osso', hu: 700, color: '#ffffff', opacity: 1 },
];
const RANGE: [number, number] = [-1000, 2000];

describe('paletas por tecido', () => {
  it('as paletas prontas são válidas e ordenadas', () => {
    PALETTES.forEach((palette) => {
      expect(palette.stops.length).toBeGreaterThanOrEqual(2);
      expect(sortedStops(palette.stops)).toEqual(palette.stops);
      palette.stops.forEach((item) => {
        expect(item.color).toMatch(/^#[0-9a-f]{6}$/);
        expect(item.opacity).toBeGreaterThanOrEqual(0);
        expect(item.opacity).toBeLessThanOrEqual(1);
      });
    });
    expect(new Set(PALETTES.map((p) => p.id)).size).toBe(PALETTES.length);
  });

  it('os pontos de cor cobrem exatamente a faixa do exame', () => {
    const points = colorPoints(STOPS, RANGE);
    expect(points.length).toBe(5 * 4);
    expect(points.slice(0, 4)).toEqual([-1000, 0, 0, 0]);
    expect(points.slice(8, 12)).toEqual([300, 1, 0, 0]);
    expect(points.slice(16)).toEqual([2000, 1, 1, 1]);
  });

  it('ponto fora da faixa do exame não entra, mas a cor da ponta vale', () => {
    const points = colorPoints(STOPS, [-1000, 500]);
    expect(points.length).toBe(4 * 4);
    expect(points.slice(12)).toEqual([500, 1, 0, 0]);
    // exame todo abaixo da paleta: fica a cor do primeiro ponto
    expect(colorPoints(STOPS, [-1000, 50]).slice(4, 8)).toEqual([100, 0, 0, 0]);
  });

  it('a opacidade é transparente antes do primeiro ponto e reta entre eles', () => {
    expect(opacityAt(STOPS, 50)).toBe(0);
    expect(opacityAt(STOPS, 200)).toBeCloseTo(0.25);
    expect(opacityAt(STOPS, 500)).toBeCloseTo(0.75);
    expect(opacityAt(STOPS, 3000)).toBe(1);
    const nodes = opacityNodes(STOPS, RANGE);
    expect(nodes[0]).toMatchObject({ x: 0, y: 0 });
    expect(nodes[2].x).toBeCloseTo(1300 / 3000);
    expect(nodes[2].y).toBe(0.5);
    expect(nodes[nodes.length - 1]).toMatchObject({ x: 1, y: 1 });
  });

  it('a faixa cortada no meio de uma rampa termina no valor da rampa', () => {
    const nodes = opacityNodes(STOPS, [-1000, 500]);
    expect(nodes[nodes.length - 1].y).toBeCloseTo(0.75);
  });

  it('o ajuste rápido desloca os pontos e escala a opacidade', () => {
    const moved = tweaked(
      { id: 'x', title: 'x', stops: STOPS },
      { shift: -50, gain: 3 }
    );
    expect(moved.map((s) => s.hu)).toEqual([50, 250, 650]);
    expect(moved.map((s) => s.opacity)).toEqual([0, 1, 1]);
  });

  it('os dois botões: para baixo sobe a densidade, para a direita dobra', () => {
    const tweak = draggedTweak({ shift: 0, gain: 1 }, 220, 100);
    expect(tweak.shift).toBe(200);
    expect(tweak.gain).toBeCloseTo(2);
    expect(draggedTweak({ shift: 0, gain: 1 }, -220, 0).gain).toBeCloseTo(0.5);
  });

  it('conserta paleta estragada do armazenamento ou recusa', () => {
    expect(sanitizePalette(null)).toBeNull();
    expect(sanitizePalette({ title: 'x', stops: [STOPS[0]] })).toBeNull();
    const fixed = sanitizePalette({
      title: 'Minha',
      stops: [
        { hu: 500, color: 'vermelho', opacity: 9 },
        { hu: 100.4, color: '#ABCDEF', opacity: 0.2, name: 'a' },
        { hu: 'x' },
        { hu: 500, color: '#111111', opacity: 0.1 },
      ],
    })!;
    expect(fixed.own).toBe(true);
    expect(fixed.stops.map((s) => s.hu)).toEqual([100, 500]);
    expect(fixed.stops[0].color).toBe('#abcdef');
    expect(fixed.stops[1]).toMatchObject({ color: '#808080', opacity: 1 });
  });

  it('cores, degradê e nome mostrado na vista', () => {
    expect(parseHex('#ff8000')).toEqual([1, 128 / 255, 0]);
    expect(gradientCss(STOPS)).toContain('rgba(255, 0, 0, 0.50) 33.3%');
    expect(gradientCss([STOPS[0]])).toBe('none');
    expect(displayPresetName(`${PRESET_PREFIX}Vascular #12`)).toBe('Vascular');
    expect(displayPresetName('CT-AAA')).toBe('CT AAA');
  });
});
