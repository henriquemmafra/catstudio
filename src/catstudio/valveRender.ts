/**
 * CatStudio — desenho do modo Valvas (sem DOM: escreve num RGBA).
 *
 * Dois estilos sobre a mesma malha:
 *  - holograma: superfície translúcida somada, mais brilhante nas bordas
 *    (onde a superfície fica de perfil), com os folhetos em destaque;
 *  - sólido: superfície opaca com profundidade e iluminação por pixel.
 * É um rasterizador de triângulos em CPU, de propósito: roda em estação sem
 * placa de vídeo boa e não disputa memória de vídeo com as outras vistas.
 * A normal é interpolada dentro de cada triângulo, então a superfície sai
 * lisa em vez de mostrar os voxels.
 */
import { KIND, type ValveMesh } from './valve';

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
}

// cor por tipo (índice = KIND × 4): holograma em 0–1 com opacidade; sólido em 0–255
const HOLO_COLOR = new Float32Array(12);
HOLO_COLOR.set([0.1, 0.45, 1.0, 0.14], 4 * KIND.wall);
HOLO_COLOR.set([0.25, 1.0, 0.95, 0.5], 4 * KIND.leaflet);
HOLO_COLOR.set([1.0, 0.75, 0.2, 0.8], 4 * KIND.calcium);
const SOLID_COLOR = new Float32Array(12);
SOLID_COLOR.set([186, 96, 98, 0], 4 * KIND.wall);
SOLID_COLOR.set([242, 216, 198, 0], 4 * KIND.leaflet);
SOLID_COLOR.set([255, 250, 225, 0], 4 * KIND.calcium);
// luz principal (de cima, à esquerda, vinda do observador) e de preenchimento
const KEY = [-0.36, -0.46, 0.81];
const FILL = [0.55, 0.25, 0.8];

