/**
 * CatStudio — liga o modo do exame (examMode.ts) ao programa: detecta ao
 * abrir, e as vistas aplicam a janela e as cores do modo escolhido.
 */
import { type Ref, onScopeDispose, watch } from 'vue';
import vtkPlane from '@kitware/vtk.js/Common/DataModel/Plane';
import type vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import type vtkImageMapper from '@kitware/vtk.js/Rendering/Core/ImageMapper';
import type { Vector3 } from '@kitware/vtk.js/types';
import type { LPSAxis } from '@/src/types/lps';
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
import useViewSliceStore from '@/src/store/view-configs/slicing';
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
  type ExamMode,
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
  examModes[imageID].sliceRange = [Math.ceil(range[0]), Math.floor(range[1])];
}

/**
 * Troca de modo pelo menu: vale para o exame inteiro, então desfaz o recorte
 * de região (no 3D e no 2D) se havia um.
 */
export function chooseMode(imageID: string, mode: ExamMode) {
  if (examModes[imageID]?.sliceRange) useCropStore().resetCropping(imageID);
  setMode(imageID, { mode, why: 'escolhido por você' }, false);
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

/** Os dois planos (mm) que limitam a faixa de fatias axiais. */
function bandOf(image: vtkImageData, k: number, range: [number, number]) {
  // meia fatia de folga, para as fatias das pontas aparecerem inteiras
  const at = (slice: number) => {
    const index = [0, 0, 0];
    index[k] = slice;
    return [...image.indexToWorld(index as Vector3)] as Vector3;
  };
  const from = at(range[0] - 0.5);
  const to = at(range[1] + 0.5);
  const along = vec3.normalize(
    vec3.create(),
    vec3.sub(vec3.create(), to, from)
  ) as Vector3;
  return { from, to, along, back: along.map((v) => -v) as Vector3 };
}

interface CropView {
  viewID: Ref<string>;
  imageID: Ref<Maybe<string>>;
  axis: Ref<LPSAxis>;
}

/**
 * Num corte 2D: recorta a vista na região escolhida. O axial só passa pelas
 * fatias da região; o coronal e o sagital mostram só a faixa dela.
 */
export function useRegionCrop2D(
  where: CropView,
  mapper: vtkImageMapper,
  render: () => void
) {
  const low = vtkPlane.newInstance();
  const high = vtkPlane.newInstance();
  onScopeDispose(() => {
    low.delete();
    high.delete();
  });

  function limitAxial(id: string, range: [number, number], chosen: boolean) {
    useViewSliceStore().updateConfig(where.viewID.value, id, {
      min: range[0],
      max: range[1],
      ...(chosen ? { slice: Math.round((range[0] + range[1]) / 2) } : {}),
    });
  }

  function clip(band: ReturnType<typeof bandOf>) {
    low.setOrigin(band.from);
    low.setNormal(band.along);
    high.setOrigin(band.to);
    high.setNormal(band.back);
    mapper.addClippingPlane(low);
    mapper.addClippingPlane(high);
  }

  watch(
    () => {
      const id = where.imageID.value;
      const state = id ? examModes[id] : undefined;
      return [id, state?.stamp, state?.sliceRange, where.axis.value] as const;
    },
    ([id, stamp, range, axis]) => {
      mapper.removeAllClippingPlanes();
      const cache = useImageCacheStore();
      const image = id ? cache.getVtkImageData(id) : null;
      const metadata = id ? cache.getImageMetadata(id) : null;
      // sem modo escolhido, não mexe em nada
      if (!id || !stamp || !image || !metadata) return;
      const k = metadata.lpsOrientation.Axial;
      const whole: [number, number] = [0, image.getDimensions()[k] - 1];
      if (axis === 'Axial') limitAxial(id, range ?? whole, !!range);
      else if (range) clip(bandOf(image, k, range));
      render();
    },
    { immediate: true }
  );
}
