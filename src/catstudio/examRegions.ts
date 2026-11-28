/**
 * CatStudio — exame que pega tórax e abdome juntos: acha, pela altura dos
 * pulmões, onde fica cada região, para oferecer o recorte de uma ou da outra
 * (ou o exame inteiro, para a aorta total). Alturas em mm no eixo
 * pés-cabeça do paciente (cresce para a cabeça).
 */
export type Range = [number, number];

export interface Regions {
  /** o exame desce bem além da base dos pulmões: tem abdome junto */
  combined: boolean;
  torax: Range;
  abdome: Range;
  whole: Range;
}

/** Folga acima do ápice e abaixo da base dos pulmões no recorte do tórax. */
const ABOVE_APEX_MM = 30;
const BELOW_BASE_MM = 15;
/**
 * As cúpulas do diafragma sobem dentro da altura dos pulmões: o abdome
 * começa a esta fração da altura deles, contada da base.
 */
const DOME_SHARE = 0.25;
/** Abaixo da base, a partir desta fração da altura dos pulmões, há abdome. */
const ABDOMEN_SHARE = 0.5;

const clamp = (value: number, [low, high]: Range) =>
  Math.min(high, Math.max(low, value));

/** As regiões do exame, dadas a altura dos pulmões e a do volume. */
export function regionsFromLungs(lungs: Range, volume: Range): Regions {
  const [base, apex] = lungs;
  const height = apex - base;
  return {
    combined: base - volume[0] >= ABDOMEN_SHARE * height,
    torax: [
      clamp(base - BELOW_BASE_MM, volume),
      clamp(apex + ABOVE_APEX_MM, volume),
    ],
    abdome: [volume[0], clamp(base + DOME_SHARE * height, volume)],
    whole: volume,
  };
}

/** Altura (mm) da base e do ápice dos pulmões na grade; null se não há. */
export function lungHeights(lungs: {
  n: [number, number, number];
  min: [number, number, number];
  step: number;
  mask: Uint8Array;
}): Range | null {
  const perSlice = lungs.n[0] * lungs.n[1];
  let first = -1;
  let last = -1;
  for (let k = 0; k < lungs.n[2]; k++) {
    if (!lungs.mask.subarray(k * perSlice, (k + 1) * perSlice).includes(1))
      continue;
    if (first < 0) first = k;
    last = k;
  }
  if (first < 0) return null;
  return [lungs.min[2] + first * lungs.step, lungs.min[2] + last * lungs.step];
}

export type RegionChoice = 'torax' | 'abdome' | 'aorta';

export const REGION_CHOICES: {
  id: RegionChoice;
  title: string;
  hint: string;
  icon: string;
}[] = [
  {
    id: 'torax',
    title: 'Tórax',
    hint: 'recorta o 3D no tórax, janela de pulmão',
    icon: 'mdi-lungs',
  },
  {
    id: 'abdome',
    title: 'Abdome',
    hint: 'recorta o 3D no abdome, janela de partes moles',
    icon: 'mdi-stomach',
  },
  {
    id: 'aorta',
    title: 'Aorta total',
    hint: 'exame inteiro, janela e cores de angio',
    icon: 'mdi-water',
  },
];