export function createValveRenderer(w: number, h: number) {
  const rgba = new Uint8ClampedArray(w * h * 4);
  const glow = new Float32Array(w * h * 3);
  const zbuf = new Float32Array(w * h);
  let screen = new Float32Array(0); // x, y, profundidade por vértice
  let normal = new Float32Array(0); // normal girada por vértice

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

  function project(mesh: ValveMesh, view: ValveView) {
    const count = mesh.kinds.length;
    if (screen.length < count * 3) {
      screen = new Float32Array(count * 3);
      normal = new Float32Array(count * 3);
    }
    const cs = Math.cos(view.spin);
    const sn = Math.sin(view.spin);
    const ct = Math.cos(view.tilt);
    const st = Math.sin(view.tilt);
    const sign = view.flip ? -1 : 1;
    const p = mesh.positions;
    const n = mesh.normals;
    for (let v = 0; v < count; v++) {
      const o = 3 * v;
      let xr = p[o] * cs - p[o + 1] * sn;
      let yr = p[o] * sn + p[o + 1] * cs;
      let zr = p[o + 2] * sign;
      screen[o] = w / 2 + xr * view.zoom;
      screen[o + 1] = h / 2 + (yr * ct - zr * st) * view.zoom;
      screen[o + 2] = yr * st + zr * ct;
      xr = n[o] * cs - n[o + 1] * sn;
      yr = n[o] * sn + n[o + 1] * cs;
      zr = n[o + 2] * sign;
      normal[o] = xr;
      normal[o + 1] = yr * ct - zr * st;
      normal[o + 2] = yr * st + zr * ct;
    }
  }

  /**
   * Percorre os pixels de cada triângulo com pesos baricêntricos. `slack` é a
   * folga na borda: no sólido evita frestas entre triângulos vizinhos; no
   * holograma (que soma) tem de ser zero, senão a borda conta duas vezes.
   */
  function raster(
    mesh: ValveMesh,
    slack: number,
    pixel: (
      i: number,
      a: number,
      b: number,
      c: number,
      wa: number,
      wb: number,
      wc: number
    ) => void
  ) {
    const idx = mesh.indices;
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t];
      const b = idx[t + 1];
      const c = idx[t + 2];
      const ax = screen[3 * a];
      const ay = screen[3 * a + 1];
      const bx = screen[3 * b];
      const by = screen[3 * b + 1];
      const cx = screen[3 * c];
      const cy = screen[3 * c + 1];
      const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      if (Math.abs(area) < 1e-6) continue;
      const x0 = Math.max(0, Math.ceil(Math.min(ax, bx, cx) - 0.5));
      const x1 = Math.min(w - 1, Math.floor(Math.max(ax, bx, cx) + 0.5));
      const y0 = Math.max(0, Math.ceil(Math.min(ay, by, cy) - 0.5));
      const y1 = Math.min(h - 1, Math.floor(Math.max(ay, by, cy) + 0.5));
      const inv = 1 / area;
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const wa = ((bx - x) * (cy - y) - (by - y) * (cx - x)) * inv;
          const wb = ((cx - x) * (ay - y) - (cy - y) * (ax - x)) * inv;
          const wc = 1 - wa - wb;
          if (wa < -slack || wb < -slack || wc < -slack) continue;
          pixel(x + w * y, a, b, c, wa, wb, wc);
        }
    }
  }

  function drawSolid(mesh: ValveMesh) {
    zbuf.fill(-Infinity);
    const k = mesh.kinds;
    raster(mesh, 0.02, (i, a, b, c, wa, wb, wc) => {
      const depth =
        wa * screen[3 * a + 2] +
        wb * screen[3 * b + 2] +
        wc * screen[3 * c + 2];
      if (depth <= zbuf[i]) return;
      let nx = wa * normal[3 * a] + wb * normal[3 * b] + wc * normal[3 * c];
      let ny =
        wa * normal[3 * a + 1] +
        wb * normal[3 * b + 1] +
        wc * normal[3 * c + 1];
      let nz =
        wa * normal[3 * a + 2] +
        wb * normal[3 * b + 2] +
        wc * normal[3 * c + 2];
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;
      const wall =
        k[a] === KIND.wall && k[b] === KIND.wall && k[c] === KIND.wall;
      // corte: a parede do lado do observador (vista por fora) some, para
      // os folhetos aparecerem dentro da luz
      if (wall && nz < -0.08) return;
      if (nz < 0) {
        nx = -nx;
        ny = -ny;
        nz = -nz;
      }
      zbuf[i] = depth;
      const key = Math.max(0, nx * KEY[0] + ny * KEY[1] + nz * KEY[2]);
      const fill = Math.max(0, nx * FILL[0] + ny * FILL[1] + nz * FILL[2]);
      // brilho especular (meio-vetor entre a luz principal e o observador)
      const hz = KEY[2] + 1;
      const hl = Math.hypot(KEY[0], KEY[1], hz);
      const sdot = (nx * KEY[0] + ny * KEY[1] + nz * hz) / hl;
      const spec = sdot > 0.9 ? sdot ** 40 : 0;
      const fog = Math.max(0.5, Math.min(1, 0.82 + 0.012 * depth));
      // escurece o que está de perfil: dá volume às bordas
      const rim = 0.72 + 0.28 * nz;
      const light = (0.2 + 0.68 * key + 0.2 * fill) * fog * rim;
      const ca = 4 * k[a];
      const cb = 4 * k[b];
      const cc = 4 * k[c];
      for (let ch = 0; ch < 3; ch++)
        rgba[4 * i + ch] =
          (wa * SOLID_COLOR[ca + ch] +
            wb * SOLID_COLOR[cb + ch] +
            wc * SOLID_COLOR[cc + ch]) *
            light +
          150 * spec * fog;
    });
  }

  function drawHolo(mesh: ValveMesh) {
    glow.fill(0);
    const k = mesh.kinds;
    raster(mesh, 0, (i, a, b, c, wa, wb, wc) => {
      const nz =
        wa * normal[3 * a + 2] +
        wb * normal[3 * b + 2] +
        wc * normal[3 * c + 2];
      const depth =
        wa * screen[3 * a + 2] +
        wb * screen[3 * b + 2] +
        wc * screen[3 * c + 2];
      // de perfil a superfície acumula mais luz (efeito de vidro)
      const edge = 1 - Math.min(1, Math.abs(nz));
      const gain = (0.3 + 1.5 * edge * edge) * (0.8 + 0.012 * depth);
      const ca = 4 * k[a];
      const cb = 4 * k[b];
      const cc = 4 * k[c];
      const alpha =
        (wa * HOLO_COLOR[ca + 3] +
          wb * HOLO_COLOR[cb + 3] +
          wc * HOLO_COLOR[cc + 3]) *
        gain;
      for (let ch = 0; ch < 3; ch++)
        glow[3 * i + ch] +=
          (wa * HOLO_COLOR[ca + ch] +
            wb * HOLO_COLOR[cb + ch] +
            wc * HOLO_COLOR[cc + ch]) *
          alpha;
    });
    for (let i = 0; i < w * h; i++) {
      if (!glow[3 * i + 2] && !glow[3 * i]) continue;
      for (let ch = 0; ch < 3; ch++) {
        const lit = 255 * (1 - Math.exp(-glow[3 * i + ch]));
        if (lit > rgba[4 * i + ch]) rgba[4 * i + ch] = lit;
      }
    }
  }

  return {
    width: w,
    height: h,
    draw(mesh: ValveMesh, view: ValveView) {
      background();
      project(mesh, view);
      if (view.style === 'holo') drawHolo(mesh);
      else drawSolid(mesh);
      return rgba;
    },
  };
}
