import { describe, it, expect, beforeEach } from 'vitest';
import {
  SLAB_DEFAULT_THICKNESS,
  SLAB_MAX_THICKNESS,
  SLAB_MIN_THICKNESS,
  clearSlabs,
  resetSlabMemory,
  setSlab,
  setSlabThickness,
  slabFor,
  stepSlabThickness,
  toggleSlab,
} from '@/src/catstudio/slab';
import { slicePlane } from '@/src/catstudio/slabGeometry';

describe('slab: MIP/MinIP por vista', () => {
  beforeEach(resetSlabMemory);

  it('começa desligado', () => {
    expect(slabFor('a').mode).toBe('off');
  });

  it('alterna o modo e desliga ao repetir', () => {
    toggleSlab('a', 'max');
    expect(slabFor('a')).toEqual({
      mode: 'max',
      thickness: SLAB_DEFAULT_THICKNESS.max,
    });
    toggleSlab('a', 'min'); // troca direta de MIP para MinIP
    expect(slabFor('a').mode).toBe('min');
    toggleSlab('a', 'min');
    expect(slabFor('a').mode).toBe('off');
  });

  it('cada vista tem o seu estado', () => {
    toggleSlab('a', 'max');
    expect(slabFor('b').mode).toBe('off');
  });

  it('lembra a espessura escolhida para cada projeção', () => {
    toggleSlab('a', 'max');
    setSlabThickness('a', 25);
    toggleSlab('a', 'max');
    toggleSlab('b', 'max');
    expect(slabFor('b').thickness).toBe(25);
    toggleSlab('b', 'min');
    expect(slabFor('b').thickness).toBe(SLAB_DEFAULT_THICKNESS.min);
  });

  it('limita a espessura', () => {
    toggleSlab('a', 'max');
    setSlabThickness('a', 1e6);
    expect(slabFor('a').thickness).toBe(SLAB_MAX_THICKNESS);
    setSlabThickness('a', -3);
    expect(slabFor('a').thickness).toBe(SLAB_MIN_THICKNESS);
  });

  it('o passo cresce com a espessura e é reversível', () => {
    toggleSlab('a', 'max'); // 10 mm
    stepSlabThickness('a', 1);
    expect(slabFor('a').thickness).toBe(12.5);
    stepSlabThickness('a', -1);
    expect(slabFor('a').thickness).toBe(10);
    setSlabThickness('a', 20);
    stepSlabThickness('a', 1);
    expect(slabFor('a').thickness).toBe(25);
    stepSlabThickness('a', -1);
    stepSlabThickness('a', -1);
    expect(slabFor('a').thickness).toBe(17.5);
    setSlabThickness('a', 5);
    stepSlabThickness('a', -1);
    expect(slabFor('a').thickness).toBe(4);
  });

  it('clearSlabs desliga todas as vistas', () => {
    toggleSlab('a', 'max');
    setSlab('b', 'min');
    clearSlabs();
    expect(slabFor('a').mode).toBe('off');
    expect(slabFor('b').mode).toBe('off');
  });
});

describe('slab: plano do corte', () => {
  // volume oblíquo: eixo k inclinado, espaçamento 2,5 mm
  const direction = [0, 0.6, 0.8];
  const image = {
    indexToWorld: ([i, j, k]: [number, number, number]) => [
      10 + i * 0.8,
      20 + j * 0.8 + k * 2.5 * direction[1],
      30 + k * 2.5 * direction[2],
    ],
  };

  it('a origem fica no corte e a normal é o eixo do corte, unitária', () => {
    const { origin, normal } = slicePlane(image, 2, 4);
    expect(origin).toEqual([10, 20 + 4 * 2.5 * 0.6, 30 + 4 * 2.5 * 0.8]);
    normal.forEach((n, axis) => expect(n).toBeCloseTo(direction[axis]));
    expect(Math.hypot(...normal)).toBeCloseTo(1);
  });

  it('vale para os outros eixos', () => {
    const { origin, normal } = slicePlane(image, 0, 10);
    expect(origin).toEqual([18, 20, 30]);
    expect(normal).toEqual([1, 0, 0]);
  });
});
