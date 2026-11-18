/**
 * Convenções de posição ao longo dos vasos, compartilhadas pelo mapa 3D e pelo planificado.
 * Uma placa é um trecho [t - len/2, t + len/2] do vaso (t de 0 = origem a 1 = fim).
 * O segmento que vai para o laudo é DERIVADO dessa posição.
 */
import type { MainVesselId, Segment } from './core';

export const SEG_RANGE: Record<
  Exclude<MainVesselId, 'TCE'>,
  Record<Segment, [number, number]>
> = {
  DA: { proximal: [0, 0.3], medio: [0.3, 0.62], distal: [0.62, 1] },
  CX: { proximal: [0, 0.34], medio: [0.34, 0.68], distal: [0.68, 1] },
  CD: { proximal: [0, 0.33], medio: [0.33, 0.66], distal: [0.66, 1] },
};
const ORDER: Segment[] = ['proximal', 'medio', 'distal'];
export const isSegmented = (v: string): v is 'DA' | 'CX' | 'CD' =>
  v === 'DA' || v === 'CX' || v === 'CD';

export function segmentAt(vessel: string, t: number): Segment | undefined {
  if (!isSegmented(vessel)) return undefined;
  return ORDER.find((s) => t <= SEG_RANGE[vessel][s][1] + 1e-9) ?? 'distal';
}
/** Segmentos cobertos por um trecho; ignora invasões menores que 1,5% do vaso. */
export function segmentsOfSpan(
  vessel: string,
  t0: number,
  t1: number
): Segment[] {
  if (!isSegmented(vessel)) return [];
  const out = ORDER.filter((s) => {
    const [a, b] = SEG_RANGE[vessel][s];
    return Math.min(t1, b) - Math.max(t0, a) > 0.015;
  });
  return out.length ? out : [segmentAt(vessel, (t0 + t1) / 2)!];
}
export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
export function span(t: number, len: number): [number, number] {
  return [clamp01(t - len / 2), clamp01(t + len / 2)];
}
