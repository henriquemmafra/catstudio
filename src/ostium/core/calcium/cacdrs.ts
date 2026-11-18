import type { CacDrsClass } from '../schema';

/**
 * CAC-DRS (SCCT 2018), categoria A pelo escore de Agatston total.
 * A0 = 0 | A1 = 1–99 | A2 = 100–299 | A3 = ≥300
 *
 * IMPORTANTE: classificar SEMPRE o valor já arredondado que vai no laudo,
 * senão 99,6 sairia "100 (A1)" — incoerente.
 */
export function cacDrsClass(totalRounded: number): CacDrsClass {
  if (!Number.isFinite(totalRounded) || totalRounded < 0)
    throw new Error(`Escore inválido: ${totalRounded}`);
  if (totalRounded === 0) return 'A0';
  if (totalRounded < 100) return 'A1';
  if (totalRounded < 300) return 'A2';
  return 'A3';
}

/** Modificador N do CAC-DRS: nº de vasos com cálcio (TCE conta como vaso). */
export function cacDrsN(perVessel: Record<string, number>): number {
  return Object.values(perVessel).filter((v) => v > 0).length;
}

/** "A2/N2" — só para os dados/estrutura; uso no texto é opcional. */
export function cacDrsLabel(cls: CacDrsClass, n: number): string {
  return cls === 'A0' ? 'A0' : `${cls}/N${n}`;
}
