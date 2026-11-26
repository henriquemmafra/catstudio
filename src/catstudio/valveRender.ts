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
import {
  LIGHT_LIMITS,
  clampTo,
  lightBasis,
  lightVector,
  type ValveLight,
} from './valveLight';

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
   * Giro livre: matriz 3×3 (por linhas) do sistema do anel para a tela
   * (x para a direita, y para baixo, z para o observador). Quando presente,
   * substitui spin, tilt e flip.
   */
  rot?: ArrayLike<number>;
  /** Rascunho rápido (sem sombras nem oclusão), para girar em máquina lenta. */
  fast?: boolean;
  /**
   * Corte: tudo o que está mais perto do observador do que esta profundidade
   * (mm a partir do centro do anel) não é desenhado. Ausente = sem corte.
   */
  clip?: number;
  /** Cor do fundo (0–255 por canal). Ausente = azul-escuro padrão. */
  background?: readonly [number, number, number];
  /** Luz principal do modo sólido. Ausente = luz padrão. */
  light?: ValveLight;
}

// luz principal padrão (de cima, à esquerda, vinda do observador) e de
// preenchimento; a principal pode ser trocada por `view.light`
const DEFAULT_KEY = [-0.36, -0.46, 0.81];
const FILL = [0.55, 0.25, 0.8];

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
// mapa de sombras: a cena vista da luz principal (projeção paralela)
const SHADOW_SIZE = 512;
/** Meia-largura coberta pelo mapa, em mm. */
const SHADOW_EXTENT = 52;
const SHADOW_SCALE = SHADOW_SIZE / (2 * SHADOW_EXTENT);
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

/** Matriz da vista por giro em torno do eixo da valva e inclinação. */
export function viewMatrix(spin: number, tilt: number, flip = false): number[] {
  const cs = Math.cos(spin);
  const sn = Math.sin(spin);
  const ct = Math.cos(tilt);
  const st = Math.sin(tilt);
  const sign = flip ? -1 : 1;
  return [
    cs,
    -sn,
    0,
    sn * ct,
    cs * ct,
    -st * sign,
    sn * st,
    cs * st,
    ct * sign,
  ];
}

/** Compõe a matriz com um giro em torno dos eixos da tela (arrastar). */
export function turnOnScreen(
  m: ArrayLike<number>,
  right: number,
  down: number
) {
  const ca = Math.cos(right);
  const sa = Math.sin(right);
  const cb = Math.cos(down);
  const sb = Math.sin(down);
  const out = new Array<number>(9);
  for (let c = 0; c < 3; c++) {
    // em torno de y da tela (arrastar para os lados)...
    const x = m[c] * ca + m[6 + c] * sa;
    const z = -m[c] * sa + m[6 + c] * ca;
    // ...e depois em torno de x da tela (arrastar para cima e para baixo)
    out[c] = x;
    out[3 + c] = m[3 + c] * cb + z * sb;
    out[6 + c] = -m[3 + c] * sb + z * cb;
  }
  return out;
}

/** Compõe a matriz com um giro em torno do eixo da valva (giro automático). */
export function turnOnAxis(m: ArrayLike<number>, angle: number) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const out = Array.from(m);
  for (let r = 0; r < 3; r++) {
    out[3 * r] = m[3 * r] * c + m[3 * r + 1] * s;
    out[3 * r + 1] = -m[3 * r] * s + m[3 * r + 1] * c;
  }
  return out;
}

