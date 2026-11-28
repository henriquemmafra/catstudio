/**
 * CatStudio — liga o modo do exame (examMode.ts) ao programa: detecta ao
 * abrir, e as vistas aplicam a janela e as cores do modo escolhido.
 */
import { type Ref, watch } from 'vue';
import type { Maybe } from '@/src/types';
import { WLPresetsCT } from '@/src/constants';
import { useDICOMStore } from '@/src/store/datasets-dicom';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useWindowingStore } from '@/src/store/view-configs/windowing';
import useVolumeColoringStore from '@/src/store/view-configs/volume-coloring';
import { allPalettes, applyPalette } from '@/src/catstudio/paletteStore';
import { choosePreset } from '@/src/catstudio/lightLook';
import {
  CHEST_LUNG_SHARE,
  chestOf,
  lungShare,
} from '@/src/catstudio/sculpt/chestImage';
import { useCropStore } from '@/src/store/tools/crop';
import { useViewStore } from '@/src/store/views';
import useViewSliceStore from '@/src/store/view-configs/slicing';
import { volume2DViewsOfImage } from '@/src/core/views/effectiveView';
import { vec3 } from 'gl-matrix';
import {
  lungHeights,
  regionsFromLungs,
  type RegionChoice,
  type Regions,
} from './examRegions';
import {
  MODES,
  detectMode,
  examModes,
  modeSettings,
  setMode,
  type Detection,
} from './examMode';

/** As regiões do exame pelos pulmões; undefined se não é tórax. */
function regionsOf(imageID: string): Regions | undefined {
  const image = useImageCacheStore().getVtkImageData(imageID);
  if (!image) return undefined;
  const { vol, lungs, found } = chestOf(image);
  if (!found || lungShare(vol, lungs) < CHEST_LUNG_SHARE) return undefined;
  const heights = lungHeights(lungs);
  const bounds = image.getBounds();
  return heights
    ? regionsFromLungs(heights, [bounds[4], bounds[5]])
    : undefined;
}

/** O que a detecção diz deste exame. */
export function detectFor(imageID: string): Detection {
  const dicom = useDICOMStore();
  const study = dicom.studyInfo[dicom.volumeStudy[imageID]];
  const regions = regionsOf(imageID);
  const detection = detectMode({
    texts: [
      study?.StudyDescription ?? '',
      dicom.volumeInfo[imageID]?.SeriesDescription ?? '',
    ],
    hasLungs: () => !!regions,
  });
  return { ...detection, regions };
}

/** Fatia (índice no eixo axial do exame) de uma altura em mm. */
function sliceAt(imageID: string, z: number): number | null {
  const cache = useImageCacheStore();
  const image = cache.getVtkImageData(imageID);
  const metadata = cache.getImageMetadata(imageID);
  if (!image || !metadata) return null;
  const [x0, x1, y0, y1] = image.getBounds();
  const index = vec3.transformMat4(
    vec3.create(),
    [(x0 + x1) / 2, (y0 + y1) / 2, z],
    metadata.worldToIndex
  );
  return index[metadata.lpsOrientation.Axial];
}

/**
 * Resposta à pergunta "tórax, abdome ou aorta total?": põe o modo, recorta o
 * 3D na região e leva o corte axial para o meio dela.
 */
export function chooseRegion(imageID: string, choice: RegionChoice) {
  const regions = examModes[imageID]?.regions;
  const mode = choice === 'aorta' ? 'angio' : choice;
  setMode(imageID, { mode, why: 'escolhido por você', regions }, false);
  const crop = useCropStore();
  if (choice === 'aorta' || !regions) {
    crop.resetCropping(imageID);
    return;
  }
  const [low, high] = regions[choice].map((z) => sliceAt(imageID, z));
  if (low == null || high == null) return;
  const range: [number, number] = [Math.min(low, high), Math.max(low, high)];
  crop.setCroppingForAxis(imageID, 'Axial', range);
  const slices = useViewSliceStore();
  volume2DViewsOfImage(imageID, useViewStore().getAllViews())
    .filter(({ axis }) => axis === 'Axial')
    .forEach(({ viewId }) =>
      slices.updateConfig(viewId, imageID, {
        slice: Math.round((range[0] + range[1]) / 2),
      })
    );
}

/** Fecha a pergunta sem escolher. */
export function dismissRegions(imageID: string) {
  const state = examModes[imageID];
  if (state) state.asked = true;
}

/** Ao abrir um exame, escolhe o modo dele (se a detecção estiver ligada). */
export function useModeDetection(imageID: Ref<Maybe<string>>) {
  watch(
    imageID,
    (id) => {
      if (!id || examModes[id] || !modeSettings.detect) return;
      // o exame acabou de abrir: deixa a tela aparecer antes da conta
      setTimeout(() => {
        if (examModes[id] || !useImageCacheStore().getVtkImageData(id)) return;
        setMode(id, detectFor(id), true);
      }, 300);
    },
    { immediate: true }
  );
}

/** Num corte 2D: aplica a janela do modo quando ele é escolhido. */
export function useModeWindow(
  viewID: Ref<string>,
  imageID: Ref<Maybe<string>>
) {
  watch(
    () => imageID.value && examModes[imageID.value]?.stamp,
    () => {
      const id = imageID.value;
      const name = id && MODES[examModes[id]?.mode ?? 'livre'].window;
      const preset = name && WLPresetsCT[name as keyof typeof WLPresetsCT];
      if (!id || !preset) return;
      useWindowingStore().updateConfig(viewID.value, id, { ...preset }, true);
    },
    { immediate: true }
  );
}

/** Na vista 3D: aplica as cores do modo, uma vez por escolha. */
export function useModeLook(viewID: Ref<string>, imageID: Ref<Maybe<string>>) {
  let applied = 0;
  const coloring = useVolumeColoringStore();
  watch(
    () => {
      const id = imageID.value;
      const ready = !!id && !!coloring.getConfig(viewID.value, id);
      return [id && examModes[id]?.stamp, ready] as const;
    },
    ([stamp, ready]) => {
      const id = imageID.value;
      if (!id || !stamp || !ready || stamp === applied) return;
      applied = stamp;
      const wanted = MODES[examModes[id].mode].palette;
      const palette = allPalettes().find((p) => p.id === wanted);
      if (!palette) return;
      applyPalette({ viewID: viewID.value, imageID: id }, palette);
      choosePreset('diretor');
    },
    { immediate: true }
  );
}
