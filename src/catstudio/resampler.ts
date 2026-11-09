/**
 * CatStudio — reamostragem progressiva de uma pilha de cortes paralelos para
 * uma grade regular (ver geometry.ts/planStack).
 *
 * Cada fatia de saída depende de no máximo dois cortes de origem (vizinhos ao
 * longo da normal). À medida que os cortes são decodificados, as fatias cujos
 * vizinhos já chegaram são calculadas e o corte de origem é liberado assim que
 * não for mais necessário — a memória extra fica limitada aos cortes "em
 * trânsito".
 */
import type { StackPlan } from './geometry';

type Writable = {
  length: number;
  [index: number]: number;
  fill(value: number): unknown;
};

const SNAP = 1e-4;

function snap(x: number) {
  const r = Math.round(x);
  return Math.abs(x - r) < SNAP ? r : x;
}

/** Pesos de Catmull-Rom (Keys, a = −0,5) para os vizinhos −1, 0, +1, +2. */
function cubicWeights(t: number, w: Float64Array) {
  const t2 = t * t;
  const t3 = t2 * t;
  w[0] = -0.5 * t3 + t2 - 0.5 * t;
  w[1] = 1.5 * t3 - 2.5 * t2 + 1;
  w[2] = -1.5 * t3 + 2 * t2 + 0.5 * t;
  w[3] = 0.5 * t3 - 0.5 * t2;
}

/**
 * Interpola 4 amostras (p0 é o vizinho −1) com Catmull-Rom e limita o
 * resultado ao intervalo dos dois vizinhos centrais — sem halos/overshoot nas
 * bordas osso/ar, mas mais nítido que a interpolação linear.
 */
