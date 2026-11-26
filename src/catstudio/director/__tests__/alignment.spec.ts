import { describe, it, expect } from 'vitest';
import { alignedVolume, estimateRoll, rotateXY, MIN_ROLL } from '../alignment';
import { findLandmarks, findLungMask, inLungs } from '../landmarks';
import { newJob, renderRows } from '../cut';
import { interpret } from '../interpret';
import { defaultRecipe, describeRecipe, sanitizeRecipe } from '../recipe';
import { makeVolume, sample, type Vec3 } from '../volume';

interface Chest {
  /** semieixos do corpo (mm) */
  body: [number, number];
  /** pulmão direito menor (colapsado) */
  smallRight?: boolean;
}

/**
 * Tórax no espaço do paciente: corpo elíptico, costelas (anel de osso na
 * periferia), coluna atrás, coração com contraste fora do centro e dois
 * pulmões com um vaso dentro.
 */
function chestDensity(p: Vec3, chest: Chest): number {
  const [x, y, z] = p;
  const [a, b] = chest.body;
  const r = (x / a) ** 2 + (y / b) ** 2;
  if (z < 0 || z > 200 || r > 1) return -1000;
  if (Math.hypot(x, y - 0.75 * b) < 0.12 * a) return 600; // vértebra
  if (r > 0.8 && r < 0.88 && Math.round(z) % 20 < 8) return 500; // costelas
  if (Math.hypot(x - 0.2 * a, y + 0.1 * b) < 0.22 * a) return 300; // coração
  const lung = (cx: number, s: number) =>
    ((x - cx) / (0.3 * a * s)) ** 2 +
      (y / (0.55 * b * s)) ** 2 +
      ((z - 110) / (70 * s)) ** 2 <
    1;
  if (Math.hypot(x - 0.5 * a, y) < 4) return 80; // vaso pulmonar
  if (lung(0.5 * a, 1) || lung(-0.5 * a, chest.smallRight ? 0.6 : 1))
    return -850;
  return 40;
}

/** O tórax girado `angle` graus no aparelho, numa grade de `step` mm. */
function rotatedChest(angle: number, chest: Chest, step = 3) {
  const half = 180;
  const n = Math.round((2 * half) / step) + 1;
  const nz = Math.round(220 / step) + 1;
  const data = new Int16Array(n * n * nz);
  const origin: Vec3 = [-half, -half, -10];
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const world: Vec3 = [
          origin[0] + i * step,
          origin[1] + j * step,
          origin[2] + k * step,
        ];
        // ponto do paciente: desfaz o giro
        data[i + n * (j + n * k)] = chestDensity(
          rotateXY(world, [0, 0], -angle),
          chest
        );
      }
  return makeVolume(data, [n, n, nz], origin, [
    [step, 0, 0],
    [0, step, 0],
    [0, 0, step],
  ]);
}

describe('paciente girado no aparelho', () => {
  const ADULT: Chest = { body: [160, 110] };
  const INFANT: Chest = { body: [70, 60], smallRight: true };

  it.each([
    ['adulto reto', ADULT, 0],
    ['adulto girado 20°', ADULT, 20],
    ['adulto girado −30°', ADULT, -30],
    ['lactente redondo, pulmão colapsado, girado 25°', INFANT, 25],
    ['lactente girado −15°', INFANT, -15],
  ])('%s', (_name, chest, angle) => {
    const vol = rotatedChest(angle, chest);
    const roll = estimateRoll(vol, findLandmarks(vol));
    expect(Math.abs(roll.angle - angle)).toBeLessThan(Math.max(MIN_ROLL, 3));
    expect(Math.hypot(...roll.center)).toBeLessThan(12);
  });

  it('o volume endireitado tem o paciente nos eixos', () => {
    const vol = rotatedChest(25, ADULT);
    const roll = estimateRoll(vol, findLandmarks(vol));
    const straight = alignedVolume(vol, roll);
    // a vértebra fica atrás, na linha média (x ≈ 0, y ≈ 0,75 × 110)
    expect(sample(straight, 0, 82, 100)).toBeGreaterThan(400);
    expect(sample(vol, 0, 82, 100)).toBeLessThan(400);
    // a linha média medida no volume endireitado fica no centro
    expect(Math.abs(findLandmarks(straight).midlineX)).toBeLessThan(8);
    expect(alignedVolume(vol, { angle: 0, center: [0, 0] })).toBe(vol);
  });
});

