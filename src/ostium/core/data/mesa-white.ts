/**
 * Valores de referência MESA — coorte BRANCA (McClelland et al., Circulation 2006;113:30-37).
 *
 * O método original é não paramétrico (LOWESS sobre os dados individuais do MESA), então
 * NÃO é reproduzível por fórmula. O que a calculadora oficial expõe para cada idade/sexo é:
 * probabilidade de CAC > 0 e os percentis 25/50/75/90. Nós guardamos essas âncoras e
 * interpolamos o percentil de um escore observado (ver ../calcium/mesa.ts).
 *
 * PROCEDÊNCIA DOS NÚMEROS (até validarmos direto na calculadora oficial):
 *  - Homens, 45–84 ano a ano: duas fontes secundárias independentes que dizem ter lido a
 *    calculadora oficial (tools.mesa-nhlbi.org/Calcium/input.aspx) trazem valores idênticos.
 *  - Mulheres: só achei de 5 em 5 anos, sem P25, em uma fonte secundária. Uma terceira fonte
 *    diverge. => MARCADO COMO PROVISÓRIO. Idades intermediárias são interpoladas.
 *
 * TODO antes de uso clínico: preencher/validar a tabela inteira (45–84, M e F) na calculadora
 * oficial. Use scripts/mesa-template.csv e substitua os valores abaixo.
 */

export interface MesaRow {
  age: number;
  /** Probabilidade de CAC > 0 (0–1). */
  pPos: number;
  /** Escores nos percentis 25, 50, 75, 90. null = desconhecido. */
  p25: number | null;
  p50: number;
  p75: number;
  p90: number;
}

export interface MesaTable {
  rows: MesaRow[];
  /** true = ainda não validada contra a calculadora oficial. */
  provisional: boolean;
  source: string;
}

const M: [number, number, number, number, number, number][] = [
  // idade, %CAC>0, P25, P50, P75, P90
  [45, 25, 0, 0, 0, 36],
  [46, 28, 0, 0, 3, 48],
  [47, 31, 0, 0, 6, 60],
  [48, 35, 0, 0, 11, 75],
  [49, 38, 0, 0, 16, 90],
  [50, 41, 0, 0, 22, 110],
  [51, 44, 0, 0, 29, 132],
  [52, 47, 0, 0, 37, 154],
  [53, 50, 0, 1, 46, 180],
  [54, 53, 0, 3, 56, 204],
  [55, 56, 0, 6, 68, 234],
  [56, 59, 0, 9, 81, 267],
  [57, 62, 0, 13, 97, 303],
  [58, 64, 0, 17, 113, 344],
  [59, 66, 0, 22, 133, 397],
  [60, 68, 0, 28, 155, 452],
  [61, 70, 0, 35, 180, 508],
  [62, 72, 0, 42, 207, 568],
  [63, 74, 0, 51, 235, 641],
  [64, 75, 2, 61, 269, 717],
  [65, 77, 5, 71, 307, 802],
  [66, 78, 7, 83, 344, 897],
  [67, 79, 10, 98, 393, 1014],
  [68, 81, 13, 115, 447, 1141],
  [69, 82, 17, 130, 491, 1242],
  [70, 83, 21, 145, 540, 1345],
  [71, 85, 26, 161, 583, 1446],
  [72, 86, 32, 180, 641, 1584],
  [73, 87, 38, 200, 693, 1714],
  [74, 88, 45, 223, 752, 1860],
  [75, 90, 52, 248, 820, 2030],
  [76, 91, 62, 272, 889, 2201],
  [77, 92, 71, 298, 964, 2387],
  [78, 93, 81, 325, 1038, 2552],
  [79, 95, 91, 352, 1118, 2742],
  [80, 96, 103, 385, 1200, 2933],
  [81, 97, 117, 420, 1305, 3136],
  [82, 98, 132, 459, 1406, 3365],
  [83, 99, 146, 504, 1521, 3606],
  [84, 99, 157, 542, 1634, 3848],
];

// Mulheres: P25 = 0 sempre que %CAC>0 ≤ 75 (o 25º percentil cai entre os zeros). Desconhecido aos 80 e 84.
const F: [number, number, number | null, number, number, number][] = [
  [45, 7, 0, 0, 0, 0],
  [50, 16, 0, 0, 0, 8],
  [55, 26, 0, 0, 1, 38],
  [60, 36, 0, 0, 16, 102],
  [65, 47, 0, 0, 54, 228],
  [70, 59, 0, 13, 119, 391],
  [75, 73, 0, 49, 237, 649],
  [80, 87, null, 106, 370, 921],
  [84, 98, null, 159, 488, 1168],
];

const toRows = (t: (number | null)[][]): MesaRow[] =>
  t.map(([age, pct, p25, p50, p75, p90]) => ({
    age: age as number,
    pPos: (pct as number) / 100,
    p25: p25 as number | null,
    p50: p50 as number,
    p75: p75 as number,
    p90: p90 as number,
  }));

export const MESA_WHITE: Record<'M' | 'F', MesaTable> = {
  M: {
    rows: toRows(M),
    provisional: true,
    source: 'Calculadora MESA (leitura secundária, 2 fontes concordantes)',
  },
  F: {
    rows: toRows(F),
    provisional: true,
    source: 'Calculadora MESA (leitura secundária, 5 em 5 anos) — PROVISÓRIO',
  },
};
