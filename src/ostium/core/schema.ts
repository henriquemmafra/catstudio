/**
 * Schema unificado dos achados de um exame (escore de cálcio + angio-TC de coronárias).
 *
 * Princípio: este JSON é a ÚNICA fonte da verdade. O laudo é uma função pura dele.
 * Nada que não esteja aqui pode aparecer no texto (nem via IA).
 */

export type Sex = 'M' | 'F';

/** Vasos usados no escore de cálcio (Agatston por vaso). */
export type CalciumVessel = 'TCE' | 'DA' | 'CX' | 'CD';
export const CALCIUM_VESSELS: CalciumVessel[] = ['TCE', 'DA', 'CX', 'CD'];

export type CacDrsClass = 'A0' | 'A1' | 'A2' | 'A3';

export interface Patient {
  /** Idade em anos (das tags DICOM: PatientAge ou PatientBirthDate x StudyDate). */
  ageYears?: number;
  sex?: Sex;
}

export interface CalciumResult {
  /** Agatston por vaso. Vasos ausentes = 0. */
  perVessel: Record<CalciumVessel, number>;
  total: number;
  /** Nº de vasos com escore > 0 (modificador N do CAC-DRS). */
  vesselCount: number;
  cacDrs: CacDrsClass;
  /** Percentil MESA (coorte branca por padrão). null = não aplicável (idade fora de 45–84, sexo ausente, escore zero). */
  mesaPercentile: number | null;
  /** Motivo quando o percentil não foi calculado. */
  mesaNote?: string;
  /** Avisos técnicos (espessura de corte ≠ 3 mm, kVp ≠ 120 etc.). */
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Angio-TC
// ---------------------------------------------------------------------------

export type Dominance = 'direita' | 'esquerda' | 'codominante';

export type Segment = 'proximal' | 'medio' | 'distal';
export const SEGMENTS: Segment[] = ['proximal', 'medio', 'distal'];

export type PlaqueType =
  | 'nao_calcificada'
  | 'parcialmente_calcificada'
  | 'calcificada';

/**
 * Graduação SCCT: mínima 1–24%, discreta 25–49%, moderada 50–69%,
 * importante 70–99% (suboclusão = 95–99% quando se quiser destacar), oclusão 100%.
 */
export type StenosisGrade =
  | 'minima'
  | 'discreta'
  | 'moderada'
  | 'importante'
  | 'suboclusao'
  | 'oclusao';
export const GRADE_ORDER: StenosisGrade[] = [
  'minima',
  'discreta',
  'moderada',
  'importante',
  'suboclusao',
  'oclusao',
];

/** Mapa grau → faixa de estenose (para CAD-RADS e para conferência). */
export const GRADE_RANGE: Record<StenosisGrade, [number, number]> = {
  minima: [1, 24],
  discreta: [25, 49],
  moderada: [50, 69],
  importante: [70, 94],
  suboclusao: [95, 99],
  oclusao: [100, 100],
};

export type LimitationReason = 'movimento' | 'calcificacao' | 'ruido' | 'outro';

export interface Plaque {
  id: string;
  /** Segmentos que a placa ocupa (uma placa longa pode ocupar proximal + médio). Vazio no TCE. */
  segments: Segment[];
  type: PlaqueType;
  grade: StenosisGrade;
  /** Origem do achado: sugerido pela IA e ainda não revisado, confirmado ou criado pelo médico. */
  status?: 'sugerido' | 'confirmado' | 'manual';
}

export type Importance = 'pequena' | 'moderada' | 'grande';

export type MainVesselId = 'TCE' | 'DA' | 'CX' | 'CD';

export type BranchKind = 'diagonal' | 'diagonalis' | 'marginal' | 'dp' | 'vp';

export interface Branch {
  id: string;
  kind: BranchKind;
  /** Vaso de origem (DP/VP podem vir da CD ou da CX conforme a dominância). */
  parent: MainVesselId;
  /** Ordem (1º diagonal, 2º marginal...). */
  order?: number;
  importance?: Importance;
  plaques: Plaque[];
  limited?: { reason: LimitationReason };
  /** Variantes da DP. */
  dpVariant?: { dupla?: boolean; precoce?: boolean };
}

export interface MainVessel {
  id: MainVesselId;
  present: boolean;
  plaques: Plaque[];
  /** Segmentos com avaliação limitada (não se aplica ao TCE — use limitedWhole). */
  limited: Partial<Record<Segment, LimitationReason>>;
  /** Vaso inteiro com avaliação limitada (TCE, ou qualquer vaso). */
  limitedWhole?: LimitationReason;
  /** Somente DA: atinge ou contorna o apex. */
  apex?: 'atinge' | 'contorna';
  /** Somente DA (por ora): ponte miocárdica. */
  intramyocardial?: { segment: Segment };
}

export interface AdditionalFindings {
  ateromatoseAortica?: boolean;
  atrios?: 'aumento_atrio_esquerdo' | 'aumento_biatrial';
  hipertrofiaVentricularEsquerda?: boolean;
  septoSigmoide?: boolean;
  /** Medidas em cm. */
  ectasiaRaizAortica?: number;
  ectasiaAortaAscendente?: number;
  ectasiaTroncoPulmonar?: number;
  esternorrafia?: boolean;
  achadosToracicosEstudoDirigido?: boolean;
}

export interface Exam {
  patient: Patient;
  /** Tipo de exame: só escore, só angio, ou escore + angio. */
  kind: 'escore' | 'angio' | 'escore_angio';
  /** Nº de fileiras do tomógrafo (Canon Aquilion ONE = 320). Vem das tags DICOM. */
  detectorRows?: number;
  calcium?: CalciumResult;
  angio?: {
    dominance: Dominance;
    vessels: MainVessel[];
    branches: Branch[];
  };
  additional?: AdditionalFindings;
}