describe('pedidos: ajustado, do aparelho, só o pulmão', () => {
  it('ajustado é o padrão; "do aparelho" troca', () => {
    expect(defaultRecipe().alinhamento).toBe('paciente');
    const scanner = interpret('coronal do aparelho', null).recipe;
    expect(scanner.alinhamento).toBe('aparelho');
    const back = interpret('agora ajustado ao paciente', scanner);
    expect(back.understood).toBe(true);
    expect(back.recipe.alinhamento).toBe('paciente');
    // trocar de plano mantém a escolha de eixos
    expect(interpret('axial no centro', scanner).recipe.alinhamento).toBe(
      'aparelho'
    );
    expect(describeRecipe(scanner)).toContain('eixos do aparelho');
  });

  it('"só o pulmão em 3D" isola os pulmões', () => {
    const current = interpret('coronal no centro', null).recipe;
    const lungs = interpret('só o pulmão em 3d', current);
    expect(lungs.understood).toBe(true);
    expect(lungs.recipe).toMatchObject({
      plano: 'coronal',
      projecao: '3d',
      isolar: 'pulmoes',
      janela: 'pulmao',
    });
    expect(describeRecipe(lungs.recipe)).toContain('só dos pulmões');
    expect(interpret('pulmões isolados', null).recipe.isolar).toBe('pulmoes');
    expect(interpret('mostra tudo', lungs.recipe).recipe.isolar).toBe('nada');
    expect(interpret('corte fino', lungs.recipe).recipe.isolar).toBe('nada');
    expect(
      sanitizeRecipe({ isolar: 'figado', alinhamento: 'x' })
    ).toMatchObject({
      isolar: 'nada',
      alinhamento: 'paciente',
    });
  });

  it('a máscara dos pulmões pega o vaso de dentro e deixa o coração', () => {
    const vol = rotatedChest(0, { body: [160, 110] });
    const lungs = findLungMask(vol);
    expect(inLungs(lungs, 80, 0, 110)).toBe(true); // vaso dentro do pulmão
    expect(inLungs(lungs, -80, 0, 110)).toBe(true);
    expect(inLungs(lungs, 32, -11, 110)).toBe(false); // coração
    expect(inLungs(lungs, 0, 82, 110)).toBe(false); // coluna
  });

  it('3D só dos pulmões: vê o pulmão inteiro, sem o corpo em volta', () => {
    const vol = rotatedChest(0, { body: [160, 110] });
    const lm = findLandmarks(vol);
    const recipe = interpret('coronal, só os pulmões em 3d', null).recipe;
    const job = newJob(vol, recipe, lm, 120);
    renderRows(job, 0, job.image.height);
    const rgba = job.image.rgba!;
    const at = (x: number, z: number) => {
      const col = Math.floor((x - job.frame.origin[0]) / job.image.pixel);
      const row = Math.floor((job.frame.origin[2] - z) / job.image.pixel);
      return rgba[4 * (col + job.image.width * row)];
    };
    expect(at(80, 110)).toBeGreaterThan(40); // pulmão aparece
    expect(at(0, 110)).toBeLessThan(10); // mediastino transparente
    expect(at(140, 20)).toBeLessThan(10); // parede abaixo do pulmão some
    // o plano foi para a frente do corpo
    expect(job.frame.origin[1]).toBeLessThan(lm.body[0][1]);
  });
});
