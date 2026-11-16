import { describe, expect, it } from 'vitest';
import {
  agatston,
  assignIsland,
  assignVoxels,
  buildCalciumResult,
  cacDrsClass,
  densityFactor,
  findIslands,
  mesaPercentile,
  rowForAge,
  MESA_WHITE,
  type CalciumVolume,
} from '..';

function makeVolume(
  cols = 20,
  rows = 20,
  slices = 4,
  spacing = 3
): CalciumVolume {
  return {
    hu: new Int16Array(cols * rows * slices).fill(40),
    cols,
    rows,
    slices,
    pixelSpacing: [0.5, 0.5],
    sliceSpacing: spacing,
    sliceThickness: spacing,
    kvp: 120,
  };
}
const idx = (v: CalciumVolume, x: number, y: number, z: number) =>
  z * v.cols * v.rows + y * v.cols + x;
function paint(
  v: CalciumVolume,
  x0: number,
  y0: number,
  z: number,
  w: number,
  h: number,
  value: number
) {
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w; x++) v.hu[idx(v, x, y, z)] = value;
}

describe('CAC-DRS', () => {
  it('faixas corretas, incluindo 300 = A3', () => {
    expect(cacDrsClass(0)).toBe('A0');
    expect(cacDrsClass(1)).toBe('A1');
    expect(cacDrsClass(99)).toBe('A1');
    expect(cacDrsClass(100)).toBe('A2');
    expect(cacDrsClass(299)).toBe('A2');
    expect(cacDrsClass(300)).toBe('A3');
  });
});

