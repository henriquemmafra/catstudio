/**
 * CatStudio — desenho do modo Valvas (sem DOM: escreve num RGBA).
 *
 * Dois estilos sobre os mesmos pontos da superfície:
 *  - holograma: pontos luminosos somados (os folhetos brilham, a parede fica
 *    translúcida);
 *  - sólido: superfície opaca com profundidade e iluminação.
 * É desenho por pontos em CPU, de propósito: roda em estação sem placa de
 * vídeo boa e não disputa memória de vídeo com as outras vistas.
 */
import { KIND, POINT_STRIDE } from './valve';

export interface ValveView {
  /** Giro em torno do eixo da valva (rad). */
  spin: number;
  /** 0 = de frente para o anel (en face); π/2 = de lado. */
  tilt: number;
  /** Pixels por mm. */
  zoom: number;
  style: 'holo' | 'solid';
  /** Olhar pelo outro lado do anel. */
  flip: boolean;
  /** Tamanho do voxel de origem, em mm (define o tamanho do ponto). */
  step: number;
}

const HOLO_COLOR: Record<number, [number, number, number, number]> = {
  [KIND.wall]: [0.1, 0.45, 1.0, 0.16],
  [KIND.leaflet]: [0.25, 1.0, 0.95, 0.55],
  [KIND.calcium]: [1.0, 0.75, 0.2, 0.7],
};
const SOLID_COLOR: Record<number, [number, number, number]> = {
  [KIND.wall]: [176, 92, 96],
  [KIND.leaflet]: [240, 214, 196],
  [KIND.calcium]: [255, 250, 225],
};
const LIGHT = [-0.33, -0.43, 0.84];

interface Projected {
  x: number;
  y: number;
  depth: number;
  shade: number;
  /** Componente da normal (que aponta para o sangue) na direção do observador. */
  facing: number;
}

function makeProjector(view: ValveView, w: number, h: number) {
  const cs = Math.cos(view.spin);
  const sn = Math.sin(view.spin);
  const ct = Math.cos(view.tilt);
  const st = Math.sin(view.tilt);
  const sign = view.flip ? -1 : 1;
  const turn = (x: number, y: number, z: number) => {
    const xr = x * cs - y * sn;
    const yr = x * sn + y * cs;
    const zr = z * sign;
    return [xr, yr * ct - zr * st, yr * st + zr * ct];
  };
  return (p: Float32Array, o: number): Projected => {
    const [x, y, depth] = turn(p[o], p[o + 1], p[o + 2]);
    const n = turn(p[o + 3], p[o + 4], p[o + 5]);
    const lambert = Math.abs(
      n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]
    );
    return {
      x: w / 2 + x * view.zoom,
      y: h / 2 + y * view.zoom,
      depth,
      shade: 0.28 + 0.72 * lambert + 0.3 * lambert ** 24,
      facing: n[2],
    };
  };
}

export function createValveRenderer(w: number, h: number) {
  const rgba = new Uint8ClampedArray(w * h * 4);
  const glow = new Float32Array(w * h * 3);
  const zbuf = new Float32Array(w * h);

  function background() {
    for (let y = 0; y < h; y++) {
      const t = y / h;
      for (let x = 0; x < w; x++) {
        const o = 4 * (x + w * y);
        rgba[o] = 3 + 4 * t;
        rgba[o + 1] = 8 + 14 * t;
        rgba[o + 2] = 16 + 26 * t;
        rgba[o + 3] = 255;
      }
    }
  }

  function drawHolo(points: Float32Array, view: ValveView) {
    glow.fill(0);
    const project = makeProjector(view, w, h);
    for (let o = 0; o < points.length; o += POINT_STRIDE) {
      const q = project(points, o);
      const x = Math.round(q.x);
      const y = Math.round(q.y);
      if (x < 0 || y < 0 || x >= w - 1 || y >= h - 1) continue;
      const c = HOLO_COLOR[points[o + 6]];
      const k = c[3] * (0.75 + 0.012 * q.depth);
      for (let d = 0; d < 4; d++) {
        const g = 3 * (x + (d & 1) + w * (y + (d >> 1)));
        glow[g] += c[0] * k;
        glow[g + 1] += c[1] * k;
        glow[g + 2] += c[2] * k;
      }
    }
    for (let i = 0; i < w * h; i++)
      for (let c = 0; c < 3; c++) {
        const lit = 255 * (1 - Math.exp(-glow[3 * i + c]));
        rgba[4 * i + c] = Math.max(rgba[4 * i + c], lit);
      }
  }

  function splat(q: Projected, color: number[], r: number) {
    const x0 = Math.round(q.x);
    const y0 = Math.round(q.y);
    if (x0 < r || y0 < r || x0 >= w - r || y0 >= h - r) return;
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const i = x0 + dx + w * (y0 + dy);
        if (q.depth <= zbuf[i]) continue;
        zbuf[i] = q.depth;
        rgba[4 * i] = color[0];
        rgba[4 * i + 1] = color[1];
        rgba[4 * i + 2] = color[2];
      }
  }

  function drawSolid(points: Float32Array, view: ValveView) {
    zbuf.fill(-Infinity);
    const project = makeProjector(view, w, h);
    const r = Math.max(1, Math.ceil(view.step * view.zoom * 0.6));
    for (let o = 0; o < points.length; o += POINT_STRIDE) {
      const q = project(points, o);
      const kind = points[o + 6];
      // corte: a parede do lado do observador (vista por fora) some, para
      // os folhetos aparecerem dentro da luz
      if (kind === KIND.wall && q.facing < -0.08) continue;
      const base = SOLID_COLOR[kind];
      const fog = Math.max(0.45, Math.min(1, 0.8 + 0.012 * q.depth));
      const k = q.shade * fog;
      splat(q, [base[0] * k, base[1] * k, base[2] * k], r);
    }
  }

  return {
    width: w,
    height: h,
    draw(points: Float32Array, view: ValveView) {
      background();
      if (view.style === 'holo') drawHolo(points, view);
      else drawSolid(points, view);
      return rgba;
    },
  };
}