function cubic(p0: number, p1: number, p2: number, p3: number, w: Float64Array) {
  const v = p0 * w[0] + p1 * w[1] + p2 * w[2] + p3 * w[3];
  const lo = p1 < p2 ? p1 : p2;
  const hi = p1 < p2 ? p2 : p1;
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Amostra a linha `y` (em pixels do corte de origem) deslocada `du` pixels,
 * escrevendo `nx` valores em `dst`. Fora do corte → `fill`. Deslocamentos
 * fracionários usam Catmull-Rom separável; nas bordas o vizinho que falta é
 * extrapolado linearmente (mantém exatidão para campos lineares).
 */
function sampleRow(
  src: ArrayLike<number>,
  rows: number,
  cols: number,
  du: number,
  y: number,
  fill: number,
  dst: Float64Array,
  tmp: Float64Array,
  wy: Float64Array,
  wx: Float64Array
) {
  const nx = dst.length;
  y = snap(y);
  if (y < 0 || y > rows - 1) {
    dst.fill(fill);
    return;
  }
  const y0 = Math.floor(y);
  const fy = y0 === rows - 1 ? 0 : y - y0;

  // 1) linha de origem na altura y (interpolação vertical se fracionária)
  let line: ArrayLike<number>;
  let lineOffset = 0;
  if (fy === 0) {
    line = src;
    lineOffset = y0 * cols;
  } else {
    cubicWeights(fy, wy);
    const r1 = y0 * cols;
    const r2 = r1 + cols;
    const hasR0 = y0 - 1 >= 0;
    const hasR3 = y0 + 2 <= rows - 1;
    const r0 = (y0 - 1) * cols;
    const r3 = (y0 + 2) * cols;
    for (let x = 0; x < cols; x++) {
      const p1 = src[r1 + x];
      const p2 = src[r2 + x];
      const p0 = hasR0 ? src[r0 + x] : 2 * p1 - p2;
      const p3 = hasR3 ? src[r3 + x] : 2 * p2 - p1;
      tmp[x] = cubic(p0, p1, p2, p3, wy);
    }
    line = tmp;
  }

  // 2) deslocamento horizontal
  const sdu = snap(du);
  const ix = Math.floor(sdu);
  const fx = sdu - ix;
  if (fx === 0) {
    for (let i = 0; i < nx; i++) {
      const x = i + ix;
      dst[i] = x < 0 || x >= cols ? fill : line[lineOffset + x];
    }
    return;
  }
  cubicWeights(fx, wx);
  for (let i = 0; i < nx; i++) {
    const x = i + ix;
    if (x < 0 || x + 1 >= cols) {
      dst[i] = fill;
      continue;
    }
    const p1 = line[lineOffset + x];
    const p2 = line[lineOffset + x + 1];
    const p0 = x - 1 >= 0 ? line[lineOffset + x - 1] : 2 * p1 - p2;
    const p3 = x + 2 < cols ? line[lineOffset + x + 2] : 2 * p2 - p1;
    dst[i] = cubic(p0, p1, p2, p3, wx);
  }
}

export class StackResampler {
  readonly plan: StackPlan;
  private out: Writable;
  private integral: boolean;
  private fill: number;
  private raw: Array<ArrayLike<number> | null>;
  private remaining: Int32Array;
  private done: Uint8Array;
  private dependents: number[][];
  private rowA: Float64Array;
  private rowB: Float64Array;
  private tmp: Float64Array;
  private wy = new Float64Array(4);
  private wx = new Float64Array(4);
  private computedCount = 0;

  constructor(plan: StackPlan, out: Writable, fill: number) {
    this.plan = plan;
    this.out = out;
    this.fill = fill;
    this.integral = !(out instanceof Float32Array || out instanceof Float64Array);
    this.raw = new Array(plan.count).fill(null);
    this.done = new Uint8Array(plan.dims[2]);
    this.dependents = Array.from({ length: plan.count }, () => []);
    for (let o = 0; o < plan.dims[2]; o++) {
      this.dependents[plan.a[o]].push(o);
      if (plan.b[o] !== plan.a[o]) this.dependents[plan.b[o]].push(o);
    }
    this.remaining = Int32Array.from(this.dependents, (d) => d.length);
    this.rowA = new Float64Array(plan.dims[0]);
    this.rowB = new Float64Array(plan.dims[0]);
    this.tmp = new Float64Array(plan.cols);
    out.fill(this.integral ? Math.round(fill) : fill);
  }

  get complete() {
    return this.computedCount === this.plan.dims[2];
  }

  /**
   * Entrega o corte de origem `sourceIndex` (ordem original de arquivos ou
   * quadros). Devolve o intervalo [primeira, última] de fatias de saída
   * calculadas, ou null se nenhuma ficou pronta.
   */
  addSource(sourceIndex: number, data: ArrayLike<number>): [number, number] | null {
    const k = this.plan.rank[sourceIndex];
    if (k === undefined) throw new Error(`Corte de origem ${sourceIndex} fora do plano`);
    if (data.length < this.plan.rows * this.plan.cols)
      throw new Error(`Corte de origem ${sourceIndex} menor que a matriz declarada`);
    if (this.remaining[k] === 0) return null;
    this.raw[k] = data;
    let lo = Infinity;
    let hi = -Infinity;
    this.dependents[k].forEach((o) => {
      if (this.done[o]) return;
      const { a, b } = this.plan;
      if (!this.raw[a[o]] || !this.raw[b[o]]) return;
      this.computeSlice(o);
      lo = Math.min(lo, o);
      hi = Math.max(hi, o);
    });
    return lo === Infinity ? null : [lo, hi];
  }

  private release(k: number) {
    this.remaining[k] -= 1;
    if (this.remaining[k] <= 0) this.raw[k] = null;
  }

  private computeSlice(o: number) {
    const { plan, out, fill, rowA, rowB } = this;
    const [nx, ny] = plan.dims;
    const { rows, cols } = plan;
    const ka = plan.a[o];
    const kb = plan.b[o];
    const wb = kb === ka ? 0 : plan.w[o];
    const wa = 1 - wb;
    const A = this.raw[ka]!;
    const B = this.raw[kb]!;
    const base = o * nx * ny;
    for (let j = 0; j < ny; j++) {
      const { tmp, wx, wy } = this;
      sampleRow(A, rows, cols, plan.du[ka], j + plan.dv[ka], fill, rowA, tmp, wy, wx);
      if (wb !== 0)
        sampleRow(B, rows, cols, plan.du[kb], j + plan.dv[kb], fill, rowB, tmp, wy, wx);
      const off = base + j * nx;
      if (this.integral) {
        if (wb === 0) for (let i = 0; i < nx; i++) out[off + i] = Math.round(rowA[i]);
        else for (let i = 0; i < nx; i++) out[off + i] = Math.round(rowA[i] * wa + rowB[i] * wb);
      } else if (wb === 0) {
        for (let i = 0; i < nx; i++) out[off + i] = rowA[i];
      } else {
        for (let i = 0; i < nx; i++) out[off + i] = rowA[i] * wa + rowB[i] * wb;
      }
    }
    this.done[o] = 1;
    this.computedCount += 1;
    this.release(ka);
    if (kb !== ka) this.release(kb);
  }
}
