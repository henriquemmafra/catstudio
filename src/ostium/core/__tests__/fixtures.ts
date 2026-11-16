import { buildCalciumResult, type Exam, type MainVessel } from '..';

export const vessel = (
  id: MainVessel['id'],
  extra: Partial<MainVessel> = {}
): MainVessel => ({ id, present: true, plaques: [], limited: {}, ...extra });

/** Exame normal: escore zero + angio sem lesões. */
export const normal: Exam = {
  patient: { ageYears: 52, sex: 'F' },
  kind: 'escore_angio',
  detectorRows: 320,
  calcium: buildCalciumResult({}, { ageYears: 52, sex: 'F' }),
  angio: {
    dominance: 'direita',
    vessels: [
      vessel('TCE'),
      vessel('DA', { apex: 'atinge' }),
      vessel('CX'),
      vessel('CD'),
    ],
    branches: [
      {
        id: 'd1',
        kind: 'diagonal',
        parent: 'DA',
        order: 1,
        importance: 'moderada',
        plaques: [],
      },
      {
        id: 'mg1',
        kind: 'marginal',
        parent: 'CX',
        order: 1,
        importance: 'pequena',
        plaques: [],
      },
      { id: 'dp', kind: 'dp', parent: 'CD', plaques: [] },
      { id: 'vp', kind: 'vp', parent: 'CD', plaques: [] },
    ],
  },
};

/** Exame com doença, limitação por movimento e achados adicionais. */
export const doente: Exam = {
  patient: { ageYears: 63, sex: 'M' },
  kind: 'escore_angio',
  detectorRows: 320,
  calcium: buildCalciumResult(
    { TCE: 0, DA: 112.3, CX: 0, CD: 43.8 },
    { ageYears: 63, sex: 'M' }
  ),
  angio: {
    dominance: 'direita',
    vessels: [
      vessel('TCE'),
      vessel('DA', {
        apex: 'atinge',
        plaques: [
          {
            id: 'p1',
            segments: ['proximal'],
            type: 'parcialmente_calcificada',
            grade: 'discreta',
            status: 'confirmado',
          },
          {
            id: 'p2',
            segments: ['medio'],
            type: 'nao_calcificada',
            grade: 'moderada',
            status: 'confirmado',
          },
        ],
        intramyocardial: { segment: 'medio' },
      }),
      vessel('CX', { limited: { distal: 'movimento' } }),
      vessel('CD', {
        plaques: [
          {
            id: 'p3',
            segments: ['proximal'],
            type: 'calcificada',
            grade: 'minima',
            status: 'confirmado',
          },
          {
            id: 'p4',
            segments: ['distal'],
            type: 'calcificada',
            grade: 'minima',
            status: 'confirmado',
          },
        ],
      }),
    ],
    branches: [
      {
        id: 'd1',
        kind: 'diagonal',
        parent: 'DA',
        order: 1,
        importance: 'grande',
        plaques: [],
      },
      {
        id: 'd2',
        kind: 'diagonal',
        parent: 'DA',
        order: 2,
        importance: 'pequena',
        plaques: [],
      },
      {
        id: 'dg',
        kind: 'diagonalis',
        parent: 'TCE',
        importance: 'moderada',
        plaques: [],
      },
      {
        id: 'mg1',
        kind: 'marginal',
        parent: 'CX',
        order: 1,
        importance: 'pequena',
        plaques: [],
      },
      {
        id: 'mg2',
        kind: 'marginal',
        parent: 'CX',
        order: 2,
        importance: 'pequena',
        plaques: [],
      },
      {
        id: 'dp',
        kind: 'dp',
        parent: 'CD',
        plaques: [],
        dpVariant: { dupla: true },
      },
      { id: 'vp', kind: 'vp', parent: 'CD', plaques: [] },
    ],
  },
  additional: {
    ateromatoseAortica: true,
    atrios: 'aumento_atrio_esquerdo',
    ectasiaAortaAscendente: 4.1,
  },
};

/** Oclusão + importante em mais de um vaso. */
export const grave: Exam = {
  patient: { ageYears: 71, sex: 'M' },
  kind: 'escore_angio',
  detectorRows: 320,
  calcium: buildCalciumResult(
    { TCE: 20, DA: 480, CX: 150, CD: 610 },
    { ageYears: 71, sex: 'M' }
  ),
  angio: {
    dominance: 'esquerda',
    vessels: [
      vessel('TCE', {
        plaques: [
          { id: 'q0', segments: [], type: 'calcificada', grade: 'discreta' },
        ],
      }),
      vessel('DA', {
        apex: 'contorna',
        plaques: [
          {
            id: 'q1',
            segments: ['proximal', 'medio'],
            type: 'calcificada',
            grade: 'importante',
          },
        ],
      }),
      vessel('CX', {
        plaques: [
          {
            id: 'q2',
            segments: ['proximal'],
            type: 'parcialmente_calcificada',
            grade: 'importante',
          },
        ],
      }),
      vessel('CD', {
        plaques: [
          {
            id: 'q3',
            segments: ['medio'],
            type: 'calcificada',
            grade: 'oclusao',
          },
        ],
        limited: { distal: 'calcificacao' },
      }),
    ],
    branches: [
      {
        id: 'd1',
        kind: 'diagonal',
        parent: 'DA',
        order: 1,
        importance: 'grande',
        plaques: [
          {
            id: 'q4',
            segments: ['proximal'],
            type: 'nao_calcificada',
            grade: 'moderada',
            status: 'sugerido',
          },
        ],
      },
      { id: 'dp', kind: 'dp', parent: 'CX', plaques: [] },
    ],
  },
  additional: { esternorrafia: true },
};
