/**
 * CatStudio — cores por tecido: as contas.
 *
 * Uma paleta é uma lista de pontos ao longo da escala de densidade (HU), cada
 * um com nome, cor e opacidade. Entre dois pontos a cor e a opacidade variam
 * em linha reta. É o mesmo que a curva do VolView faz, mas com nomes, valores
 * em HU e cores escolhidas ponto a ponto.
 */
import { STOPS, TISSUE_STYLES, type TissueStyle } from './director/render3d';

export interface Stop {
  name: string;
  hu: number;
  /** #rrggbb */
  color: string;
  /** 0 a 1 */
  opacity: number;
}

export interface Palette {
  id: string;
  title: string;
  stops: Stop[];
  /** criada pela pessoa (pode ser apagada) */
  own?: boolean;
  /**
   * opacidade em "quanto apaga por milímetro" (como no diretor de arte), em
   * vez da opacidade por passo do VolView
   */
  extinction?: boolean;
}

/** Ajuste rápido por cima da paleta (os dois botões do mouse). */
export interface Tweak {
  /** desloca todos os pontos, em HU */
  shift: number;
  /** multiplica as opacidades */
  gain: number;
}

export const NO_TWEAK: Tweak = { shift: 0, gain: 1 };
export const TWEAK_LIMITS = { shift: [-1500, 1500], gain: [0.1, 4] } as const;

const stop = (name: string, hu: number, color: string, opacity: number) => ({
  name,
  hu,
  color,
  opacity,
});

const hex = (c: number) =>
  Math.round(Math.min(1, Math.max(0, c)) * 255)
    .toString(16)
    .padStart(2, '0');

const DIRECTOR_TITLES: Record<TissueStyle, [string, string]> = {
  tecidos: ['diretor-tecidos', 'Diretor: tecidos'],
  osso: ['diretor-osso', 'Diretor: osso'],
  vasos: ['diretor-vasos', 'Diretor: vasos'],
  pulmao: ['diretor-pulmao', 'Diretor: pulmões'],
};

/** As cores do diretor de arte, como paletas da vista 3D. */
export const DIRECTOR_PALETTES: Palette[] = TISSUE_STYLES.map((style) => ({
  id: DIRECTOR_TITLES[style][0],
  title: DIRECTOR_TITLES[style][1],
  extinction: true,
  stops: STOPS[style].map(([hu, r, g, b, alpha]) => ({
    name: `${hu} UH`,
    hu,
    color: `#${hex(r)}${hex(g)}${hex(b)}`,
    opacity: alpha,
  })),
}));

export const PALETTES: Palette[] = [
  // as do diretor de arte primeiro: é o visual preferido
  ...DIRECTOR_PALETTES,
  {
    id: 'natural',
    title: 'Natural',
    stops: [
      stop('Gordura', -80, '#e2c08d', 0),
      stop('Músculo', 60, '#a8402c', 0.12),
      stop('Contraste', 220, '#d9482f', 0.6),
      stop('Osso esponjoso', 420, '#eecfa3', 0.85),
      stop('Osso cortical', 900, '#fff6e6', 0.97),
    ],
  },
  {
    id: 'vascular',
    title: 'Vascular',
    stops: [
      stop('Partes moles', 90, '#4a0c0c', 0),
      stop('Vaso', 180, '#b01b1b', 0.5),
      stop('Vaso denso', 340, '#ea4a30', 0.88),
      stop('Cálcio', 620, '#ffdcb5', 0.94),
      stop('Osso cortical', 1200, '#ffffff', 1),
    ],
  },
  {
    id: 'osso',
    title: 'Osso marfim',
    stops: [
      stop('Partes moles', 140, '#6b4a2b', 0),
      stop('Osso esponjoso', 260, '#c8a878', 0.45),
      stop('Osso', 520, '#efe2c4', 0.88),
      stop('Osso cortical', 1500, '#fffdf5', 1),
    ],
  },
  {
    id: 'musculo',
    title: 'Músculo e osso',
    stops: [
      stop('Gordura', -60, '#7a2e1e', 0),
      stop('Músculo', 30, '#a8402c', 0.28),
      stop('Músculo denso', 120, '#c8553a', 0.55),
      stop('Osso esponjoso', 300, '#e9c7a0', 0.82),
      stop('Osso cortical', 800, '#fffaf0', 1),
    ],
  },
  {
    id: 'pulmao',
    title: 'Pulmão e vias aéreas',
    stops: [
      stop('Ar', -990, '#1f5fa8', 0),
      stop('Parênquima', -860, '#4aa3df', 0.07),
      stop('Vasos pulmonares', -550, '#a9dcf7', 0.16),
      stop('Parede', -250, '#ffffff', 0),
      stop('Partes moles', 120, '#c9442e', 0),
      stop('Contraste', 260, '#e8563a', 0.6),
      stop('Osso', 650, '#fff0dd', 0.92),
    ],
  },
  {
    id: 'vidro',
    title: 'Vidro azul',
    stops: [
      stop('Partes moles', 100, '#0b2545', 0),
      stop('Contraste', 300, '#3a7bd5', 0.16),
      stop('Osso', 800, '#a8d8ff', 0.5),
      stop('Osso cortical', 1500, '#ffffff', 0.9),
    ],
  },
  {
    id: 'metal',
    title: 'Metal e stents',
    stops: [
      stop('Osso', 500, '#5b6474', 0),
      stop('Cálcio denso', 1000, '#b0b8c8', 0.5),
      stop('Metal', 2500, '#ffffff', 1),
    ],
  },
];

