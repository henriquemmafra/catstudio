/**
 * Escore de cálcio na imagem: cortes axiais, focos ≥ 130 UH realçados, atribuição por clique (foco inteiro)
 * ou laço (só os voxels contornados). Nada conta no escore até ser atribuído a um vaso.
 */
import {
  agatston,
  findIslands,
  HU_THRESHOLD,
  LABEL,
  type AgatstonResult,
  type CalciumVessel,
  type CalciumVolume,
} from './core';

export type Tool = CalciumVessel | 'excluir';
export const TOOL_COLOR: Record<CalciumVessel, [number, number, number]> = {
  TCE: [255, 114, 182],
  DA: [243, 200, 79],
  CX: [143, 229, 124],
  CD: [74, 168, 255],
};
/** Focos maiores que isto são tratados como osso/mesa: não viram candidatos (o laço ainda alcança). */
const MAX_CANDIDATE_MM3 = 1500;

export interface CalciumView {
  setTool(t: Tool): void;
  setSpread(n: number): void;
  undo(): void;
  gotoSlice(z: number): void;
  nextFocus(dir: 1 | -1): void;
  resetZoom(): void;
  readonly slice: number;
  readonly slices: number;
  readonly candidateCount: number;
  destroy(): void;
}

export function createCalciumView(
  box: HTMLElement,
  vol: CalciumVolume,
  on: {
    score(r: AgatstonResult): void;
    slice(z: number, n: number): void;
    message(text: string): void;
  }
): CalciumView {
  const { cols, rows, slices, hu } = vol;
  const sliceSize = cols * rows;
  const labels = new Uint8Array(hu.length);
  const { map, islands } = findIslands(vol);
  const voxMm3 = vol.pixelSpacing[0] * vol.pixelSpacing[1] * vol.sliceSpacing;
  const candidate = new Uint8Array(islands.length + 1);
  for (const is of islands)
    if (is.voxelCount * voxMm3 <= MAX_CANDIDATE_MM3) candidate[is.id] = 1;
  const foci = islands
    .filter((i) => candidate[i.id])
    .map((i) => Math.round(i.centroid[2]))
    .sort((a, b) => a - b);

  const canvas = document.createElement('canvas');
  canvas.width = cols;
  canvas.height = rows;
  canvas.className = 'cacimg';
  box.replaceChildren(canvas);
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(cols, rows);
  let z = foci.length
    ? foci[Math.floor(foci.length / 2)]!
    : Math.floor(slices / 2);
  let tool: Tool = 'DA',
    spread = 0;
  let zoom = 1,
    panX = 0,
    panY = 0;
  let lasso: [number, number][] | null = null;
  const undoStack: Int32Array[] = [];
  const WC = 150,
    WW = 800; // janela de mediastino um pouco mais larga, para o cálcio não saturar tudo

  function layout() {
    const fit = Math.min(box.clientWidth / cols, box.clientHeight / rows) || 1;
    const s = fit * zoom;
    const w = cols * s,
      hgt = rows * s;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${hgt}px`;
    canvas.style.left = `${(box.clientWidth - w) / 2 + panX}px`;
    canvas.style.top = `${(box.clientHeight - hgt) / 2 + panY}px`;
  }
  function draw() {
    const d = img.data;
    const off = z * sliceSize;
    const lo = WC - WW / 2;
    for (let i = 0; i < sliceSize; i++) {
      const v = hu[off + i]!;
      let g = ((v - lo) / WW) * 255;
      g = g < 0 ? 0 : g > 255 ? 255 : g;
      let r = g,
        gg = g,
        b = g;
      const lab = labels[off + i]!;
      if (lab) {
        const c = TOOL_COLOR[(['TCE', 'DA', 'CX', 'CD'] as const)[lab - 1]!];
        r = c[0];
        gg = c[1];
        b = c[2];
      } else if (v >= HU_THRESHOLD && candidate[map[off + i]!]) {
        r = g * 0.35 + 242 * 0.65;
        gg = g * 0.35 + 234 * 0.65;
        b = g * 0.35 + 211 * 0.65;
      }
      const j = i * 4;
      d[j] = r;
      d[j + 1] = gg;
      d[j + 2] = b;
      d[j + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    if (lasso && lasso.length > 1) {
      ctx.beginPath();
      ctx.moveTo(lasso[0]![0], lasso[0]![1]);
      for (const p of lasso) ctx.lineTo(p[0], p[1]);
      ctx.strokeStyle =
        tool === 'excluir' ? '#ff4a4a' : `rgb(${TOOL_COLOR[tool].join(',')})`;
      ctx.lineWidth = Math.max(1, 1.5 / zoom);
      ctx.stroke();
    }
    on.slice(z, slices);
  }
  const rescore = () => on.score(agatston(vol, labels));
  const voxel = (e: MouseEvent): [number, number] => {
    const r = canvas.getBoundingClientRect();
    return [
      ((e.clientX - r.left) / r.width) * cols,
      ((e.clientY - r.top) / r.height) * rows,
    ];
  };
  const labelOf = () => (tool === 'excluir' ? 0 : LABEL[tool]);

  function commit(changes: number[]) {
    if (!changes.length) return false;
    undoStack.push(Int32Array.from(changes));
    if (undoStack.length > 100) undoStack.shift();
    draw();
    rescore();
    return true;
  }
  function clickAt(x: number, y: number) {
    const xi = Math.floor(x),
      yi = Math.floor(y);
    let id = 0,
      big = false,
      bd = Infinity;
    for (let dy = -3; dy <= 3; dy++)
      for (let dx = -3; dx <= 3; dx++) {
        const nx = xi + dx,
          ny = yi + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const m = map[z * sliceSize + ny * cols + nx]!;
        if (!m) continue;
        if (!candidate[m]) {
          if (!dx && !dy) big = true;
          continue;
        }
        const dd = dx * dx + dy * dy;
        if (dd < bd) {
          bd = dd;
          id = m;
        }
      }
    if (!id) {
      on.message(
        big
          ? 'Estrutura grande (osso ou calcificação extensa): use o laço para marcar só a parte coronária.'
          : 'Nenhum foco ≥ 130 UH neste ponto.'
      );
      return;
    }
    const lab = labelOf();
    const changes: number[] = [];
    for (let i = 0; i < map.length; i++)
      if (map[i] === id && labels[i] !== lab) {
        changes.push(i, labels[i]!);
        labels[i] = lab;
      }
    if (commit(changes))
      on.message(lab ? `Foco atribuído: ${tool}.` : 'Foco excluído.');
  }
  function lassoApply(poly: [number, number][]) {
    let x0 = Infinity,
      x1 = -Infinity,
      y0 = Infinity,
      y1 = -Infinity;
    for (const [x, y] of poly) {
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
    const inside = (px: number, py: number) => {
      let c = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i]!,
          [xj, yj] = poly[j]!;
        if (
          yi > py !== yj > py &&
          px < ((xj - xi) * (py - yi)) / (yj - yi) + xi
        )
          c = !c;
      }
      return c;
    };
    const lab = labelOf();
    const changes: number[] = [];
    for (
      let zz = Math.max(0, z - spread);
      zz <= Math.min(slices - 1, z + spread);
      zz++
    )
      for (
        let y = Math.max(0, Math.floor(y0));
        y <= Math.min(rows - 1, Math.ceil(y1));
        y++
      )
        for (
          let x = Math.max(0, Math.floor(x0));
          x <= Math.min(cols - 1, Math.ceil(x1));
          x++
        ) {
          const i = zz * sliceSize + y * cols + x;
          if (
            hu[i]! >= HU_THRESHOLD &&
            labels[i] !== lab &&
            inside(x + 0.5, y + 0.5)
          ) {
            changes.push(i, labels[i]!);
            labels[i] = lab;
          }
        }
    if (commit(changes))
      on.message(
        lab
          ? `Laço: ${changes.length / 2} voxels atribuídos a ${tool}.`
          : `Laço: ${changes.length / 2} voxels excluídos.`
      );
    else on.message('O laço não pegou nenhum voxel ≥ 130 UH.');
  }

  let down: {
    x: number;
    y: number;
    button: number;
    px: number;
    py: number;
    far: number;
  } | null = null;
  const onDown = (e: PointerEvent) => {
    down = {
      x: e.clientX,
      y: e.clientY,
      button: e.button,
      px: panX,
      py: panY,
      far: 0,
    };
    canvas.setPointerCapture(e.pointerId);
    if (e.button === 0) lasso = [voxel(e)];
  };
  const onMove = (e: PointerEvent) => {
    if (!down) return;
    down.far = Math.max(
      down.far,
      Math.hypot(e.clientX - down.x, e.clientY - down.y)
    );
    if (down.button === 0 && lasso) {
      lasso.push(voxel(e));
      draw();
    } else {
      panX = down.px + e.clientX - down.x;
      panY = down.py + e.clientY - down.y;
      layout();
    }
  };
  const onUp = (e: PointerEvent) => {
    if (!down) return;
    const moved = down.far;
    const btn = down.button;
    down = null;
    if (btn !== 0) return;
    const poly = lasso;
    lasso = null;
    if (moved < 4 || !poly || poly.length < 4) {
      const [x, y] = voxel(e);
      clickAt(x, y);
      draw();
    } else {
      lassoApply(poly);
      draw();
    }
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    if (e.ctrlKey) {
      zoom = Math.min(8, Math.max(1, zoom * (e.deltaY < 0 ? 1.2 : 1 / 1.2)));
      if (zoom === 1) panX = panY = 0;
      layout();
    } else {
      z = Math.min(slices - 1, Math.max(0, z + (e.deltaY > 0 ? 1 : -1)));
      draw();
    }
  };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  const ro = new ResizeObserver(layout);
  ro.observe(box);
  layout();
  draw();
  rescore();

  return {
    setTool(t) {
      tool = t;
    },
    setSpread(n) {
      spread = n;
    },
    undo() {
      const c = undoStack.pop();
      if (!c) return on.message('Nada para desfazer.');
      for (let i = 0; i < c.length; i += 2) labels[c[i]!] = c[i + 1]!;
      draw();
      rescore();
      on.message('Desfeito.');
    },
    gotoSlice(n) {
      z = Math.min(slices - 1, Math.max(0, n));
      draw();
    },
    nextFocus(dir) {
      const t =
        dir > 0
          ? foci.find((f) => f > z)
          : [...foci].reverse().find((f) => f < z);
      if (t === undefined) on.message('Não há mais focos nessa direção.');
      else {
        z = t;
        draw();
      }
    },
    resetZoom() {
      zoom = 1;
      panX = panY = 0;
      layout();
    },
    get slice() {
      return z;
    },
    get slices() {
      return slices;
    },
    get candidateCount() {
      return foci.length;
    },
    destroy() {
      ro.disconnect();
      box.replaceChildren();
    },
  };
}
