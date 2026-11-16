import { CALCIUM_VESSELS, type CalciumVessel } from '../schema';

/**
 * Escore de Agatston a partir dos voxels.
 *
 * Convenções do volume (iguais às do Cornerstone3D/vtk.js):
 *   índice = z * rows * cols + y * cols + x
 *
 * O médico não edita HU: edita o mapa de rótulos `labels` (mesmo tamanho do volume):
 *   0 = não coronário / excluído, 1 = TCE, 2 = DA, 3 = CX, 4 = CD
 * Clique numa ilha → muda o rótulo da ilha inteira. Laço → muda só os voxels contornados.
 * Depois de cada edição, chama-se agatston() de novo (é rápido: só percorre os voxels ≥ 130 UH).
 */

export const HU_THRESHOLD = 130;
/** Área mínima de lesão por corte. 1 mm² é o padrão mais usado (≈ 3 pixels a 0,6 mm). */
export const MIN_LESION_AREA_MM2 = 1;

export const LABEL: Record<CalciumVessel, number> = {
  TCE: 1,
  DA: 2,
  CX: 3,
  CD: 4,
};
export const VESSEL_OF_LABEL: (CalciumVessel | null)[] = [
  null,
  'TCE',
  'DA',
  'CX',
  'CD',
];

export interface CalciumVolume {
  hu: Int16Array | Float32Array | Int32Array;
  cols: number;
  rows: number;
  slices: number;
  /** [espaçamento entre linhas, entre colunas] em mm (tag PixelSpacing). */
  pixelSpacing: [number, number];
  /** Distância entre centros de cortes (mm). */
  sliceSpacing: number;
  /** Espessura nominal (mm). */
  sliceThickness: number;
  kvp?: number;
}

export interface AgatstonResult {
  /** Valores brutos (sem arredondar). */
  perVessel: Record<CalciumVessel, number>;
  total: number;
  /** Nº de lesões (por corte) que contaram, por vaso — útil para conferência. */
  lesionCount: Record<CalciumVessel, number>;
  warnings: string[];
}

export function densityFactor(peakHU: number): number {
  if (peakHU < HU_THRESHOLD) return 0;
  if (peakHU < 200) return 1;
  if (peakHU < 300) return 2;
  if (peakHU < 400) return 3;
  return 4;
}

export function technicalWarnings(
  v: Pick<CalciumVolume, 'sliceThickness' | 'sliceSpacing' | 'kvp'>
): string[] {
  const w: string[] = [];
  if (Math.abs(v.sliceThickness - 3) > 0.1)
    w.push(
      `Espessura de corte ${v.sliceThickness} mm (Agatston é validado para 3 mm). Escore pode não ser comparável.`
    );
  if (Math.abs(v.sliceSpacing - v.sliceThickness) > 0.1)
    w.push(
      `Espaçamento entre cortes (${v.sliceSpacing} mm) diferente da espessura (${v.sliceThickness} mm): aplicado fator de correção ${(v.sliceSpacing / 3).toFixed(2)}.`
    );
  if (v.kvp !== undefined && Math.abs(v.kvp - 120) > 1)
    w.push(`Aquisição com ${v.kvp} kVp (Agatston é validado para 120 kVp).`);
  return w;
}

/**
 * Agatston clássico: em cada corte, cada lesão (componente 2D, 8-conectada, de voxels ≥ 130 UH
 * com o mesmo rótulo de vaso) contribui área(mm²) × fator de densidade do pico da lesão naquele corte.
 * Correção para espaçamento ≠ 3 mm: multiplica por espaçamento/3 (evita contar em dobro cortes sobrepostos).
 */
export function agatston(
  vol: CalciumVolume,
  labels: Uint8Array
): AgatstonResult {
  const { hu, cols, rows, slices } = vol;
  const n = cols * rows * slices;
  if (hu.length !== n || labels.length !== n)
    throw new Error('Volume e rótulos com tamanhos diferentes.');

  const pixelArea = vol.pixelSpacing[0] * vol.pixelSpacing[1];
  const minPixels = Math.max(
    1,
    Math.ceil(MIN_LESION_AREA_MM2 / pixelArea - 1e-9)
  );
  const spacingCorrection = vol.sliceSpacing / 3;

  const perVessel = { TCE: 0, DA: 0, CX: 0, CD: 0 } as Record<
    CalciumVessel,
    number
  >;
  const lesionCount = { TCE: 0, DA: 0, CX: 0, CD: 0 } as Record<
    CalciumVessel,
    number
  >;

  const sliceSize = cols * rows;
  const visited = new Uint8Array(sliceSize);
  const stack = new Int32Array(sliceSize);

  for (let z = 0; z < slices; z++) {
    visited.fill(0);
    const off = z * sliceSize;
    for (let p = 0; p < sliceSize; p++) {
      const lab = labels[off + p]!;
      if (lab === 0 || visited[p] || hu[off + p]! < HU_THRESHOLD) continue;
      // flood fill 2D, mesmo rótulo
      let sp = 0,
        count = 0,
        peak = -Infinity;
      stack[sp++] = p;
      visited[p] = 1;
      while (sp > 0) {
        const q = stack[--sp]!;
        count++;
        const h = hu[off + q]!;
        if (h > peak) peak = h;
        const qx = q % cols,
          qy = (q - qx) / cols;
        for (let dy = -1; dy <= 1; dy++) {
          const ny = qy + dy;
          if (ny < 0 || ny >= rows) continue;
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const nx = qx + dx;
            if (nx < 0 || nx >= cols) continue;
            const r = ny * cols + nx;
            if (
              visited[r] ||
              labels[off + r] !== lab ||
              hu[off + r]! < HU_THRESHOLD
            )
              continue;
            visited[r] = 1;
            stack[sp++] = r;
          }
        }
      }
      if (count < minPixels) continue;
      const vessel = VESSEL_OF_LABEL[lab];
      if (!vessel) continue;
      perVessel[vessel] +=
        count * pixelArea * densityFactor(peak) * spacingCorrection;
      lesionCount[vessel]++;
    }
  }

  const total = CALCIUM_VESSELS.reduce((s, v) => s + perVessel[v], 0);
  return { perVessel, total, lesionCount, warnings: technicalWarnings(vol) };
}

