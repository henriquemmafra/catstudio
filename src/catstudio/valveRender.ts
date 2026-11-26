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
  /**
   * Corte: tudo o que está mais perto do observador do que esta profundidade
   * (mm a partir do centro do anel) não é desenhado. Ausente = sem corte.
   */
  clip?: number;
}

// cor por tipo (índice = KIND × 4): holograma em 0–1 com opacidade
const HOLO_COLOR = new Float32Array(12);
HOLO_COLOR.set([0.1, 0.45, 1.0, 0.14], 4 * KIND.wall);
HOLO_COLOR.set([0.25, 1.0, 0.95, 0.5], 4 * KIND.leaflet);
HOLO_COLOR.set([1.0, 0.75, 0.2, 0.8], 4 * KIND.calcium);
// sólido: refletância (linear, 0–1) de íntima, folheto e cálcio
const SOLID_COLOR = new Float32Array(12);
SOLID_COLOR.set([0.52, 0.17, 0.14, 0], 4 * KIND.wall);
SOLID_COLOR.set([0.7, 0.5, 0.39, 0], 4 * KIND.leaflet);
SOLID_COLOR.set([0.86, 0.8, 0.62, 0], 4 * KIND.calcium);
// brilho: endotélio úmido, folheto mais fosco, cálcio áspero
const GLOSS = new Float32Array(3);
GLOSS[KIND.wall] = 1;
GLOSS[KIND.leaflet] = 0.7;
GLOSS[KIND.calcium] = 0.12;
const KEY_COLOR = [1.0, 0.96, 0.9];
const AMBIENT = [0.8, 0.9, 1.1];
/** Luz que atravessa o tecido volta vermelha. */
const SCATTER = [0.9, 0.22, 0.14];
const AO_X = [1, 0.7, 0, -0.7, -1, -0.7, 0, 0.7];
const AO_Y = [0, 0.7, 1, 0.7, 0, -0.7, -1, -0.7];
const GAMMA = new Uint8ClampedArray(1024);
for (let i = 0; i < 1024; i++) GAMMA[i] = 255 * (i / 1023) ** (1 / 2.2);

/** Ruído de valor 3D suave em [0, 1] (determinístico). */
function hash3(i: number, j: number, k: number): number {
  let n =
    Math.imul(i, 374761393) ^
    Math.imul(j, 668265263) ^
    Math.imul(k, 2147483647);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}
function noise3(x: number, y: number, z: number): number {
  const i = Math.floor(x);
  const j = Math.floor(y);
  const k = Math.floor(z);
  const ease = (t: number) => t * t * (3 - 2 * t);
  const fx = ease(x - i);
  const fy = ease(y - j);
  const fz = ease(z - k);
  const mix = (a: number, b: number, t: number) => a + (b - a) * t;
  const plane = (dk: number) =>
    mix(
      mix(hash3(i, j, k + dk), hash3(i + 1, j, k + dk), fx),
      mix(hash3(i, j + 1, k + dk), hash3(i + 1, j + 1, k + dk), fx),
      fy
    );
  return mix(plane(0), plane(1), fz);
}

// luz principal (de cima, à esquerda, vinda do observador) e de preenchimento
const KEY = [-0.36, -0.46, 0.81];
const FILL = [0.55, 0.25, 0.8];

