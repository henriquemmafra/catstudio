import { describe, expect, it } from 'vitest';
import {
  KIND,
  bloodLevel,
  defaultThresholds,
  extractSurface,
  planeFromPoints,
  sampleCube,
  sampleVolume,
  type ValveMesh,
  type Volume,
} from '../valve';
import { createValveRenderer } from '../valveRender';

/** Tubo de sangue (400 UH, raio 12 mm) ao longo de z, em tecido (50 UH), com
 *  um folheto fino (disco de 1,2 mm com furo central) em z = 30 mm e um
 *  bloco de cálcio na parede. Voxel de 0,6 mm. */
function phantom(): Volume {
  const n = 100;
  const sp = 0.6;
  const data = new Int16Array(n * n * n);
  for (let k = 0; k < n; k++)
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const x = (i - n / 2) * sp;
        const y = (j - n / 2) * sp;
        const z = k * sp;
        const r = Math.hypot(x, y);
        let h = r < 12 ? 400 : 50;
        if (r < 12 && r > 4 && Math.abs(z - 30) < 0.6) h = 60;
        if (
          r > 11 &&
          r < 14 &&
          x > 0 &&
          Math.abs(y) < 2 &&
          Math.abs(z - 36) < 2
        )
          h = 1100;
        data[i + n * (j + n * k)] = h;
      }
  return { data, dims: [n, n, n], spacing: [sp, sp, sp] };
}

const count = (mesh: ValveMesh, kind: number) =>
  mesh.kinds.reduce((n, k) => n + (k === kind ? 1 : 0), 0);

describe('CatStudio — modo Valvas', () => {
  const vol = phantom();
  const plane = planeFromPoints([18, 30, 30], [42, 30, 30], [30, 42, 30])!;

  it('plano por três pontos; pontos alinhados não definem plano', () => {
    expect(Math.abs(plane.n[2])).toBeCloseTo(1);
    expect(plane.center).toEqual([30, 34, 30]);
    expect(planeFromPoints([0, 0, 0], [1, 1, 1], [2, 2, 2])).toBeNull();
  });

  it('amostra trilinear e ar fora do volume', () => {
    expect(sampleVolume(vol, [30, 30, 10])).toBeCloseTo(400);
    expect(sampleVolume(vol, [-5, 30, 10])).toBe(-1000);
  });

  it('acha o sangue, o folheto fino, a parede e o cálcio', () => {
    const cube = sampleCube(vol, plane);
    const blood = bloodLevel(cube)!;
    expect(blood).toBeGreaterThan(380);
    const t = defaultThresholds(blood);
    const pts = extractSurface(cube, {
      radius: 16,
      from: -10,
      to: 12,
      ...t,
    });
    expect(count(pts, KIND.leaflet)).toBeGreaterThan(500);
    expect(count(pts, KIND.wall)).toBeGreaterThan(1000);
    expect(count(pts, KIND.calcium)).toBeGreaterThan(20);
    // o folheto fica no plano do anel (|z| pequeno)
    for (let v = 0; v < pts.kinds.length; v++) {
      if (pts.kinds[v] !== KIND.leaflet) continue;
      expect(Math.abs(pts.positions[3 * v + 2])).toBeLessThan(2.5);
    }
  });

  it('a malha é subvoxel, com normais unitárias apontando para o sangue', () => {
    const cube = sampleCube(vol, plane);
    const mesh = extractSurface(cube, {
      radius: 16,
      from: -9,
      to: -3,
      ...defaultThresholds(400),
    });
    expect(mesh.indices.length % 3).toBe(0);
    expect(mesh.indices.length).toBeGreaterThan(3000);
    expect(mesh.kinds.every((k) => k === KIND.wall)).toBe(true);
    expect(Math.max(...mesh.indices)).toBeLessThan(mesh.kinds.length);
    // trecho só de tubo (raio 12 mm): os vértices ficam na parede, não nos
    // centros dos voxels — o raio varia muito menos que o passo de 0,5 mm
    let worst = 0;
    let inward = 0;
    let walls = 0;
    for (let v = 0; v < mesh.kinds.length; v++) {
      if (mesh.kinds[v] !== KIND.wall) continue;
      const [x, y] = [mesh.positions[3 * v], mesh.positions[3 * v + 1]];
      // o centro do plano está 4 mm fora do eixo do tubo (em y)
      const r = Math.hypot(x, y + 4);
      worst = Math.max(worst, Math.abs(r - 12));
      const n = [
        mesh.normals[3 * v],
        mesh.normals[3 * v + 1],
        mesh.normals[3 * v + 2],
      ];
      expect(Math.hypot(n[0], n[1], n[2])).toBeCloseTo(1, 3);
      if (n[0] * x + n[1] * (y + 4) < 0) inward += 1;
      walls += 1;
    }
    expect(walls).toBeGreaterThan(1000);
    expect(worst).toBeLessThan(0.45);
    expect(inward / walls).toBeGreaterThan(0.98);
  });

  it('sem contraste em volta não há nível de sangue', () => {
    const empty: Volume = {
      data: new Int16Array(40 * 40 * 40).fill(40),
      dims: [40, 40, 40],
      spacing: [1, 1, 1],
    };
    const p = planeFromPoints([10, 10, 20], [30, 10, 20], [20, 30, 20])!;
    expect(bloodLevel(sampleCube(empty, p))).toBeNull();
  });

  it('desenha os dois estilos sem deixar a imagem vazia', () => {
    const cube = sampleCube(vol, plane);
    const pts = extractSurface(cube, {
      radius: 16,
      from: -10,
      to: 12,
      ...defaultThresholds(400),
    });
    const r = createValveRenderer(120, 120);
    const base = { spin: 0.5, tilt: 0.9, zoom: 3, flip: false };
    const lit = (rgba: Uint8ClampedArray) => {
      let n = 0;
      for (let i = 0; i < rgba.length; i += 4) if (rgba[i + 1] > 70) n++;
      return n;
    };
    expect(lit(r.draw(pts, { ...base, style: 'holo' }))).toBeGreaterThan(300);
    expect(lit(r.draw(pts, { ...base, style: 'solid' }))).toBeGreaterThan(300);
  });
});
