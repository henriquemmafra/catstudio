/**
 * Livro de frases (pt-BR). TODO o vocabulário do laudo mora aqui, para o Henrique ajustar
 * sem mexer na lógica. Frases marcadas com "A CONFIRMAR" ainda não foram validadas por ele.
 */
import type {
  BranchKind,
  CacDrsClass,
  Importance,
  LimitationReason,
  MainVesselId,
  PlaqueType,
  Segment,
  StenosisGrade,
} from '../schema';

export interface Noun {
  text: string;
  gender: 'm' | 'f';
}

export const VESSEL_NAME: Record<MainVesselId, Noun> = {
  TCE: { text: 'Tronco da Coronária Esquerda', gender: 'm' },
  DA: { text: 'Artéria Descendente Anterior', gender: 'f' },
  CX: { text: 'Artéria Circunflexa', gender: 'f' },
  CD: { text: 'Artéria Coronária Direita', gender: 'f' },
};

export const SEGMENT_NAME: Record<Segment, string> = {
  proximal: 'proximal',
  medio: 'médio',
  distal: 'distal',
};

export const PLAQUE_TYPE: Record<PlaqueType, { sing: string; plur: string }> = {
  nao_calcificada: {
    sing: 'placa não calcificada',
    plur: 'placas não calcificadas',
  },
  parcialmente_calcificada: {
    sing: 'placa parcialmente calcificada',
    plur: 'placas parcialmente calcificadas',
  },
  calcificada: { sing: 'placa calcificada', plur: 'placas calcificadas' },
};

/** Complemento de "determinando ...". */
export const GRADE_EFFECT: Record<StenosisGrade, string> = {
  minima: 'redução luminal mínima',
  discreta: 'redução luminal discreta',
  moderada: 'redução luminal moderada',
  importante: 'redução luminal importante',
  suboclusao: 'suboclusão', // A CONFIRMAR
  oclusao: 'oclusão', // A CONFIRMAR
};

export const IMPORTANCE: Record<Importance, string> = {
  pequena: 'de pequena importância',
  moderada: 'de moderada importância',
  grande: 'de grande importância',
};

export const ORDINAL_M = [
  'primeiro',
  'segundo',
  'terceiro',
  'quarto',
  'quinto',
  'sexto',
];
export const COUNT_M = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis'];

export const BRANCH_NAME: Record<
  BranchKind,
  { sing: string; plur: string; gender: 'm' | 'f' }
> = {
  diagonal: { sing: 'ramo diagonal', plur: 'ramos diagonais', gender: 'm' }, // A CONFIRMAR
  marginal: { sing: 'ramo marginal', plur: 'ramos marginais', gender: 'm' }, // A CONFIRMAR
  diagonalis: {
    sing: 'Artéria Diagonalis',
    plur: 'Artérias Diagonalis',
    gender: 'f',
  },
  dp: {
    sing: 'Artéria Descendente Posterior',
    plur: 'Artérias Descendentes Posteriores',
    gender: 'f',
  },
  vp: {
    sing: 'Artéria Ventricular Posterior',
    plur: 'Artérias Ventriculares Posteriores',
    gender: 'f',
  },
};

