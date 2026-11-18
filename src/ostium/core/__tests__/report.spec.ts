import { describe, expect, it } from 'vitest';
import { buildCalciumResult, generateReport, toPlainText, type Exam } from '..';
import { doente, grave, normal, vessel } from './fixtures';

const text = (e: Exam) => toPlainText(generateReport(e));
const lines = (e: Exam) => text(e).split('\n');

describe('Bloco do escore de cálcio', () => {
  it('zero: só a frase A0, sem tabela nem percentil', () => {
    const t = text(normal);
    expect(t).toContain(
      'O escore de cálcio total é zero (Classificação A0 - calcificação coronária não identificável segundo CAC-DRS).'
    );
    expect(t).not.toContain('TCE: 0');
    expect(t).not.toContain('percentil');
  });

  it('> 0: frase com percentil + tabela que fecha + referências', () => {
    const t = text(doente);
    expect(t).toContain(
      'O escore de cálcio total é 156 (Classificação A2 - calcificação coronária moderada), que corresponde ao percentil 68 para idade e sexo (MESA).'
    );
    expect(t).toContain('Isto significa que 68% dos pacientes assintomáticos');
    expect(t).toMatch(/TCE: 0\nDA: 112\nCX: 0\nCD: 44\nTotal: 156/);
    expect(t).toContain('McClelland RL');
  });

  it('idade fora do MESA: omite percentil e a referência do MESA, e avisa', () => {
    const e: Exam = {
      ...doente,
      patient: { ageYears: 40, sex: 'M' },
      calcium: buildCalciumResult({ DA: 50 }, { ageYears: 40, sex: 'M' }),
    };
    const r = generateReport(e);
    const t = toPlainText(r);
    expect(t).toContain(
      'O escore de cálcio total é 50 (Classificação A1 - calcificação coronária baixa).'
    );
    expect(t).not.toContain('McClelland');
    expect(r.warnings.join()).toContain('fora da faixa do MESA');
  });

  it('N do CAC-DRS só quando pedido', () => {
    expect(
      toPlainText(generateReport(doente, { showCacDrsN: true }))
    ).toContain('Classificação A2/N2');
  });
});

describe('Bloco da angio-TC', () => {
  it('limitação é a primeira frase da análise, logo após "que demonstrou:"', () => {
    const l = lines(doente);
    const i = l.findIndex((x) => x.endsWith('que demonstrou:'));
    expect(l[i + 1]).toBe(
      'Artefatos de movimento limitam a avaliação de um segmento.'
    );
    expect(l[i + 2]).toBe('Circulação coronária com dominância direita.');
  });

  it('sem segmento limitado: não existe frase de limitação', () => {
    expect(text(normal)).not.toMatch(/limita/);
  });

  it('motivos múltiplos viram uma frase só', () => {
    const e: Exam = JSON.parse(JSON.stringify(doente));
    e.angio!.vessels.find((v) => v.id === 'CD')!.limited = {
      distal: 'calcificacao',
    };
    expect(text(e)).toContain(
      'Artefatos de movimento e calcificações parietais limitam a avaliação de alguns segmentos.'
    );
  });

  it('segmento limitado na linha do vaso, sem repetir o motivo', () => {
    expect(text(doente)).toContain(
      'Artéria Circunflexa sem redução luminal nos segmentos proximal e médio; segmento distal com avaliação limitada.'
    );
  });

  it('agrupa placas iguais e junta placas diferentes do mesmo vaso numa frase', () => {
    const t = text(doente);
    expect(t).toContain(
      'Artéria Coronária Direita com placas calcificadas nos segmentos proximal e distal determinando redução luminal mínima.'
    );
    expect(t).toContain(
      'Artéria Descendente Anterior atinge o apex, com placa parcialmente calcificada no segmento proximal determinando redução luminal discreta e placa não calcificada no segmento médio determinando redução luminal moderada.'
    );
  });

  it('ramos: agrupa iguais, lista diferentes, omite inexistentes', () => {
    const t = text(doente);
    expect(t).toContain(
      'Dois ramos marginais de pequena importância, sem redução luminal.'
    );
    expect(t).toContain(
      'Primeiro ramo diagonal de grande importância e segundo ramo diagonal de pequena importância, sem redução luminal.'
    );
    expect(text(normal)).not.toContain('Diagonalis');
  });

  it('dominância esquerda: DP aparece depois da CX', () => {
    const l = lines(grave);
    expect(
      l.findIndex((x) => x.startsWith('Artéria Descendente Posterior'))
    ).toBeLessThan(
      l.findIndex((x) => x.startsWith('Artéria Coronária Direita'))
    );
  });

  it('vaso ausente não gera linha', () => {
    const e: Exam = JSON.parse(JSON.stringify(normal));
    e.angio!.vessels = [
      vessel('TCE'),
      vessel('DA'),
      vessel('CX', { present: false }),
      vessel('CD'),
    ];
    expect(text(e)).not.toContain('Circunflexa');
  });
});

describe('Achados adicionais e conclusão', () => {
  it('só os marcados', () => {
    expect(text(doente)).toContain(
      'Ectasia da aorta ascendente, medindo 4,1 cm.'
    );
    expect(text(normal)).not.toContain('Ateromatose');
  });

  it('normal: ausência de redução significativa', () => {
    expect(text(normal)).toMatch(
      /Conclusão:\nTomografia computadorizada de coronárias com cálcio não identificável\.\nAusência de redução luminal coronariana significativa\./
    );
  });

  it('placa só mínima não entra na conclusão', () => {
    const e: Exam = JSON.parse(JSON.stringify(normal));
    e.angio!.vessels[3]!.plaques = [
      { id: 'm', segments: ['proximal'], type: 'calcificada', grade: 'minima' },
    ];
    expect(text(e)).toContain(
      'Ausência de redução luminal coronariana significativa.'
    );
  });

  it('ordena do mais grave para o menos grave e agrupa por grau', () => {
    const concl = text(grave).split('Conclusão:\n')[1]!.split('\n');
    expect(concl).toEqual([
      'Tomografia computadorizada de coronárias com escore de cálcio elevado.',
      'Oclusão do segmento médio da Artéria Coronária Direita.',
      'Presença de redução luminal importante nos segmentos proximal e médio da Artéria Descendente Anterior e no segmento proximal da Artéria Circunflexa.',
      'Presença de redução luminal moderada no segmento proximal do ramo diagonal.',
      'Presença de redução luminal discreta no Tronco da Coronária Esquerda.',
    ]);
  });

  it('avisa lesão sugerida e não revisada', () => {
    expect(generateReport(grave).warnings.join()).toContain('não revisada');
  });

  it('toda linha com conteúdo tem origem rastreável (para o verificador da IA)', () => {
    for (const s of generateReport(grave).sections)
      for (const l of s.lines)
        if (
          l.text &&
          !l.text.startsWith('McClelland') &&
          !l.text.startsWith('CAC-DRS:') &&
          l.text !== 'Referências:'
        )
          expect(l.sources.length).toBeGreaterThan(0);
  });
});
