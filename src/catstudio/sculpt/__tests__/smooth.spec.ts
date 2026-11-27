import { describe, it, expect } from 'vitest';
import { smooth3 } from '../smooth';
import { SCULPT_TOOLS, toolsIn } from '../toolList';

describe('tirar o granulado', () => {
  it('reduz o ruído e mantém a média', () => {
    const n = 16;
    const data = new Int16Array(n * n * n);
    let seed = 7;
    const noise = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed / 2147483647 - 0.5) * 200;
    };
    for (let i = 0; i < data.length; i++) data[i] = 100 + noise();
    const std = (a: Int16Array) => {
      const mean = a.reduce((s, v) => s + v, 0) / a.length;
      return [
        mean,
        Math.sqrt(a.reduce((s, v) => s + (v - mean) ** 2, 0) / a.length),
      ];
    };
    const [meanBefore, before] = std(data);
    smooth3(data, [n, n, n]);
    const [meanAfter, after] = std(data);
    expect(after).toBeLessThan(0.35 * before);
    expect(Math.abs(meanAfter - meanBefore)).toBeLessThan(3);
  });

  it('volume homogêneo e degrau largo ficam como estão', () => {
    const flat = new Int16Array(4 * 4 * 4).fill(55);
    smooth3(flat, [4, 4, 4]);
    expect([...flat].every((v) => v === 55)).toBe(true);
    const step = new Float32Array(8);
    step.fill(100, 4);
    smooth3(step, [8, 1, 1]);
    expect([...step]).toEqual([0, 0, 0, 25, 75, 100, 100, 100]);
  });

  it('as ferramentas estão em três grupos, sem repetir', () => {
    expect(toolsIn('apagar').map((t) => t.short)).toEqual([
      'Borracha',
      'Laço',
      'Clique',
      'Crescer',
    ]);
    expect(toolsIn('manter').length).toBe(3);
    expect(toolsIn('destacar').length).toBe(1);
    expect(new Set(SCULPT_TOOLS.map((t) => t.mode)).size).toBe(8);
  });
});
