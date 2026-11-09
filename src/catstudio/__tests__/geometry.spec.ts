import { describe, expect, it } from 'vitest';
import {
  CT,
  planForMetas,
  planStack,
  refineVolumes,
  splitStack,
  instanceInfo,
  type StackPlan,
} from '@/src/catstudio/geometry';
import { StackResampler } from '@/src/catstudio/resampler';

// Campo linear: a interpolação (bi)linear o reproduz exatamente, então a
// grade reamostrada tem de bater com o campo nas posições de saída.
const field = (p: number[]) => 3 * p[0] - 2 * p[1] + 5 * p[2] + 7;

const ROW = [1, 0, 0];
const COL = [0, 1, 0];

function tiltedStack(n: number, dz: number[], tiltDeg: number, cols = 20, rows = 16) {
  // cortes axiais deslocados em y proporcionalmente a z (gantry tilt)
  const tan = Math.tan((tiltDeg * Math.PI) / 180);
  const positions: number[][] = [];
  let z = -10;
  for (let k = 0; k < n; k++) {
    positions.push([-5, -4 + z * tan, z]);
    z += dz[k % dz.length];
  }
  return { positions, cols, rows, sx: 0.7, sy: 0.9 };
}

function sliceValues(p: number[], cols: number, rows: number, sx: number, sy: number) {
  const out = new Float64Array(cols * rows);
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++)
      out[j * cols + i] = field([p[0] + i * sx, p[1] + j * sy, p[2]]);
  return out;
}

function checkAgainstField(plan: StackPlan, out: Float64Array, fill: number) {
  const [nx, ny, nz] = plan.dims;
  const d = plan.direction;
  let checked = 0;
  let worst = 0;
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const v = out[k * nx * ny + j * nx + i];
        if (v === fill) continue;
        const x = i * plan.spacing[0];
        const y = j * plan.spacing[1];
        const z = k * plan.spacing[2];
        const p = [0, 1, 2].map(
          (a) => plan.origin[a] + x * d[a] + y * d[3 + a] + z * d[6 + a]
        );
        worst = Math.max(worst, Math.abs(v - field(p)));
        checked += 1;
      }
  return { checked, worst };
}

function resampleAll(
  plan: StackPlan,
  positions: number[][],
  cols: number,
  rows: number,
  sx: number,
  sy: number,
  order?: number[]
) {
  const [nx, ny, nz] = plan.dims;
  const out = new Float64Array(nx * ny * nz);
  const r = new StackResampler(plan, out, -9999);
  (order ?? positions.map((_, i) => i)).forEach((i) =>
    r.addSource(i, sliceValues(positions[i], cols, rows, sx, sy))
  );
  expect(r.complete).toBe(true);
  return out;
}