export function createValveRenderer(w: number, h: number) {
  const rgba = new Uint8ClampedArray(w * h * 4);
  const glow = new Float32Array(w * h * 3);
  const zbuf = new Float32Array(w * h);
  const nbuf = new Float32Array(w * h * 3);
  const cbuf = new Float32Array(w * h * 4);
  const materials = new WeakMap<ValveMesh, Float32Array>();
  const aoStep = new Int32Array(16);
  const aoMm = new Float32Array(16);
  let screen = new Float32Array(0); // x, y, profundidade por vértice
  let normal = new Float32Array(0); // normal girada por vértice
  let clip = Infinity;

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

  /** Cor e brilho por vértice (calculados uma vez por malha). */
  function materialOf(mesh: ValveMesh): Float32Array {
    const cached = materials.get(mesh);
    if (cached) return cached;
    const count = mesh.kinds.length;
    const out = new Float32Array(count * 4);
    const p = mesh.positions;
    for (let v = 0; v < count; v++) {
      const x = p[3 * v];
      const y = p[3 * v + 1];
      const z = p[3 * v + 2];
      // manchas largas (4–5 mm) e grão fino (1 mm): tecido não tem cor lisa
      const broad = noise3(x * 0.22, y * 0.22, z * 0.22);
      const fine = noise3(x * 0.9 + 31, y * 0.9 + 17, z * 0.9 + 5);
      const tone = 1 + 0.16 * (broad - 0.5) + 0.07 * (fine - 0.5);
      const base = 4 * mesh.kinds[v];
      // um pouco mais amarelado nas manchas claras (lipídio), mais rosado
      // nas escuras
      const warm = 0.06 * (broad - 0.5);
      out[4 * v] = SOLID_COLOR[base] * tone;
      out[4 * v + 1] = SOLID_COLOR[base + 1] * tone * (1 + warm);
      out[4 * v + 2] = SOLID_COLOR[base + 2] * tone * (1 - warm);
      out[4 * v + 3] = GLOSS[mesh.kinds[v]] * (0.75 + 0.5 * fine);
    }
    materials.set(mesh, out);
    return out;
  }

  /**
   * Sólido em duas etapas. 1) Geometria: profundidade, normal, cor e brilho
   * de cada pixel. 2) Luz: difusa "envolvente" com sombra avermelhada (a luz
   * atravessa um pouco o tecido), oclusão ambiente (reentrâncias mais
   * escuras, a partir da profundidade dos vizinhos), brilho úmido largo e
   * fraco em vez de reflexo de plástico, e curva de tons de filme.
   */
  function drawSolid(mesh: ValveMesh, view: ValveView) {
    zbuf.fill(-Infinity);
    const k = mesh.kinds;
    const mat = materialOf(mesh);
    raster(mesh, 0.02, (i, a, b, c, wa, wb, wc) => {
      const depth =
        wa * screen[3 * a + 2] +
        wb * screen[3 * b + 2] +
        wc * screen[3 * c + 2];
      if (depth > clip || depth <= zbuf[i]) return;
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
      nbuf[3 * i] = nx;
      nbuf[3 * i + 1] = ny;
      nbuf[3 * i + 2] = nz;
      for (let ch = 0; ch < 4; ch++)
        cbuf[4 * i + ch] =
          wa * mat[4 * a + ch] + wb * mat[4 * b + ch] + wc * mat[4 * c + ch];
    });

    // oclusão ambiente em dois raios (~1,2 mm e ~3,5 mm na tela)
    const radii = [
      Math.max(2, Math.round(1.2 * view.zoom)),
      Math.max(4, Math.round(3.5 * view.zoom)),
    ];
    for (let s = 0; s < 16; s++) {
      const r = radii[s >> 3];
      aoStep[s] = Math.round(AO_X[s & 7] * r) + w * Math.round(AO_Y[s & 7] * r);
      aoMm[s] = r / view.zoom;
    }
    const margin = radii[1] + 1;
    const hz = KEY[2] + 1;
    const hl = Math.hypot(KEY[0], KEY[1], hz);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = x + w * y;
        const z = zbuf[i];
        if (z === -Infinity) continue;
        // quanto os vizinhos estão à frente deste ponto (reentrância)
        let blocked = 0;
        if (x >= margin && y >= margin && x < w - margin && y < h - margin)
          for (let s = 0; s < 16; s++) {
            const dz = zbuf[i + aoStep[s]] - z;
            const mm = aoMm[s];
            if (dz > 0.15 && dz < 2.5 * mm) blocked += dz < mm ? dz / mm : 1;
          }
        const ao = 1 - 0.85 * Math.min(1, blocked / 7);
        const nx = nbuf[3 * i];
        const ny = nbuf[3 * i + 1];
        const nz = nbuf[3 * i + 2];
        const keyDot = nx * KEY[0] + ny * KEY[1] + nz * KEY[2];
        // difusa envolvente: a luz "dobra" um pouco além do terminador
        const key = keyDot > -0.3 ? (keyDot + 0.3) / 1.3 : 0;
        const fillDot = nx * FILL[0] + ny * FILL[1] + nz * FILL[2];
        const fill = fillDot > 0 ? fillDot : 0;
        // onde a luz principal não chega direto, o tecido fica avermelhado
        const grazing = 0.5 - Math.abs(keyDot);
        const through = grazing > 0 ? grazing * 0.4 : 0;
        const gloss = cbuf[4 * i + 3];
        const sdot = (nx * KEY[0] + ny * KEY[1] + nz * hz) / hl;
        // brilho úmido: largo e fraco, com um ponto pequeno mais vivo
        let sheen = 0;
        if (sdot > 0.6) {
          const s2 = sdot * sdot;
          const s8 = s2 * s2 * s2 * s2;
          sheen = 0.05 * s8 + (sdot > 0.93 ? 0.16 * s8 ** 8 : 0);
        }
        const side = 1 - nz;
        const fog = Math.max(0.5, Math.min(1, 0.84 + 0.011 * z));
        const amb = 0.13 * (0.75 - 0.25 * ny) * ao;
        const diff = (0.7 * key * (0.35 + 0.65 * ao) + 0.14 * fill * ao) * fog;
        const spec = (sheen * ao + 0.04 * side * side * side) * gloss * fog;
        for (let ch = 0; ch < 3; ch++) {
          const albedo = cbuf[4 * i + ch];
          const lit =
            albedo *
              (amb * AMBIENT[ch] +
                diff * KEY_COLOR[ch] +
                through * SCATTER[ch] * ao) +
            spec;
          // curva de filme (ACES aproximada) e gama
          const t =
            (lit * (2.51 * lit + 0.03)) / (lit * (2.43 * lit + 0.59) + 0.14);
          rgba[4 * i + ch] = GAMMA[t >= 1 ? 1023 : (t * 1023) | 0];
        }
      }
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
      if (depth > clip) return;
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
      clip = view.clip ?? Infinity;
      if (view.style === 'holo') drawHolo(mesh);
      else drawSolid(mesh, view);
      return rgba;
    },
  };
}
