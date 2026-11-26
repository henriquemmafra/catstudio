/**
 * CatStudio — cores por tecido: paletas guardadas e a paleta em uso em cada
 * vista 3D. Aplicar uma paleta registra um mapa de cores no vtk.js e escreve
 * as curvas na loja de cores do VolView, então tudo o mais (miniaturas,
 * sessão, trava do 3D) continua funcionando como com um preset comum.
 */
import { reactive } from 'vue';
import vtkColorMaps from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction/ColorMaps';
import vtkPiecewiseFunctionProxy from '@kitware/vtk.js/Proxy/Core/PiecewiseFunctionProxy';
import useVolumeColoringStore from '@/src/store/view-configs/volume-coloring';
import { useImageCacheStore } from '@/src/store/image-cache';
import {
  NO_TWEAK,
  PALETTES,
  type Palette,
  TWEAK_LIMITS,
  type Tweak,
  colorPoints,
  opacityNodes,
  sanitizePalette,
  tweaked,
} from '@/src/catstudio/palette';

const STORAGE_KEY = 'catstudio.3d.paletas';
/** Os mapas registrados no vtk.js levam este prefixo e um número. */
export const PRESET_PREFIX = 'CatStudio · ';

function stored(): Palette[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(raw)
      ? raw.map(sanitizePalette).filter((p): p is Palette => p !== null)
      : [];
  } catch {
    return [];
  }
}

export const ownPalettes = reactive<Palette[]>(stored());

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ownPalettes));
  } catch {
    // vale só nesta aba
  }
}

export const allPalettes = () => [...PALETTES, ...ownPalettes];

/** Guarda (ou regrava) uma paleta da pessoa. */
export function savePalette(palette: Palette): Palette {
  const saved: Palette = {
    ...palette,
    id: palette.own ? palette.id : `p${Date.now()}`,
    stops: palette.stops.map((s) => ({ ...s })),
    own: true,
  };
  const at = ownPalettes.findIndex((p) => p.id === saved.id);
  if (at >= 0) ownPalettes.splice(at, 1, saved);
  else ownPalettes.push(saved);
  persist();
  return saved;
}

export function deletePalette(id: string) {
  const at = ownPalettes.findIndex((p) => p.id === id);
  if (at >= 0) ownPalettes.splice(at, 1);
  persist();
}

interface Active {
  palette: Palette;
  tweak: Tweak;
  /** nome do mapa de cores registrado no vtk.js */
  preset: string;
}

const active = reactive<Record<string, Active>>({});
let counter = 0;
const keyOf = (viewID: string, imageID: string) => `${viewID}|${imageID}`;

/** A paleta em uso na vista, se o preset atual ainda for o dela. */
export function activePalette(viewID: string, imageID: string): Active | null {
  const entry = active[keyOf(viewID, imageID)];
  if (!entry) return null;
  const current = useVolumeColoringStore().getConfig(viewID, imageID);
  return current?.transferFunction.preset === entry.preset ? entry : null;
}

/** Nome para mostrar na vista: sem o número interno. */
export function displayPresetName(preset: string): string {
  return preset.startsWith(PRESET_PREFIX)
    ? preset.slice(PRESET_PREFIX.length).replace(/ #\d+$/, '')
    : preset.replace(/-/g, ' ');
}

export interface PaletteTarget {
  viewID: string;
  imageID: string;
}

/** Aplica a paleta (com o ajuste rápido) à vista 3D. */
export function applyPalette(
  target: PaletteTarget,
  palette: Palette,
  tweak: Tweak = NO_TWEAK
): boolean {
  const { viewID, imageID } = target;
  const image = useImageCacheStore().getVtkImageData(imageID);
  if (!image || palette.stops.length < 2) return false;
  const range = image.getPointData().getScalars().getRange() as [
    number,
    number,
  ];
  const stops = tweaked(palette, tweak);
  const key = keyOf(viewID, imageID);
  const previous = active[key]?.preset;
  if (previous) vtkColorMaps.removePresetByName(previous);
  counter += 1;
  const preset = `${PRESET_PREFIX}${palette.title} #${counter}`;
  vtkColorMaps.addPreset({
    Name: preset,
    ColorSpace: 'RGB',
    RGBPoints: colorPoints(stops, range),
  });
  active[key] = { palette, tweak, preset };
  const store = useVolumeColoringStore();
  store.updateColorTransferFunction(viewID, imageID, {
    preset,
    mappingRange: range,
  });
  store.updateOpacityFunction(viewID, imageID, {
    mode: vtkPiecewiseFunctionProxy.Mode.Nodes,
    nodes: opacityNodes(stops, range),
    mappingRange: range,
  });
  return true;
}

const clamp = (value: number, [low, high]: readonly [number, number]) =>
  Math.min(high, Math.max(low, value));

/** Ajuste rápido da paleta em uso (os dois botões do mouse). */
export function tweakPalette(target: PaletteTarget, tweak: Tweak): boolean {
  const entry = activePalette(target.viewID, target.imageID);
  if (!entry) return false;
  return applyPalette(target, entry.palette, {
    shift: clamp(tweak.shift, TWEAK_LIMITS.shift),
    gain: clamp(tweak.gain, TWEAK_LIMITS.gain),
  });
}
