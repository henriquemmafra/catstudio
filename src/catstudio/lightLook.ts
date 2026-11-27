/**
 * CatStudio — iluminação e fundo da vista 3D.
 *
 * Presets prontos (estúdio, dramático, suave, brilho) e ajustes finos de
 * direção, altura e intensidade da luz, mais a cor do fundo. Funciona em
 * todos os modos de desempenho: é só a luz e o material, sem custo extra.
 * "Padrão" não mexe em nada (vale o que está em Renderização cinematográfica).
 */
import { reactive, watch } from 'vue';
import type vtkRenderer from '@kitware/vtk.js/Rendering/Core/Renderer';
import type vtkVolumeProperty from '@kitware/vtk.js/Rendering/Core/VolumeProperty';

export type LightPreset =
  | 'padrao'
  | 'diretor'
  | 'estudio'
  | 'dramatico'
  | 'suave'
  | 'brilho';

export interface LightLook {
  preset: LightPreset;
  /** graus; 0 = luz vinda da câmera, negativo = da esquerda */
  direction: number;
  /** graus acima da linha de visão */
  height: number;
  intensity: number;
  ambient: number;
  diffuse: number;
  specular: number;
  specularPower: number;
  /** cor do fundo, #rrggbb */
  background: string;
}

type Material = Omit<LightLook, 'preset' | 'background'>;

export const LIGHT_PRESETS: Record<
  Exclude<LightPreset, 'padrao'>,
  Material & { title: string }
> = {
  // a luz do diretor de arte: vem do observador, do alto e da esquerda; sem
  // brilho, e a face do corte iluminada por igual
  diretor: {
    title: 'Diretor',
    direction: -24,
    height: 32,
    intensity: 1,
    ambient: 0.32,
    diffuse: 0.68,
    specular: 0,
    specularPower: 1,
  },
  estudio: {
    title: 'Estúdio',
    direction: -35,
    height: 35,
    intensity: 1,
    ambient: 0.25,
    diffuse: 0.9,
    specular: 0.35,
    specularPower: 20,
  },
  dramatico: {
    title: 'Dramático',
    direction: 60,
    height: 20,
    intensity: 1.15,
    ambient: 0.08,
    diffuse: 1,
    specular: 0.5,
    specularPower: 30,
  },
  suave: {
    title: 'Suave',
    direction: 0,
    height: 25,
    intensity: 0.9,
    ambient: 0.45,
    diffuse: 0.65,
    specular: 0.05,
    specularPower: 8,
  },
  brilho: {
    title: 'Brilho',
    direction: -20,
    height: 40,
    intensity: 1,
    ambient: 0.2,
    diffuse: 0.8,
    specular: 0.9,
    specularPower: 60,
  },
};

export const LIGHT_LIMITS = {
  direction: [-90, 90],
  height: [-60, 80],
  intensity: [0.3, 1.8],
} as const;

export const BACKGROUNDS = ['#000000', '#1c2330', '#6b7280', '#ffffff'];

export const DEFAULT_LOOK: LightLook = {
  preset: 'padrao',
  direction: -35,
  height: 35,
  intensity: 1,
  ambient: 0.25,
  diffuse: 0.9,
  specular: 0.35,
  specularPower: 20,
  background: '#000000',
};

const STORAGE_KEY = 'catstudio.3d.luz';

const clamp = (
  value: unknown,
  [low, high]: readonly [number, number],
  or: number
) =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.min(high, Math.max(low, value))
    : or;

const isPreset = (value: unknown): value is LightPreset =>
  value === 'padrao' || (typeof value === 'string' && value in LIGHT_PRESETS);

