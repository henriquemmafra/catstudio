import {
  CALCIUM_VESSELS,
  type CalciumResult,
  type CalciumVessel,
  type Patient,
} from '../schema';
import { cacDrsClass, cacDrsN } from './cacdrs';
import { mesaPercentile } from './mesa';

export * from './agatston';
export * from './cacdrs';
export * from './mesa';

/**
 * Monta o resultado final do escore a partir do Agatston por vaso (bruto).
 * Arredonda cada vaso e define o total como a SOMA dos arredondados, para a tabela do laudo
 * sempre fechar (TCE + DA + CX + CD = Total). A classe CAC-DRS usa esse total.
 */
export function buildCalciumResult(
  rawPerVessel: Partial<Record<CalciumVessel, number>>,
  patient: Patient,
  warnings: string[] = []
): CalciumResult & { mesaApproximate: boolean } {
  const perVessel = {} as Record<CalciumVessel, number>;
  for (const v of CALCIUM_VESSELS)
    perVessel[v] = Math.round(Math.max(0, rawPerVessel[v] ?? 0));
  const total = CALCIUM_VESSELS.reduce((s, v) => s + perVessel[v], 0);
  const mesa = mesaPercentile(total, patient.ageYears, patient.sex);
  return {
    perVessel,
    total,
    vesselCount: cacDrsN(perVessel),
    cacDrs: cacDrsClass(total),
    mesaPercentile: mesa.percentile,
    mesaNote: mesa.note,
    mesaApproximate: mesa.approximate,
    warnings,
  };
}