export function createValveRenderer(w: number, h: number) {
  const rgba = new Uint8ClampedArray(w * h * 4);
  const glow = new Float32Array(w * h * 3);
  const zbuf = new Float32Array(w * h);
  const nbuf = new Float32Array(w * h * 3);
  const cbuf = new Float32Array(w * h * 4);
  const materials = new WeakMap<ValveMesh, Float32Array>();
  const shadow = new Float32Array(SHADOW_SIZE * SHADOW_SIZE);
  let lightPos = new Float32Array(0); // x, y (texels) e distância à luz, por vértice
  const aoStep = new Int32Array(16);
  const aoMm = new Float32Array(16);
  let screen = new Float32Array(0); // x, y, profundidade por vértice
  let normal = new Float32Array(0); // normal girada por vértice
  let clip = Infinity;
  // luz principal do quadro em curso
  let KEY: ArrayLike<number> = DEFAULT_KEY;
  let { la: LA, lb: LB } = lightBasis(DEFAULT_KEY);
  let keyGain = 1;
  let shadowGain = 1;

  function setLight(light: ValveLight | undefined) {
    KEY = light ? lightVector(light.direction, light.height) : DEFAULT_KEY;
    ({ la: LA, lb: LB } = lightBasis(KEY));
    keyGain = light ? clampTo(light.intensity, LIGHT_LIMITS.intensity) : 1;
    shadowGain = light ? clampTo(light.shadow, LIGHT_LIMITS.shadow) : 1;
  }

  function background(color: ValveView['background']) {
    // padrão: azul-escuro em degradê; cor escolhida: degradê leve (o alto
    // 15% mais escuro), para o fundo branco continuar branco
    const top = color ? color.map((c) => 0.85 * c) : [3, 8, 16];
    const bottom = color ?? [7, 22, 42];
    for (let y = 0; y < h; y++) {
      const t = y / h;
      const r = top[0] + (bottom[0] - top[0]) * t;
      const g = top[1] + (bottom[1] - top[1]) * t;
      const b = top[2] + (bottom[2] - top[2]) * t;
      for (let x = 0; x < w; x++) {
        const o = 4 * (x + w * y);
        rgba[o] = r;
        rgba[o + 1] = g;
        rgba[o + 2] = b;
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
    const m = view.rot ?? viewMatrix(view.spin, view.tilt, view.flip);
    const p = mesh.positions;
    const n = mesh.normals;
    for (let v = 0; v < count; v++) {
      const o = 3 * v;
      const x = p[o];
      const y = p[o + 1];
      const z = p[o + 2];
      screen[o] = w / 2 + (m[0] * x + m[1] * y + m[2] * z) * view.zoom;
      screen[o + 1] = h / 2 + (m[3] * x + m[4] * y + m[5] * z) * view.zoom;
      screen[o + 2] = m[6] * x + m[7] * y + m[8] * z;
      const nx = n[o];
      const ny = n[o + 1];
      const nz = n[o + 2];
      normal[o] = m[0] * nx + m[1] * ny + m[2] * nz;
      normal[o + 1] = m[3] * nx + m[4] * ny + m[5] * nz;
      normal[o + 2] = m[6] * nx + m[7] * ny + m[8] * nz;
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

  /**
   * Mapa de sombras: profundidade da cena vista da luz principal. Não entram
   * os triângulos que a vista também não desenha (a parede cortada do lado do
   * observador e o que o corte tirou) — senão fariam sombra sem aparecer.
   */
  function castShadows(mesh: ValveMesh, view: ValveView) {
    const count = mesh.kinds.length;
    if (lightPos.length < count * 3) lightPos = new Float32Array(count * 3);
    for (let v = 0; v < count; v++) {
      const x = (screen[3 * v] - w / 2) / view.zoom;
      const y = (screen[3 * v + 1] - h / 2) / view.zoom;
      const z = screen[3 * v + 2];
      lightPos[3 * v] =
        SHADOW_SIZE / 2 + (x * LA[0] + y * LA[1] + z * LA[2]) * SHADOW_SCALE;
      lightPos[3 * v + 1] =
        SHADOW_SIZE / 2 + (x * LB[0] + y * LB[1] + z * LB[2]) * SHADOW_SCALE;
      lightPos[3 * v + 2] = x * KEY[0] + y * KEY[1] + z * KEY[2];
    }
    shadow.fill(-Infinity);
    const idx = mesh.indices;
    const k = mesh.kinds;
    const S = SHADOW_SIZE;
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t];
      const b = idx[t + 1];
      const c = idx[t + 2];
      const za = screen[3 * a + 2];
      const zb = screen[3 * b + 2];
      const zc = screen[3 * c + 2];
      if (za > clip && zb > clip && zc > clip) continue;
      const wall =
        k[a] === KIND.wall && k[b] === KIND.wall && k[c] === KIND.wall;
      const facing = normal[3 * a + 2] + normal[3 * b + 2] + normal[3 * c + 2];
      if (wall && facing < -0.24) continue;
      const ax = lightPos[3 * a];
      const ay = lightPos[3 * a + 1];
      const bx = lightPos[3 * b];
      const by = lightPos[3 * b + 1];
      const cx = lightPos[3 * c];
      const cy = lightPos[3 * c + 1];
      const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      if (Math.abs(area) < 1e-6) continue;
      const x0 = Math.max(0, Math.ceil(Math.min(ax, bx, cx) - 0.5));
      const x1 = Math.min(S - 1, Math.floor(Math.max(ax, bx, cx) + 0.5));
      const y0 = Math.max(0, Math.ceil(Math.min(ay, by, cy) - 0.5));
      const y1 = Math.min(S - 1, Math.floor(Math.max(ay, by, cy) + 0.5));
      const inv = 1 / area;
      const da = lightPos[3 * a + 2];
      const db = lightPos[3 * b + 2];
      const dc = lightPos[3 * c + 2];
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const wa = ((bx - x) * (cy - y) - (by - y) * (cx - x)) * inv;
          const wb = ((cx - x) * (ay - y) - (cy - y) * (ax - x)) * inv;
          const wc = 1 - wa - wb;
          if (wa < -0.02 || wb < -0.02 || wc < -0.02) continue;
          const d = wa * da + wb * db + wc * dc;
          if (d > shadow[x + S * y]) shadow[x + S * y] = d;
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

    const full = view.fast !== true;
    if (full) castShadows(mesh, view);
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
        if (
          full &&
          x >= margin &&
          y >= margin &&
          x < w - margin &&
          y < h - margin
        )
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
        // sombra projetada: há algo entre este ponto e a luz? (25 amostras
        // em volta, para a borda da sombra sair suave)
        let lit = 1;
        if (full && keyDot > -0.3) {
          const px = (x - w / 2) / view.zoom;
          const py = (y - h / 2) / view.zoom;
          const lu =
            SHADOW_SIZE / 2 +
            (px * LA[0] + py * LA[1] + z * LA[2]) * SHADOW_SCALE;
          const lv =
            SHADOW_SIZE / 2 +
            (px * LB[0] + py * LB[1] + z * LB[2]) * SHADOW_SCALE;
          const ld = px * KEY[0] + py * KEY[1] + z * KEY[2];
          // folga maior onde a luz é rasante (evita sombra da própria face)
          const bias = 0.5 + 1.2 * (1 - Math.max(0, keyDot));
          const iu = Math.round(lu);
          const iv = Math.round(lv);
          if (
            iu > 2 &&
            iv > 2 &&
            iu < SHADOW_SIZE - 3 &&
            iv < SHADOW_SIZE - 3
          ) {
            let dark = 0;
            for (let dv = -2; dv <= 2; dv++)
              for (let du = -2; du <= 2; du++)
                if (shadow[iu + du + SHADOW_SIZE * (iv + dv)] > ld + bias)
                  dark += 1;
            lit = 1 - (shadowGain * dark) / 25;
          }
        }
        const key = keyDot > -0.3 ? ((keyDot + 0.3) / 1.3) * lit : 0;
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
        const amb = 0.12 * (0.75 - 0.25 * ny) * ao;
        const diff =
          (0.85 * keyGain * key * (0.35 + 0.65 * ao) + 0.12 * fill * ao) * fog;
        const spec =
          (keyGain * sheen * ao * lit + 0.04 * side * side * side) *
          gloss *
          fog;
        for (let ch = 0; ch < 3; ch++) {
          const albedo = cbuf[4 * i + ch];
          const out =
            albedo *
              (amb * AMBIENT[ch] +
                diff * KEY_COLOR[ch] +
                through * SCATTER[ch] * ao) +
            spec;
          // curva de filme (ACES aproximada) e gama
          const t =
            (out * (2.51 * out + 0.03)) / (out * (2.43 * out + 0.59) + 0.14);
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
      background(view.background);
      setLight(view.light);
      project(mesh, view);
      clip = view.clip ?? Infinity;
      if (view.style === 'holo') drawHolo(mesh);
      else drawSolid(mesh, view);
      return rgba;
    },
  };
}

export { DEFAULT_LIGHT, LIGHT_LIMITS, lightVector } from './valveLight';
export type { ValveLight } from './valveLight';
