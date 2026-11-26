import { describe, expect, it } from 'vitest';
import { planeFromPoints, type Volume } from '../valve';
import { detectAorticValve, orientPlane, patientAxes } from '../valveDetect';

/**
 * Tórax de brinquedo (voxel de 1 mm, eixos do paciente: x = esquerda,
 * y = posterior, z = superior): aorta descendente, aorta ascendente que
 * alarga nos seios, estreita no anel (z entre 62 e 70) e abre no ventrículo.
 */
const N: [number, number, number] = [140, 140, 150];
const ROOT = { x: 60, y: 55 };

function chest(): Volume {
  const [nx, ny, nz] = N;
  const data = new Int16Array(nx * ny * nz).fill(50);
  for (let z = 0; z < nz; z++)
    for (let y = 0; y < ny; y++)
      for (let x = 0; x < nx; x++) {
        const root = Math.hypot(x - ROOT.x, y - ROOT.y);
        let r = 0;
        if (z >= 85) r = 14;
        else if (z >= 70) r = 17;
        else if (z >= 62) r = 10.5;
        const ventricle = Math.hypot(x - ROOT.x, y - ROOT.y, z - 34) < 28;
        const descending = Math.hypot(x - 95, y - 112) < 11;
        if (root < r || ventricle || descending)
          data[x + nx * (y + ny * z)] = 420;
      }
  return { data, dims: N, spacing: [1, 1, 1] };
}

describe('CatStudio — localização automática da valva aórtica', () => {
  const vol = chest();

  it('acha o anel e aponta a normal para a aorta', () => {
    const found = detectAorticValve(vol, null);
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    const { center, n } = found.plane;
    expect(Math.hypot(center[0] - ROOT.x, center[1] - ROOT.y)).toBeLessThan(3);
    expect(center[2]).toBeGreaterThan(59);
    expect(center[2]).toBeLessThan(73);
    expect(n[2]).toBeGreaterThan(0.95);
    expect(found.blood).toBeGreaterThan(380);
  });

  it('funciona com o volume gravado de cabeça para baixo e espelhado', () => {
    const [nx, ny, nz] = N;
    const data = new Int16Array(vol.data.length);
    for (let z = 0; z < nz; z++)
      for (let y = 0; y < ny; y++)
        for (let x = 0; x < nx; x++)
          data[nx - 1 - x + nx * (y + ny * (nz - 1 - z))] = (
            vol.data as Int16Array
          )[x + nx * (y + ny * z)];
    const flipped: Volume = { data, dims: N, spacing: [1, 1, 1] };
    const direction = [-1, 0, 0, 0, 1, 0, 0, 0, -1];
    const found = detectAorticValve(flipped, direction);
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    const { center, n } = found.plane;
    expect(Math.abs(center[0] - (nx - 1 - ROOT.x))).toBeLessThan(3);
    expect(nz - 1 - center[2]).toBeGreaterThan(59);
    expect(nz - 1 - center[2]).toBeLessThan(73);
    expect(n[2]).toBeLessThan(-0.95);
  });

  it('sem contraste, desiste em vez de inventar', () => {
    const plain: Volume = {
      data: new Int16Array(60 * 60 * 60).fill(40),
      dims: [60, 60, 60],
      spacing: [1, 1, 1],
    };
    expect(detectAorticValve(plain, null)).toEqual({
      ok: false,
      reason: 'sem-contraste',
    });
  });

  it('sem ventrículo abaixo da aorta não há anel', () => {
    const [nx, ny, nz] = N;
    const data = new Int16Array(nx * ny * nz).fill(50);
    for (let z = 0; z < nz; z++)
      for (let y = 0; y < ny; y++)
        for (let x = 0; x < nx; x++)
          if (
            (z >= 60 && Math.hypot(x - ROOT.x, y - ROOT.y) < 14) ||
            Math.hypot(x - 95, y - 112) < 11
          )
            data[x + nx * (y + ny * z)] = 420;
    const found = detectAorticValve(
      { data, dims: N, spacing: [1, 1, 1] },
      null
    );
    expect(found.ok).toBe(false);
  });
});

describe('CatStudio — eixos do paciente e lado do plano', () => {
  it('lê a matriz de direção por colunas', () => {
    expect(patientAxes(null)).toEqual({
      perm: [0, 1, 2],
      flip: [false, false, false],
    });
    // eixo i do volume = posterior; eixo j = esquerda; k = inferior
    expect(patientAxes([0, 1, 0, 1, 0, 0, 0, 0, -1])).toEqual({
      perm: [1, 0, 2],
      flip: [false, false, true],
    });
  });

  it('a ordem dos cliques não muda o lado "acima" do anel', () => {
    const a = planeFromPoints([10, 10, 30], [30, 10, 30], [20, 30, 30])!;
    const b = planeFromPoints([10, 10, 30], [20, 30, 30], [30, 10, 30])!;
    expect(a.n[2] * b.n[2]).toBeLessThan(0);
    for (const plane of [a, b]) {
      const up = orientPlane(plane, 'aortica', null);
      expect(up.n[2]).toBeGreaterThan(0.99);
      // base continua direita: u × v = n
      const [u, v, n] = [up.u, up.v, up.n];
      expect(u[0] * v[1] - u[1] * v[0]).toBeCloseTo(n[2]);
      // com o volume de cabeça para baixo, "para a aorta" é −k
      const down = orientPlane(plane, 'aortica', [1, 0, 0, 0, 1, 0, 0, 0, -1]);
      expect(down.n[2]).toBeLessThan(-0.99);
    }
  });
});
