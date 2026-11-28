/**
 * CatStudio — modo por tipo de exame (tórax, angio, cardíaco, abdome, livre).
 * O modo não muda o motor: escolhe a janela dos cortes, as cores do 3D e
 * quais ferramentas ficam à mão. Nada é escondido de verdade: o que não é do
 * modo fica em "Mais ferramentas".
 *
 * A detecção olha a descrição do estudo e da série (lidas aqui mesmo, no
 * navegador) e, se elas não dizem nada, se o exame tem pulmões.
 */
import { reactive } from 'vue';
import type { Regions } from './examRegions';

export type ExamMode = 'torax' | 'angio' | 'cardio' | 'abdome' | 'livre';

/** Ferramentas que um modo pode pôr em destaque. */
export type ModeTool = 'pulmoes' | 'coracao' | 'valvas' | 'cavidade';

export interface ModeSpec {
  title: string;
  icon: string;
  /** janela dos cortes (nome em WLPresetsCT); null = não mexe */
  window: string | null;
  /** cores do 3D (id da paleta); null = não mexe */
  palette: string | null;
  tools: ModeTool[];
}

export const MODES: Record<ExamMode, ModeSpec> = {
  torax: {
    title: 'Tórax',
    icon: 'mdi-lungs',
    window: 'Pulmão',
    palette: null,
    tools: ['pulmoes', 'coracao'],
  },
  angio: {
    title: 'Angio',
    icon: 'mdi-water',
    window: 'Angio',
    palette: 'diretor-vasos',
    tools: ['coracao'],
  },
  cardio: {
    title: 'Coronária / cardíaco',
    icon: 'mdi-heart',
    window: 'Angio',
    palette: 'diretor-vasos',
    tools: ['coracao', 'valvas', 'cavidade'],
  },
  abdome: {
    title: 'Abdome',
    icon: 'mdi-stomach',
    window: 'Partes moles',
    palette: 'diretor-tecidos',
    tools: [],
  },
  livre: {
    title: 'Livre (tudo à mão)',
    icon: 'mdi-tune-variant',
    window: null,
    palette: null,
    tools: ['pulmoes', 'coracao', 'valvas', 'cavidade'],
  },
};

export const MODE_ORDER: ExamMode[] = [
  'torax',
  'angio',
  'cardio',
  'abdome',
  'livre',
];

/**
 * Palavras que denunciam o tipo de exame, na ordem em que valem: "angio
 * coronariana" é cardíaco, "angiotomografia de tórax" é angio.
 */
const HINTS: [ExamMode, RegExp][] = [
  ['cardio', /coron|cardi|coracao|heart|ccta|calcio|calcium|tavi|valv/],
  ['angio', /angio|aort|\bcta\b|\btep\b|embol|runoff|vascular/],
  ['torax', /torax|torac|chest|thora|pulm|lung/],
  ['abdome', /abd|pelv|figado|liver|hepat|renal|\brins?\b|uro|entero|pancre/],
];

const plain = (text: string) =>
  text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** O modo que o texto indica, com a palavra que decidiu; null se nenhuma. */
export function modeFromText(
  text: string
): { mode: ExamMode; word: string } | null {
  const clean = plain(text);
  for (let at = 0; at < HINTS.length; at++) {
    const found = HINTS[at][1].exec(clean);
    if (found) return { mode: HINTS[at][0], word: found[0] };
  }
  return null;
}

export interface Detection {
  mode: ExamMode;
  /** por que este modo, para mostrar a quem usa */
  why: string;
  /** onde ficam o tórax e o abdome, quando o exame tem pulmões */
  regions?: Regions;
}

/** Decide o modo pelas descrições e, sem elas, pelos pulmões. */
export function detectMode(clues: {
  texts: string[];
  hasLungs: () => boolean;
}): Detection {
  const fromText = modeFromText(clues.texts.filter(Boolean).join(' | '));
  if (fromText)
    return {
      mode: fromText.mode,
      why: `a descrição do exame tem "${fromText.word}"`,
    };
  if (clues.hasLungs()) return { mode: 'torax', why: 'o exame tem pulmões' };
  return { mode: 'livre', why: 'não reconheci o tipo de exame' };
}

export interface ModeState extends Detection {
  /** escolhido pela detecção (e não por quem usa) */
  auto: boolean;
  /** sobe a cada escolha: as vistas aplicam a janela e as cores de novo */
  stamp: number;
  /** a pergunta "tórax, abdome ou aorta total?" já foi respondida ou fechada */
  asked: boolean;
  /**
   * recorte dos cortes 2D: faixa de fatias axiais (índices) da região
   * escolhida; null = exame inteiro
   */
  sliceRange: [number, number] | null;
}

/** Modo de cada exame aberto. */
export const examModes = reactive<Record<string, ModeState>>({});

const KEY = 'catstudio.modo.detectar';

function stored(): boolean {
  try {
    return localStorage.getItem(KEY) !== '0';
  } catch {
    return true;
  }
}

/** Detectar o modo ao abrir um exame (dá para desligar). */
export const modeSettings = reactive({ detect: stored() });

export function setDetect(on: boolean) {
  modeSettings.detect = on;
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    // sem armazenamento: vale só nesta sessão
  }
}

let stamps = 0;

export function setMode(imageID: string, detection: Detection, auto: boolean) {
  stamps += 1;
  const previous = examModes[imageID];
  examModes[imageID] = {
    ...detection,
    regions: detection.regions ?? previous?.regions,
    auto,
    stamp: stamps,
    // quem escolhe o modo à mão já decidiu; detectar de novo pergunta de novo
    asked: !auto,
    sliceRange: null,
  };
}

/** O modo do exame (livre enquanto nada foi escolhido). */
export const modeOf = (imageID: string | null | undefined): ExamMode =>
  (imageID && examModes[imageID]?.mode) || 'livre';

/** A ferramenta fica em destaque neste exame? */
export const showsTool = (imageID: string | null | undefined, tool: ModeTool) =>
  MODES[modeOf(imageID)].tools.includes(tool);
