import { describe, it, expect } from 'vitest';
import { mat4 } from 'gl-matrix';
import { buildHandoff, keptRange, paletteFor } from '../handoff';
import { toIndexBox } from '../useHandoff';
import { findLandmarks } from '../landmarks';
import { interpret } from '../interpret';
import { axialPhantom } from './phantom';

describe('editar no 3D', () => {
  const vol = axialPhantom(6);
  const lm = findLandmarks(vol);
  const straight = { angle: 0, center: [0, 0] as [number, number] };

  it('coronal 3D: olha de frente, para trás, e corta a frente', () => {
    const recipe = interpret('coronal no centro em 3d', null).recipe;
    const sent = buildHandoff('x', recipe, { lm, roll: straight, lungs: null });
    expect(sent.camera.direction[1]).toBeCloseTo(1); // de A para P
    expect(sent.camera.viewUp[2]).toBeCloseTo(1); // cabeça para cima
    const [from, to] = sent.crop!.Coronal;
    expect(from).toBeCloseTo(lm.midCoronalY, 0);
    expect(to).toBeCloseTo(Math.min(lm.body[1][1] + 15, from + 160), 0);
    expect(sent.crop!.rotation).toBeNull();
    expect(sent.palette).toBe('musculo');
  });

  it('paciente girado: câmera e caixa giram junto', () => {
    const recipe = interpret('coronal no centro em 3d', null).recipe;
    const sent = buildHandoff('x', recipe, {
      lm,
      roll: { angle: 90, center: [0, 0] },
      lungs: null,
    });
    // girado 90°: o "para trás" do paciente vira −x do aparelho
    expect(sent.camera.direction[0]).toBeCloseTo(-1);
    expect(sent.crop!.rotation).not.toBeNull();
    const scanner = buildHandoff(
      'x',
      { ...recipe, alinhamento: 'aparelho' },
      {
        lm,
        roll: { angle: 90, center: [0, 0] },
        lungs: null,
      }
    );
    expect(scanner.camera.direction[1]).toBeCloseTo(1);
    expect(scanner.crop!.rotation).toBeNull();
  });

  it('só os pulmões: sem caixa, com a região e a paleta dos pulmões', () => {
    const recipe = interpret('só os pulmões em 3d', null).recipe;
    const lungs = {
      n: [1, 1, 1] as [number, number, number],
      min: [0, 0, 0] as [number, number, number],
      step: 1,
      mask: new Uint8Array([1]),
    };
    const sent = buildHandoff('x', recipe, { lm, roll: straight, lungs });
    expect(sent.crop).toBeNull();
    expect(sent.keepOnly!(0, 0, 0)).toBe(true);
    expect(sent.keepOnly!(50, 0, 0)).toBe(false);
    expect(paletteFor(recipe)).toBe('pulmao');
  });

  it('corte 2D: mantém do plano até o fim do corpo', () => {
    const recipe = interpret('sagital na linha média', null).recipe;
    const [a, b] = keptRange(recipe, lm, -1);
    expect(b).toBeCloseTo(lm.midlineX, 0);
    expect(a).toBeCloseTo(lm.body[0][0] - 15, 0);
  });

  it('caixa em mm vira caixa em índices', () => {
    const worldToIndex = mat4.fromValues(
      0.5,
      0,
      0,
      0,
      0,
      0.5,
      0,
      0,
      0,
      0,
      0.25,
      0,
      10,
      20,
      4,
      1
    );
    const box = toIndexBox(
      { Sagittal: [-10, 10], Coronal: [0, 40], Axial: [-16, 16] },
      {
        worldToIndex,
        lpsOrientation: { Sagittal: 0, Coronal: 1, Axial: 2 } as never,
      }
    );
    expect(box).toEqual({
      Sagittal: [5, 15],
      Coronal: [20, 40],
      Axial: [0, 8],
    });
  });
});