describe('planStack', () => {
  it('pilha uniforme não é reamostrada', () => {
    const s = tiltedStack(10, [2.5], 0);
    const res = planStack({ positions: s.positions, iop: [...ROW, ...COL], pixel: [s.sx, s.sy], rows: s.rows, cols: s.cols });
    expect('plan' in res && res.plan.resample).toBe(false);
  });

  it('gantry tilt: grade ortogonal reproduz o campo', () => {
    const s = tiltedStack(12, [2.5], 15);
    const res = planStack({ positions: s.positions, iop: [...ROW, ...COL], pixel: [s.sx, s.sy], rows: s.rows, cols: s.cols });
    if (!('plan' in res)) throw new Error(res.error);
    const { plan } = res;
    expect(plan.resample).toBe(true);
    expect(plan.tiltDeg).toBeCloseTo(15, 3);
    expect(plan.dims[1]).toBeGreaterThan(s.rows);
    const out = resampleAll(plan, s.positions, s.cols, s.rows, s.sx, s.sy);
    const { checked, worst } = checkAgainstField(plan, out, -9999);
    expect(checked).toBeGreaterThan(plan.count * s.cols * s.rows * 0.8);
    expect(worst).toBeLessThan(1e-6);
  });

  it('lacuna e espaçamento irregular: interpolação ao longo da normal', () => {
    const s = tiltedStack(15, [2, 3, 2, 3, 10, 2, 3], 0);
    const res = planStack({ positions: s.positions, iop: [...ROW, ...COL], pixel: [s.sx, s.sy], rows: s.rows, cols: s.cols });
    if (!('plan' in res)) throw new Error(res.error);
    const { plan } = res;
    expect(plan.resample).toBe(true);
    expect(plan.gaps.length).toBeGreaterThan(0);
    expect(plan.spacing[2]).toBeCloseTo(2, 6);
    const out = resampleAll(plan, s.positions, s.cols, s.rows, s.sx, s.sy);
    const { worst } = checkAgainstField(plan, out, -9999);
    expect(worst).toBeLessThan(1e-6);
    expect(plan.notes.map((n) => n.title).join(' ')).toMatch(/Lacuna/);
  });

  it('quadros fora de ordem (multi-frame) e oblíquo', () => {
    const c = Math.cos(0.3);
    const sn = Math.sin(0.3);
    const row = [c, sn, 0];
    const col = [0, 0, -1];
    const normal = [sn, -c, 0]; // row × col
    const positions = [3, 0, 4, 1, 2].map((k) => [10 + normal[0] * 2 * k, 5 + normal[1] * 2 * k, 30]);
    const cols = 8;
    const rows = 6;
    const res = planStack({ positions, iop: [...row, ...col], pixel: [1, 1.5], rows, cols, force: true });
    if (!('plan' in res)) throw new Error(res.error);
    const { plan } = res;
    expect(plan.dims).toEqual([8, 6, 5]);
    const values = (p: number[]) => {
      const out = new Float64Array(cols * rows);
      for (let j = 0; j < rows; j++)
        for (let i = 0; i < cols; i++)
          out[j * cols + i] = field([0, 1, 2].map((a) => p[a] + i * 1 * row[a] + j * 1.5 * col[a]));
      return out;
    };
    const out = new Float64Array(8 * 6 * 5);
    const r = new StackResampler(plan, out, -9999);
    positions.forEach((p, i) => r.addSource(i, values(p)));
    const { checked, worst } = checkAgainstField(plan, out, -9999);
    expect(checked).toBe(8 * 6 * 5);
    expect(worst).toBeLessThan(1e-9);
  });

  it('memória: cortes de origem são liberados quando não são mais necessários', () => {
    const s = tiltedStack(30, [2.5], 10);
    const res = planStack({ positions: s.positions, iop: [...ROW, ...COL], pixel: [s.sx, s.sy], rows: s.rows, cols: s.cols });
    if (!('plan' in res)) throw new Error(res.error);
    const out = new Float64Array(res.plan.dims[0] * res.plan.dims[1] * res.plan.dims[2]);
    const r = new StackResampler(res.plan, out, -9999);
    s.positions.forEach((p, i) => r.addSource(i, sliceValues(p, s.cols, s.rows, s.sx, s.sy)));
    // @ts-expect-error acesso interno no teste
    expect(r.raw.every((x: unknown) => x === null)).toBe(true);
  });
});

function meta(entries: Record<string, string>) {
  return new Map(Object.entries(entries));
}

function axialMeta(z: number, extra: Record<string, string> = {}) {
  return meta({
    [CT.SOPInstanceUID]: `1.2.3.${z}.${extra.acq ?? ''}`,
    [CT.Rows]: '16',
    [CT.Columns]: '20',
    [CT.ImageOrientationPatient]: '1\\0\\0\\0\\1\\0',
    [CT.ImagePositionPatient]: `0\\0\\${z}`,
    [CT.PixelSpacing]: '0.9\\0.7',
    [CT.AcquisitionNumber]: extra.acq ?? '1',
    ...extra,
  });
}

describe('refineVolumes / splitStack', () => {
  it('separa aquisições repetidas e remove cópias exatas', () => {
    const items = [
      ...[0, 2.5, 5, 7.5].map((z) => axialMeta(z)),
      ...[2.5, 5].map((z) => axialMeta(z, { acq: '2' })),
      axialMeta(5), // cópia exata
    ];
    const out = refineVolumes({ v: items }, (m) => m);
    expect(Object.keys(out)).toEqual(['v', 'v~2']);
    expect(out.v.length).toBe(4);
    expect(out['v~2'].length).toBe(2);
  });

  it('separa matrizes diferentes e ordena pela normal', () => {
    const items = [axialMeta(5), axialMeta(0), axialMeta(2.5), axialMeta(7.5, { [CT.Rows]: '32', [CT.Columns]: '32' })];
    const { parts } = splitStack(items.map(instanceInfo));
    expect(parts.length).toBe(2);
    expect(parts[0]).toEqual([1, 2, 0]);
  });

  it('sem metadados: grupo intacto', () => {
    const out = refineVolumes({ v: [1, 2, 3] }, () => null);
    expect(out).toEqual({ v: [1, 2, 3] });
  });

  it('planForMetas usa as posições por quadro do multi-frame', () => {
    const m = axialMeta(0, {
      [CT.NumberOfFrames]: '3',
      [CT.FramePositions]: JSON.stringify([[0, 0, 5], [0, 0, 0], [0, 0, 2.5]]),
    });
    const res = planForMetas([m]);
    expect(res && 'plan' in res && res.plan.resample).toBe(true);
    if (res && 'plan' in res) {
      expect(Array.from(res.plan.rank)).toEqual([2, 0, 1]);
      expect(res.plan.origin[2]).toBe(0);
    }
  });
});