export const P = {
  normal: 'sem redução luminal',
  limitedOne: 'com avaliação limitada',
  apex: { atinge: 'atinge o apex', contorna: 'contorna o apex' },
  intramyocardial: (seg: string) =>
    `Trajeto intramiocárdico no segmento ${seg} sem redução luminal em repouso.`,
  dpDupla: 'dupla', // A CONFIRMAR
  dpPrecoce: 'de origem precoce', // A CONFIRMAR

  techniqueAfterCalcium: (rows?: number) =>
    `Complementado estudo com angiografia das Artérias Coronárias por Tomografia Computadorizada${rows ? ` de ${rows} cortes` : ''} com injeção de contraste iodado não-iônico que demonstrou:`,
  /** Exame só de angio (sem escore antes). A CONFIRMAR */
  techniqueAngioOnly: (rows?: number) =>
    `Angiografia das Artérias Coronárias por Tomografia Computadorizada${rows ? ` de ${rows} cortes` : ''} com injeção de contraste iodado não-iônico que demonstrou:`,

  dominance: {
    direita: 'Circulação coronária com dominância direita.',
    esquerda: 'Circulação coronária com dominância esquerda.',
    codominante: 'Circulação coronária codominante.' /* A CONFIRMAR */,
  },

  limitation: {
    single: {
      movimento: 'Artefatos de movimento limitam a avaliação de',
      calcificacao:
        'Calcificações parietais extensas limitam a avaliação luminal de',
      ruido: 'Ruído elevado da imagem limita a avaliação de',
      outro: 'Fatores técnicos limitam a avaliação de',
    } as Record<LimitationReason, string>,
    noun: {
      movimento: 'artefatos de movimento',
      calcificacao: 'calcificações parietais',
      ruido: 'ruído elevado da imagem',
      outro: 'outros fatores técnicos',
    } as Record<LimitationReason, string>,
    multiVerb: 'limitam a avaliação de',
    object: (n: number) => (n === 1 ? 'um segmento.' : 'alguns segmentos.'),
  },

  calcium: {
    zero: 'O escore de cálcio total é zero (Classificação A0 - calcificação coronária não identificável segundo CAC-DRS).',
    level: { A1: 'baixa', A2: 'moderada', A3: 'importante' } as Record<
      Exclude<CacDrsClass, 'A0'>,
      string
    >,
    main: (total: string, cls: string, level: string) =>
      `O escore de cálcio total é ${total} (Classificação ${cls} - calcificação coronária ${level})`,
    percentile: (p: number) =>
      `, que corresponde ao percentil ${p} para idade e sexo (MESA). Isto significa que ${p}% dos pacientes assintomáticos com as mesmas características apresentam escore de cálcio abaixo desse valor.`,
    tableRow: (label: string, value: string) => `${label}: ${value}`,
    references: [
      'McClelland RL, Chung H, Detrano R, Post W, Kronmal RA. Distribution of coronary artery calcium by race, gender, and age: results from the Multi-Ethnic Study of Atherosclerosis (MESA). Circulation. 2006;113(1):30-37.',
      'CAC-DRS: Coronary Artery Calcium Data and Reporting System. An expert consensus document of the Society of Cardiovascular Computed Tomography (SCCT). Journal of Cardiovascular Computed Tomography, 2018.',
    ],
    referencesTitle: 'Referências:',
  },

  additional: {
    ateromatoseAortica: 'Ateromatose aórtica.',
    aumento_atrio_esquerdo: 'Aumento do átrio esquerdo.',
    aumento_biatrial: 'Aumento biatrial.',
    hipertrofiaVentricularEsquerda: 'Hipertrofia ventricular esquerda.',
    septoSigmoide: 'Septo interventricular sigmoide.',
    ectasia: (where: string, cm: string) =>
      `Ectasia ${where}, medindo ${cm} cm.`, // A CONFIRMAR formato da medida
    esternorrafia: 'Esternorrafia metálica com bordos bem coaptados.',
    achadosToracicos:
      'Achados torácicos descritos no estudo dirigido realizado nesta mesma data.', // A CONFIRMAR
  },

  impression: {
    title: 'Conclusão:', // A CONFIRMAR
    calcium: {
      A0: 'Tomografia computadorizada de coronárias com cálcio não identificável.',
      A1: 'Tomografia computadorizada de coronárias com escore de cálcio discreto.',
      A2: 'Tomografia computadorizada de coronárias com escore de cálcio moderado.',
      A3: 'Tomografia computadorizada de coronárias com escore de cálcio elevado.',
    } as Record<CacDrsClass, string>,
    noSignificant: 'Ausência de redução luminal coronariana significativa.',
    reduction: (grade: string, where: string) =>
      `Presença de redução luminal ${grade} ${where}.`,
    occlusion: (where: string) => `Oclusão ${where}.`, // A CONFIRMAR
    subocclusion: (where: string) => `Suboclusão ${where}.`, // A CONFIRMAR
  },
};

// ---------------------------------------------------------------------------
// Utilidades de língua
// ---------------------------------------------------------------------------

/** "a", "a e b", "a, b e c" */
export function joinPt(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}`;
}

export const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

/** "no segmento proximal" / "nos segmentos proximal e médio" */
export function segmentsLoc(
  segs: Segment[],
  prepContracted: 'em' | 'de' = 'em'
): string {
  if (!segs.length) return '';
  const names = segs.map((s) => SEGMENT_NAME[s]);
  const sing = segs.length === 1;
  const prep =
    prepContracted === 'em' ? (sing ? 'no' : 'nos') : sing ? 'do' : 'dos';
  return `${prep} ${sing ? 'segmento' : 'segmentos'} ${joinPt(names)}`;
}

/** Contração preposição + artigo: em/de + o/a. */
export function contract(
  prep: 'em' | 'de',
  gender: 'm' | 'f',
  plural = false
): string {
  if (prep === 'em')
    return gender === 'm' ? (plural ? 'nos' : 'no') : plural ? 'nas' : 'na';
  return gender === 'm' ? (plural ? 'dos' : 'do') : plural ? 'das' : 'da';
}

export function formatInt(n: number): string {
  return Math.round(n).toLocaleString('pt-BR');
}

export function formatCm(n: number): string {
  return n.toLocaleString('pt-BR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}