describe('Agatston', () => {
  it('fator de densidade pelo pico', () => {
    expect(
      [129, 130, 199, 200, 299, 300, 399, 400, 900].map(densityFactor)
    ).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4]);
  });

  it('área × fator, por vaso, em 3 mm', () => {
    const v = makeVolume();
    // lesão 4x4 px = 16 × 0,25 mm² = 4 mm², pico 350 → fator 3 → 12
    paint(v, 2, 2, 1, 4, 4, 250);
    v.hu[idx(v, 3, 3, 1)] = 350;
    const labels = new Uint8Array(v.hu.length);
    const { map, islands } = findIslands(v);
    expect(islands).toHaveLength(1);
    assignIsland(labels, map, islands[0]!.id, 'DA');
    const r = agatston(v, labels);
    expect(r.perVessel.DA).toBeCloseTo(12);
    expect(r.total).toBeCloseTo(12);
    expect(r.warnings).toEqual([]);
  });

  it('ignora lesão menor que 1 mm² (ruído)', () => {
    const v = makeVolume();
    paint(v, 10, 10, 2, 1, 3, 500); // 3 px = 0,75 mm²
    const { islands } = findIslands(v);
    expect(islands).toHaveLength(0);
    const labels = new Uint8Array(v.hu.length).fill(2);
    expect(agatston(v, labels).total).toBe(0);
  });

  it('laço: corta parte da lesão e reatribui (TCE → DA)', () => {
    const v = makeVolume();
    paint(v, 2, 2, 1, 8, 2, 450); // 16 px = 4 mm², fator 4 → 16
    const labels = new Uint8Array(v.hu.length);
    const { map, islands } = findIslands(v);
    assignIsland(labels, map, islands[0]!.id, 'TCE');
    // médico circula a metade direita (x 6..9) e atribui à DA
    const lasso: number[] = [];
    for (let y = 2; y < 4; y++)
      for (let x = 6; x < 10; x++) lasso.push(idx(v, x, y, 1));
    assignVoxels(labels, lasso, 'DA');
    const r = agatston(v, labels);
    expect(r.perVessel.TCE).toBeCloseTo(8);
    expect(r.perVessel.DA).toBeCloseTo(8);
    // e exclui a parte da DA
    assignVoxels(labels, lasso, null);
    expect(agatston(v, labels).perVessel.DA).toBe(0);
  });

  it('pico recalculado depois do corte parcial', () => {
    const v = makeVolume();
    paint(v, 2, 2, 1, 4, 4, 180); // fator 1
    paint(v, 2, 2, 1, 1, 1, 500); // 1 voxel muito denso → fator 4
    const labels = new Uint8Array(v.hu.length);
    const { map, islands } = findIslands(v);
    assignIsland(labels, map, islands[0]!.id, 'CX');
    expect(agatston(v, labels).perVessel.CX).toBeCloseTo(16); // 4 mm² × 4
    assignVoxels(labels, [idx(v, 2, 2, 1)], null);
    expect(agatston(v, labels).perVessel.CX).toBeCloseTo(3.75); // 15 px × 0,25 × fator 1
  });

  it('cortes sobrepostos de 1,5 mm: corrige e avisa', () => {
    const v = makeVolume(20, 20, 4, 1.5);
    paint(v, 2, 2, 1, 4, 4, 250);
    paint(v, 2, 2, 2, 4, 4, 250);
    const labels = new Uint8Array(v.hu.length);
    const { map, islands } = findIslands(v);
    assignIsland(labels, map, islands[0]!.id, 'CD');
    const r = agatston(v, labels);
    expect(r.perVessel.CD).toBeCloseTo(8); // (4 + 4) mm² × 2 × 0,5
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe('Resultado do escore', () => {
  it('total = soma dos vasos arredondados; classe no total arredondado', () => {
    const r = buildCalciumResult(
      { TCE: 0, DA: 60.4, CX: 39.4, CD: 0 },
      { ageYears: 60, sex: 'M' }
    );
    expect(r.perVessel).toEqual({ TCE: 0, DA: 60, CX: 39, CD: 0 });
    expect(r.total).toBe(99);
    expect(r.cacDrs).toBe('A1');
    expect(r.vesselCount).toBe(2);
  });
});

describe('MESA (coorte branca)', () => {
  it('fora de 45–84, sem sexo ou escore zero → sem percentil', () => {
    expect(mesaPercentile(50, 44, 'M').percentile).toBeNull();
    expect(mesaPercentile(50, 85, 'F').percentile).toBeNull();
    expect(mesaPercentile(50, 60, undefined).percentile).toBeNull();
    expect(mesaPercentile(0, 60, 'M').percentile).toBeNull();
  });

  it('reproduz exatamente as âncoras da tabela (homem 60 anos)', () => {
    expect(mesaPercentile(28, 60, 'M').percentile).toBe(50);
    expect(mesaPercentile(155, 60, 'M').percentile).toBe(75);
    expect(mesaPercentile(452, 60, 'M').percentile).toBe(90);
  });

  it('qualquer escore > 0 fica acima de todos os zeros', () => {
    // homem 50: 59% com zero → escore 1 já é ≥ percentil 59
    expect(mesaPercentile(1, 50, 'M').percentile!).toBeGreaterThanOrEqual(59);
  });

  it('monotônico no escore e limitado a 99', () => {
    let last = 0;
    for (const s of [1, 5, 10, 50, 100, 400, 1000, 3000, 10000]) {
      const p = mesaPercentile(s, 65, 'M').percentile!;
      expect(p).toBeGreaterThanOrEqual(last);
      expect(p).toBeLessThanOrEqual(99);
      last = p;
    }
  });

  it('mulher 45 anos (sem âncoras positivas) ainda calcula, marcado como aproximado', () => {
    const r = mesaPercentile(10, 45, 'F');
    expect(r.percentile!).toBeGreaterThanOrEqual(93);
    expect(r.approximate).toBe(true);
  });

  it('interpola idades intermediárias nas mulheres', () => {
    const r = rowForAge(MESA_WHITE.F, 62);
    expect(r.pPos).toBeGreaterThan(0.36);
    expect(r.pPos).toBeLessThan(0.47);
  });
});
