import { describe, expect, it } from 'vitest';
import { ERASED, HIGHLIGHTED, hexToUnit, overlayLabels } from '../overlay';

describe('escultura nos cortes 2D', () => {
  it('marca apagado e destacado; o destaque ganha', () => {
    const out = new Uint8Array(4);
    const marked = overlayLabels(
      {
        hidden: new Uint8Array([1, 1, 0, 0]),
        highlight: new Uint8Array([0, 1, 1, 0]),
      },
      null,
      out
    );
    expect([...out]).toEqual([ERASED, HIGHLIGHTED, HIGHLIGHTED, 0]);
    expect(marked).toBe(3);
  });

  it('sem máscaras, limpa o que havia', () => {
    const out = new Uint8Array([2, 1]);
    expect(overlayLabels({ hidden: null, highlight: null }, null, out)).toBe(0);
    expect([...out]).toEqual([0, 0]);
  });

  it('ar apagado não é pintado', () => {
    const out = new Uint8Array(2);
    const hidden = new Uint8Array([1, 1]);
    overlayLabels({ hidden, highlight: null }, [-1000, 40], out);
    expect([...out]).toEqual([0, ERASED]);
  });

  it('cor em hexadecimal vira 0 a 1', () => {
    expect(hexToUnit('#ff0080')).toEqual([1, 0, 128 / 255]);
  });
});
