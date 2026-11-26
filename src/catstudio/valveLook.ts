/**
 * CatStudio — aparência escolhida no modo Valvas: cor do fundo e luz
 * principal (direção, altura, intensidade e força da sombra). Fica guardada
 * no navegador para a próxima vez.
 */
import { reactive, watch } from 'vue';
import {
  DEFAULT_LIGHT,
  LIGHT_LIMITS,
  type ValveLight,
} from '@/src/catstudio/valveLight';

export interface ValveLook {
  /** Cor do fundo em #rrggbb; vazio = azul-escuro padrão. */
  background: string;
  light: ValveLight;
}

export const BACKGROUND_PRESETS = [
  { label: 'Padrão', value: '' },
  { label: 'Preto', value: '#000000' },
  { label: 'Cinza', value: '#5a5f66' },
  { label: 'Branco', value: '#ffffff' },
] as const;

export const defaultLook = (): ValveLook => ({
  background: '',
  light: { ...DEFAULT_LIGHT },
});

const HEX = /^#[0-9a-f]{6}$/i;

/** #rrggbb → [r, g, b]; cor inválida ou vazia → undefined (fundo padrão). */
export function parseColor(hex: string): [number, number, number] | undefined {
  if (!HEX.test(hex)) return undefined;
  return [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16)) as [
    number,
    number,
    number,
  ];
}

/** O fundo é claro o bastante para pedir texto escuro por cima? */
export function isLight(hex: string) {
  const rgb = parseColor(hex);
  if (!rgb) return false;
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2] > 140;
}

const within = (value: unknown, min: number, max: number, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;

/** Aceita o que estiver guardado; o que faltar ou vier errado vira padrão. */
export function sanitizeLook(raw: unknown): ValveLook {
  const look = defaultLook();
  if (!raw || typeof raw !== 'object') return look;
  const { background, light } = raw as Partial<ValveLook>;
  if (typeof background === 'string' && HEX.test(background))
    look.background = background.toLowerCase();
  if (light && typeof light === 'object') {
    const d = DEFAULT_LIGHT;
    look.light = {
      direction:
        typeof light.direction === 'number' && Number.isFinite(light.direction)
          ? ((light.direction % 360) + 360) % 360
          : d.direction,
      height: within(light.height, ...LIGHT_LIMITS.height, d.height),
      intensity: within(
        light.intensity,
        ...LIGHT_LIMITS.intensity,
        d.intensity
      ),
      shadow: within(light.shadow, ...LIGHT_LIMITS.shadow, d.shadow),
    };
  }
  return look;
}

const STORAGE_KEY = 'catstudio.valvas.aparencia';

export function loadLook(): ValveLook {
  try {
    return sanitizeLook(
      JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
    );
  } catch {
    return defaultLook();
  }
}

export function saveLook(look: ValveLook) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(look));
  } catch {
    // sem armazenamento (modo privado): a escolha vale só nesta sessão
  }
}

/** De onde a luz vem, em palavras, para o rótulo do controle. */
export function describeDirection(direction: number) {
  const names = [
    'de cima',
    'de cima, à direita',
    'da direita',
    'de baixo, à direita',
    'de baixo',
    'de baixo, à esquerda',
    'da esquerda',
    'de cima, à esquerda',
  ];
  return names[Math.round((((direction % 360) + 360) % 360) / 45) % 8];
}

/** A aparência em uso; qualquer mudança é guardada. */
export const valveLook = reactive(loadLook());
watch(valveLook, () => saveLook(valveLook), { deep: true });

export function resetLook() {
  Object.assign(valveLook, defaultLook());
}
