<script setup lang="ts">
/**
 * Ostium dentro do CatStudio: área de trabalho de laudo coronário que cobre as
 * imagens e lê a série aberta direto da memória (nada é recarregado nem enviado).
 * O código do Ostium só é baixado na primeira vez que a área é aberta.
 */
import { nextTick, ref, watch } from 'vue';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { Tags } from '@/src/core/dicomTags';
import { ostiumOpen } from './state';
import type { OpenSeries, OstiumHost } from './app';

const root = ref<HTMLElement>();
const { currentImageID, currentImageData, currentImage, currentImageMetadata } =
  useCurrentImage('global');

const MAX_VOXELS = 400 * 1024 * 1024;

function ageFrom(meta: Record<string, string>): number | undefined {
  const age = (meta[Tags.PatientAge] ?? '').trim();
  if (/^\d{2,3}Y$/i.test(age)) return parseInt(age, 10);
  const birth = (meta[Tags.PatientBirthDate] ?? '').trim();
  const study = (meta[Tags.StudyDate] ?? '').trim();
  if (birth.length < 8 || study.length < 8) return undefined;
  const date = (s: string) =>
    new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)).getTime();
  const years = (date(study) - date(birth)) / (365.25 * 864e5);
  return years > 0 && years < 120 ? Math.floor(years) : undefined;
}

/** Série exibida, copiada em UH na orientação de leitura axial (superior primeiro). */
function currentSeries(): OpenSeries | { error: string } | null {
  const image = currentImageData.value;
  const id = currentImageID.value;
  if (!image || !id) return null;
  const [nx, ny, nz] = image.getDimensions();
  const spacing = image.getSpacing();
  const dir = image.getDirection();
  const scalars = image.getPointData().getScalars();
  if (!scalars || scalars.getNumberOfComponents() !== 1)
    return { error: 'A série aberta não é uma imagem de TC em tons de cinza.' };
  if (Math.min(Math.abs(dir[0]), Math.abs(dir[4]), Math.abs(dir[8])) < 0.95)
    return {
      error:
        'A série aberta não é axial. Selecione no CatStudio a série axial do escore de cálcio.',
    };
  if (nx * ny * nz > MAX_VOXELS)
    return { error: 'Série grande demais para o escore de cálcio.' };

  const data = scalars.getData();
  const hu = new Int16Array(nx * ny * nz);
  const flipX = dir[0] < 0;
  const flipY = dir[4] < 0;
  const flipZ = dir[8] > 0; // k cresce para cima: inverte para o corte 0 ser o mais alto
  for (let k = 0; k < nz; k++) {
    const kk = flipZ ? nz - 1 - k : k;
    for (let j = 0; j < ny; j++) {
      const src = nx * ((flipY ? ny - 1 - j : j) + ny * kk);
      const dst = nx * (j + ny * k);
      if (flipX)
        for (let i = 0; i < nx; i++) hu[dst + i] = data[src + nx - 1 - i];
      else for (let i = 0; i < nx; i++) hu[dst + i] = data[src + i];
    }
  }

  let meta: Record<string, string> = {};
  const withDicom = currentImage.value as unknown as {
    getDicomMetadata?: () => Array<[string, string]> | null | undefined;
  } | null;
  try {
    meta = Object.fromEntries(withDicom?.getDicomMetadata?.() ?? []);
  } catch {
    meta = {};
  }
  const thickness = parseFloat(meta[Tags.SliceThickness] ?? '');
  const kvp = parseFloat(meta[Tags.KVP] ?? '');
  const sex = (meta[Tags.PatientSex] ?? '').trim().toUpperCase();
  return {
    key: id,
    description: currentImageMetadata.value.name,
    thicknessKnown: Number.isFinite(thickness),
    contrast: !!(meta[Tags.ContrastBolusAgent] ?? '').trim(),
    ageYears: ageFrom(meta),
    sex: sex === 'M' || sex === 'F' ? sex : undefined,
    vol: {
      hu,
      cols: nx,
      rows: ny,
      slices: nz,
      pixelSpacing: [spacing[1], spacing[0]],
      sliceSpacing: spacing[2],
      sliceThickness: Number.isFinite(thickness) ? thickness : spacing[2],
      kvp: Number.isFinite(kvp) ? kvp : undefined,
    },
  };
}

const host: OstiumHost = {
  currentSeries,
  close: () => {
    ostiumOpen.value = false;
  },
  visible: () => ostiumOpen.value,
};

let refresh: (() => void) | null = null;
let loading = false;

watch(ostiumOpen, async (open) => {
  if (!open) return;
  await nextTick();
  if (refresh) {
    refresh();
    return;
  }
  if (loading || !root.value) return;
  loading = true;
  const [{ mountOstium, refreshOstium }, { STYLES }] = await Promise.all([
    import('./app'),
    import('./styles'),
  ]);
  const style = document.createElement('style');
  style.dataset.ostium = '';
  style.textContent = STYLES;
  document.head.append(style);
  mountOstium(root.value, host);
  refresh = refreshOstium;
});
</script>

<template>
  <div
    v-show="ostiumOpen"
    ref="root"
    class="ostium"
    data-testid="ostium-root"
  ></div>
</template>