const clamp = (value: number, low: number, high: number) =>
  Math.min(high, Math.max(low, value));

const finite = (value: unknown, or: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : or;

export function parseHex(color: string): [number, number, number] {
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  const value = match ? parseInt(match[1], 16) : 0x808080;
  return [(value >> 16) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

function sanitizeStop(raw: unknown): Stop | null {
  if (!raw || typeof raw !== 'object') return null;
  const input = raw as Partial<Stop>;
  if (typeof input.hu !== 'number' || !Number.isFinite(input.hu)) return null;
  const color = typeof input.color === 'string' ? input.color : '';
  return {
    name: typeof input.name === 'string' ? input.name.slice(0, 40) : '',
    hu: clamp(Math.round(input.hu), -2000, 6000),
    color: /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : '#808080',
    opacity: clamp(finite(input.opacity, 0), 0, 1),
  };
}

/** Pontos válidos, em ordem crescente de HU e sem dois no mesmo valor. */
export function sortedStops(stops: Stop[]): Stop[] {
  const sorted = [...stops].sort((a, b) => a.hu - b.hu);
  return sorted.filter((item, n) => n === 0 || item.hu > sorted[n - 1].hu);
}

/** Aceita o que veio do armazenamento local; null se não der para usar. */
export function sanitizePalette(raw: unknown): Palette | null {
  if (!raw || typeof raw !== 'object') return null;
  const input = raw as Partial<Palette>;
  const stops = Array.isArray(input.stops)
    ? sortedStops(
        input.stops.map(sanitizeStop).filter((s): s is Stop => s !== null)
      )
    : [];
  if (stops.length < 2 || typeof input.title !== 'string') return null;
  return {
    id: typeof input.id === 'string' ? input.id : `p${Date.now()}`,
    title: input.title.slice(0, 40) || 'Minha paleta',
    stops,
    own: true,
  };
}

/**
 * A paleta com o ajuste rápido aplicado. Com `extinction`, a opacidade da
 * paleta é "quanto apaga por mm" e vira opacidade por 1 mm de caminho.
 */
export function tweaked(
  palette: Palette,
  tweak: Tweak,
  extinction = false
): Stop[] {
  return sortedStops(palette.stops).map((item) => {
    const scaled = item.opacity * tweak.gain;
    return {
      ...item,
      hu: item.hu + tweak.shift,
      opacity: clamp(extinction ? 1 - Math.exp(-scaled) : scaled, 0, 1),
    };
  });
}

type Range = [number, number];

/** Os pontos que caem dentro da faixa de valores do exame (pelo menos 1). */
function within(stops: Stop[], range: Range): Stop[] {
  const inside = stops.filter((s) => s.hu > range[0] && s.hu < range[1]);
  if (inside.length) return inside;
  return [
    stops[stops.length - 1].hu <= range[0] ? stops[stops.length - 1] : stops[0],
  ];
}

/**
 * Pontos de cor para o vtk.js: [valor, r, g, b, …], cobrindo exatamente a
 * faixa do exame (o VolView reescala a curva para caber nela).
 */
export function colorPoints(stops: Stop[], range: Range): number[] {
  const inside = within(stops, range);
  const first = inside[0];
  const last = inside[inside.length - 1];
  return [
    [range[0], first.color] as const,
    ...inside.map((s) => [s.hu, s.color] as const),
    [range[1], last.color] as const,
  ].flatMap(([hu, color]) => [hu, ...parseHex(color)]);
}

export interface OpacityNode {
  x: number;
  y: number;
  midpoint: number;
  sharpness: number;
}

/** Opacidade num valor qualquer, pela reta entre os pontos vizinhos. */
export function opacityAt(stops: Stop[], hu: number): number {
  if (hu <= stops[0].hu) return hu < stops[0].hu ? 0 : stops[0].opacity;
  const last = stops[stops.length - 1];
  if (hu >= last.hu) return last.opacity;
  const next = stops.findIndex((s) => s.hu > hu);
  const [a, b] = [stops[next - 1], stops[next]];
  return a.opacity + ((hu - a.hu) / (b.hu - a.hu)) * (b.opacity - a.opacity);
}

/**
 * Nós de opacidade, com x de 0 a 1 ao longo da faixa do exame. Abaixo do
 * primeiro ponto é transparente; acima do último, vale a opacidade dele.
 */
export function opacityNodes(stops: Stop[], range: Range): OpacityNode[] {
  const width = range[1] - range[0];
  const node = (hu: number, y: number): OpacityNode => ({
    x: (hu - range[0]) / width,
    y,
    midpoint: 0.5,
    sharpness: 0,
  });
  const inside = stops.filter((s) => s.hu > range[0] && s.hu < range[1]);
  return [
    node(range[0], opacityAt(stops, range[0])),
    ...inside.map((s) => node(s.hu, s.opacity)),
    node(range[1], opacityAt(stops, range[1])),
  ];
}

/** Degradê CSS da paleta, para a barra de pré-visualização. */
export function gradientCss(stops: Stop[]): string {
  const sorted = sortedStops(stops);
  if (sorted.length < 2) return 'none';
  const low = sorted[0].hu;
  const width = sorted[sorted.length - 1].hu - low;
  const parts = sorted.map((s) => {
    const [r, g, b] = parseHex(s.color).map((c) => Math.round(c * 255));
    const alpha = s.opacity.toFixed(2);
    const at = (((s.hu - low) / width) * 100).toFixed(1);
    return `rgba(${r}, ${g}, ${b}, ${alpha}) ${at}%`;
  });
  return `linear-gradient(to right, ${parts.join(', ')})`;
}
