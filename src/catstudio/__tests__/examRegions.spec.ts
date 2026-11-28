import { describe, expect, it } from 'vitest';
import { lungHeights, regionsFromLungs } from '../examRegions';

describe('tórax e abdome no mesmo exame', () => {
  it('exame que desce bem abaixo dos pulmões é combinado', () => {
    // pulmões de 250 mm; o volume vai 400 mm abaixo da base
    const r = regionsFromLungs([400, 650], [0, 700]);
    expect(r.combined).toBe(true);
    expect(r.torax).toEqual([385, 680]);
    // o abdome sobe até as cúpulas (um quarto da altura dos pulmões)
    expect(r.abdome).toEqual([0, 462.5]);
    expect(r.whole).toEqual([0, 700]);
  });

  it('tórax sozinho (pega só o andar superior do abdome) não é', () => {
    const r = regionsFromLungs([80, 330], [0, 350]);
    expect(r.combined).toBe(false);
    // o recorte não passa do volume
    expect(r.torax).toEqual([65, 350]);
  });

  it('altura dos pulmões na grade', () => {
    const mask = new Uint8Array(2 * 2 * 10);
    mask[4 * 3] = 1;
    mask[4 * 7 + 2] = 1;
    const lungs = { n: [2, 2, 10], min: [0, 0, 100], step: 5, mask } as const;
    expect(lungHeights({ ...lungs, n: [2, 2, 10], min: [0, 0, 100] })).toEqual([
      115, 135,
    ]);
    expect(
      lungHeights({
        ...lungs,
        n: [2, 2, 10],
        min: [0, 0, 100],
        mask: new Uint8Array(40),
      })
    ).toBeNull();
  });
});
