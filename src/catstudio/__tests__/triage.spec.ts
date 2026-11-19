import { describe, expect, it } from 'vitest';
import {
  needsTriage,
  rankSeries,
  summarizeSeries,
  triage,
  triageVolumes,
} from '../triage';
import type { Meta } from '../geometry';

function series(
  desc: string,
  n: number,
  step: number,
  extra: Record<string, string> = {}
): Meta[] {
  return Array.from(
    { length: n },
    (_, k) =>
      new Map<string, string>([
        ['0008|0060', 'CT'],
        ['0008|103e', desc],
        ['0020|0011', '3'],
        ['0028|0010', '512'],
        ['0028|0011', '512'],
        ['0028|0100', '16'],
        ['0020|0037', '1\\0\\0\\0\\1\\0'],
        ['0020|0032', `0\\0\\${k * step}`],
        ['0018|0050', '5'],
        ...Object.entries(extra),
      ])
  );
}

describe('CatStudio — triagem de séries', () => {
  it('resume tamanho, plano e distância entre cortes medida nas posições', () => {
    const s = summarizeSeries('a', series('Angio coronárias 0.5', 400, 0.5));
    expect(s.images).toBe(400);
    expect(s.plane).toBe('Axial');
    expect(s.spacing).toBeCloseTo(0.5);
    expect(s.megabytes).toBeCloseTo(200, 0);
    expect(s.kind).toBe('volume');
  });

  it('sugere a série fina com contraste, não a que tem mais imagens', () => {
    const list = rankSeries([
      summarizeSeries('torax', series('Tórax 1 mm pulmão', 900, 1)),
      summarizeSeries('angio', series('Angio coronárias 0.5', 400, 0.5)),
      summarizeSeries('calcio', series('Escore de cálcio', 60, 3)),
      summarizeSeries('mip', series('MIP coronal', 80, 2)),
    ]);
    expect(list.filter((s) => s.recommended).map((s) => s.id)).toEqual([
      'angio',
    ]);
  });

  it('separa localizador, captura e série com poucas imagens', () => {
    const scout = summarizeSeries('s', series('Topograma', 2, 1));
    const dose = summarizeSeries(
      'd',
      series('Dose Report', 1, 1, { '0008|0016': '1.2.840.10008.5.1.4.1.1.7' })
    );
    const few = summarizeSeries('f', series('Teste bolus', 12, 5));
    expect([scout.kind, dose.kind, few.kind]).toEqual(['aux', 'aux', 'aux']);
    expect(rankSeries([scout, dose, few]).some((s) => s.recommended)).toBe(
      false
    );
  });

  it('marca as partes de uma mesma série (fases)', () => {
    const list = rankSeries([
      summarizeSeries('x', series('Funcional', 200, 1)),
      summarizeSeries('x~2', series('Funcional', 200, 1)),
    ]);
    expect(list.map((s) => s.notes[0])).toEqual([
      'Parte 1 de 2',
      'Parte 2 de 2',
    ]);
  });

  it('só pergunta em exame grande com mais de uma série', () => {
    const big = summarizeSeries('a', series('Angio', 400, 0.5));
    const small = summarizeSeries('b', series('Tórax 5 mm', 30, 5));
    expect(needsTriage([big])).toBe(false);
    expect(needsTriage([small, small])).toBe(false);
    expect(needsTriage([big, small])).toBe(true);
  });

  it('sem interface montada devolve tudo; com ela, só o escolhido', async () => {
    const volumes = {
      a: series('Angio', 400, 0.5),
      b: series('Tórax 1 mm', 400, 1),
    };
    const metaOf = (m: Meta) => m;
    triage.available = false;
    expect(Object.keys(await triageVolumes(volumes, metaOf))).toEqual([
      'a',
      'b',
    ]);
    expect(triage.scores.a).toBeGreaterThan(triage.scores.b);

    triage.available = true;
    const pending = triageVolumes(volumes, metaOf);
    await Promise.resolve();
    expect(triage.pending?.list.map((s) => s.id)).toEqual(['a', 'b']);
    triage.pending!.resolve(['b']);
    expect(Object.keys(await pending)).toEqual(['b']);
    expect(triage.pending).toBeNull();

    // restauração de sessão: nunca pergunta
    expect(
      Object.keys(await triageVolumes(volumes, metaOf, { ask: false }))
    ).toEqual(['a', 'b']);
    triage.available = false;
  });
});
