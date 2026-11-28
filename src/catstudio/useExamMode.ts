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
import {
  MODES,
  detectMode,
  examModes,
  modeSettings,
  setMode,
  type Detection,
} from './examMode';

function hasLungs(imageID: string): boolean {
  const image = useImageCacheStore().getVtkImageData(imageID);
  if (!image) return false;
  const { vol, lungs, found } = chestOf(image);
  return found && lungShare(vol, lungs) >= CHEST_LUNG_SHARE;
}

/** O que a detecção diz deste exame. */
export function detectFor(imageID: string): Detection {
  const dicom = useDICOMStore();
  const study = dicom.studyInfo[dicom.volumeStudy[imageID]];
  return detectMode({
    texts: [
      study?.StudyDescription ?? '',
      dicom.volumeInfo[imageID]?.SeriesDescription ?? '',
    ],
    hasLungs: () => hasLungs(imageID),
  });
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