export function parseBackground(
  text: unknown
): [number, number, number] | null {
  const match = typeof text === 'string' && /^#([0-9a-f]{6})$/i.exec(text);
  if (!match) return null;
  const value = parseInt(match[1], 16);
  return [(value >> 16) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

/** Aceita o que veio do armazenamento local, mesmo estragado. */
export function sanitizeLook(raw: unknown): LightLook {
  const input = (
    raw && typeof raw === 'object' ? raw : {}
  ) as Partial<LightLook>;
  const base = DEFAULT_LOOK;
  return {
    preset: isPreset(input.preset) ? input.preset : base.preset,
    direction: clamp(input.direction, LIGHT_LIMITS.direction, base.direction),
    height: clamp(input.height, LIGHT_LIMITS.height, base.height),
    intensity: clamp(input.intensity, LIGHT_LIMITS.intensity, base.intensity),
    ambient: clamp(input.ambient, [0, 1], base.ambient),
    diffuse: clamp(input.diffuse, [0, 2], base.diffuse),
    specular: clamp(input.specular, [0, 1], base.specular),
    specularPower: clamp(input.specularPower, [1, 100], base.specularPower),
    background: parseBackground(input.background)
      ? (input.background as string)
      : base.background,
  };
}

function stored(): LightLook {
  try {
    return sanitizeLook(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}'));
  } catch {
    return { ...DEFAULT_LOOK };
  }
}

export const lightLook = reactive<LightLook>(stored());

watch(
  lightLook,
  (look) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(look));
    } catch {
      // vale só nesta aba
    }
  },
  { deep: true }
);

const MATERIAL_KEYS = [
  'direction',
  'height',
  'intensity',
  'ambient',
  'diffuse',
  'specular',
  'specularPower',
] as const;

export function choosePreset(preset: LightPreset) {
  lightLook.preset = preset;
  if (preset === 'padrao') return;
  MATERIAL_KEYS.forEach((key) => {
    lightLook[key] = LIGHT_PRESETS[preset][key];
  });
}

/**
 * Posição da luz no espaço da câmera (a câmera fica em +z olhando para a
 * origem): direção gira em torno do eixo vertical, altura levanta a luz.
 */
export function lightPosition(look: Pick<LightLook, 'direction' | 'height'>) {
  const azimuth = (look.direction * Math.PI) / 180;
  const elevation = (look.height * Math.PI) / 180;
  return [
    Math.sin(azimuth) * Math.cos(elevation),
    Math.sin(elevation),
    Math.cos(azimuth) * Math.cos(elevation),
  ] as [number, number, number];
}

export function applyBackground(renderer: vtkRenderer, look: LightLook) {
  const color = parseBackground(look.background) ?? [0, 0, 0];
  renderer.setBackground(color[0], color[1], color[2]);
}

/** Luz de volta ao comportamento do VolView (luz na câmera). */
export function resetLight(renderer: vtkRenderer) {
  const light = renderer.getLights()[0];
  if (!light) return;
  light.setLightTypeToHeadLight();
  light.setPosition(0, 0, 1);
  light.setFocalPoint(0, 0, 0);
  light.setIntensity(1);
}

/** Aplica luz e material do preset (nada a fazer no "padrão"). */
export function applyLightLook(
  renderer: vtkRenderer,
  property: vtkVolumeProperty,
  look: LightLook
) {
  // no visual do diretor, a normal vem da opacidade: a face do corte (onde a
  // opacidade salta) fica lisa e iluminada por igual, sem o granulado
  property.setComputeNormalFromOpacity(look.preset === 'diretor');
  if (look.preset === 'padrao') return;
  if (renderer.getLights().length === 0) renderer.createLight();
  const light = renderer.getLights()[0];
  const [x, y, z] = lightPosition(look);
  light.setLightTypeToCameraLight();
  light.setPositional(false);
  light.setPosition(x, y, z);
  light.setFocalPoint(0, 0, 0);
  light.setColor(1, 1, 1);
  light.setIntensity(look.intensity);
  property.setShade(true);
  property.setAmbient(look.ambient);
  property.setDiffuse(look.diffuse);
  property.setSpecular(look.specular);
  property.setSpecularPower(look.specularPower);
}