// ---------------------------------------------------------------------------
// Ilhas candidatas (o que o médico clica)
// ---------------------------------------------------------------------------

export interface Island {
  id: number;
  voxelCount: number;
  peakHU: number;
  /** Centro em índices (x, y, z). */
  centroid: [number, number, number];
  bbox: { min: [number, number, number]; max: [number, number, number] };
}

/**
 * Ilhas 3D (26-conectadas) de voxels ≥ 130 UH dentro de uma ROI opcional (ex.: máscara do coração).
 * Retorna o mapa de ilhas (0 = fundo) e a lista. Ilhas menores que a área mínima em todos os cortes
 * são descartadas (ruído).
 */
export function findIslands(
  vol: CalciumVolume,
  roi?: Uint8Array
): { map: Int32Array; islands: Island[] } {
  const { hu, cols, rows, slices } = vol;
  const sliceSize = cols * rows;
  const n = sliceSize * slices;
  const map = new Int32Array(n);
  const islands: Island[] = [];
  const pixelArea = vol.pixelSpacing[0] * vol.pixelSpacing[1];
  const minPixels = Math.max(
    1,
    Math.ceil(MIN_LESION_AREA_MM2 / pixelArea - 1e-9)
  );
  const stack: number[] = [];
  let nextId = 1;

  for (let i = 0; i < n; i++) {
    if (map[i] || hu[i]! < HU_THRESHOLD || (roi && !roi[i])) continue;
    const id = nextId++;
    const members: number[] = [];
    stack.push(i);
    map[i] = id;
    while (stack.length) {
      const q = stack.pop()!;
      members.push(q);
      const z = Math.floor(q / sliceSize),
        r = q - z * sliceSize,
        y = Math.floor(r / cols),
        x = r - y * cols;
      for (let dz = -1; dz <= 1; dz++) {
        const nz = z + dz;
        if (nz < 0 || nz >= slices) continue;
        for (let dy = -1; dy <= 1; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= rows) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            if (nx < 0 || nx >= cols) continue;
            const j = nz * sliceSize + ny * cols + nx;
            if (map[j] || hu[j]! < HU_THRESHOLD || (roi && !roi[j])) continue;
            map[j] = id;
            stack.push(j);
          }
        }
      }
    }
    // maior área num único corte
    const perSlice = new Map<number, number>();
    let peak = -Infinity,
      sx = 0,
      sy = 0,
      sz = 0;
    const mn: [number, number, number] = [Infinity, Infinity, Infinity],
      mx: [number, number, number] = [-1, -1, -1];
    for (const q of members) {
      const z = Math.floor(q / sliceSize),
        r = q - z * sliceSize,
        y = Math.floor(r / cols),
        x = r - y * cols;
      perSlice.set(z, (perSlice.get(z) ?? 0) + 1);
      if (hu[q]! > peak) peak = hu[q]!;
      sx += x;
      sy += y;
      sz += z;
      mn[0] = Math.min(mn[0], x);
      mn[1] = Math.min(mn[1], y);
      mn[2] = Math.min(mn[2], z);
      mx[0] = Math.max(mx[0], x);
      mx[1] = Math.max(mx[1], y);
      mx[2] = Math.max(mx[2], z);
    }
    if (Math.max(...perSlice.values()) < minPixels) {
      for (const q of members) map[q] = -1; // ruído: marcado para não revisitar
      nextId--;
      continue;
    }
    const k = members.length;
    islands.push({
      id,
      voxelCount: k,
      peakHU: peak,
      centroid: [sx / k, sy / k, sz / k],
      bbox: { min: mn, max: mx },
    });
  }
  for (let i = 0; i < n; i++) if (map[i] === -1) map[i] = 0;
  return { map, islands };
}

/** Clique: atribui (ou exclui, vessel = null) uma ilha inteira. */
export function assignIsland(
  labels: Uint8Array,
  islandMap: Int32Array,
  islandId: number,
  vessel: CalciumVessel | null
): void {
  const lab = vessel ? LABEL[vessel] : 0;
  for (let i = 0; i < islandMap.length; i++)
    if (islandMap[i] === islandId) labels[i] = lab;
}

/** Laço: atribui (ou exclui) só os voxels indicados. */
export function assignVoxels(
  labels: Uint8Array,
  indices: Iterable<number>,
  vessel: CalciumVessel | null
): void {
  const lab = vessel ? LABEL[vessel] : 0;
  for (const i of indices) labels[i] = lab;
}
