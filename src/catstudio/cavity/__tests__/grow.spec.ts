import { describe, expect, it } from 'vitest';
import {
  bloodAt,
  bodySurface,
  growCavity,
  suggestLow,
  wallFromLine,
  type Vec3,
  type Wall,
} from '../grow';

/**
 * Dois "ventrículos" esféricos (raio 8 voxels, 400 UH) ligados por um canal
 * fino, em miocárdio (100 UH). Voxel de 1 mm.
 */
const DIMS: Vec3 = [60, 30, 30];
const A: Vec3 = [15, 15, 15];
const B: Vec3 = [45, 15, 15];
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function heart() {
  const scalars = new Int16Array(DIMS[0] * DIMS[1] * DIMS[2]).fill(100);
  const near = (p: Vec3, c: Vec3) =>
    Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]);
  for (let k = 0; k < DIMS[2]; k++)
    for (let j = 0; j < DIMS[1]; j++)
      for (let i = 0; i < DIMS[0]; i++) {
        const p: Vec3 = [i, j, k];
        const channel = Math.hypot(j - 15, k - 15) < 2 && i > 15 && i < 45;
        if (near(p, A) < 8 || near(p, B) < 8 || channel)
          scalars[i + DIMS[0] * (j + DIMS[1] * k)] = 400;
      }
  return scalars;
}

const BALL = (4 / 3) * Math.PI * 8 ** 3;

describe('volume de cavidade', () => {
  const scalars = heart();
  const grow = (walls: Wall[], maxVoxels = 1e6) => {
    const out = new Uint8Array(scalars.length);
    const result = growCavity(
      { dims: DIMS, scalars, seed: A, low: 250, walls, maxVoxels },
      out,
      1
    );
    return { ...result, out };
  };

  it('limiar sugerido fica entre o sangue e o miocárdio', () => {
    const blood = bloodAt({ dims: DIMS, scalars }, A);
    expect(blood).toBe(400);
    expect(suggestLow(blood)).toBe(250);
  });

  it('sem limite, vaza pelo canal para a outra cavidade', () => {
    const { voxels } = grow([]);
    expect(voxels).toBeGreaterThan(2 * BALL * 0.95);
  });

  it('com a régua no canal, mede só a cavidade de partida', () => {
    // régua vertical em x = 24, desenhada num corte axial (olhando em z)
    const wall = wallFromLine(
      { first: [24, 5, 15], second: [24, 25, 15], viewNormal: [0, 0, 1] },
      IDENTITY
    );
    expect(wall).not.toBeNull();
    const { voxels, out, leaked } = grow([wall!]);
    expect(leaked).toBe(false);
    // a esfera mais o pedaço de canal até a régua
    expect(voxels).toBeGreaterThan(BALL * 0.95);
    expect(voxels).toBeLessThan(BALL * 1.1);
    expect(out[B[0] + DIMS[0] * (B[1] + DIMS[1] * B[2])]).toBe(0);
    expect(out[A[0] + DIMS[0] * (A[1] + DIMS[1] * A[2])]).toBe(1);
  });

  it('o lado que vale é o do ponto de partida, seja qual for o sentido', () => {
    const flipped = wallFromLine(
      { first: [24, 25, 15], second: [24, 5, 15], viewNormal: [0, 0, 1] },
      IDENTITY
    );
    expect(grow([flipped!]).voxels).toBeLessThan(BALL * 1.1);
  });

  it('avisa quando bate no teto', () => {
    const { voxels, leaked } = grow([], 500);
    expect(leaked).toBe(true);
    expect(voxels).toBeLessThan(520);
  });

  it('não toma o que já é de outra cavidade', () => {
    const out = new Uint8Array(scalars.length);
    const input = { dims: DIMS, scalars, low: 250, walls: [], maxVoxels: 1e6 };
    const first = growCavity({ ...input, seed: A }, out, 1);
    const second = growCavity({ ...input, seed: B }, out, 2);
    expect(first.voxels).toBeGreaterThan(BALL);
    expect(second.voxels).toBe(0);
  });

  it('superfície corpórea (Mosteller)', () => {
    expect(bodySurface(170, 70)).toBeCloseTo(1.818, 2);
    expect(bodySurface(0, 70)).toBe(0);
  });
});
