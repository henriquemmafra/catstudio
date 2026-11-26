<script setup lang="ts">
/**
 * CatStudio — cores por tecido: escolher uma paleta pronta e editar ponto a
 * ponto (nome, densidade em HU, cor, opacidade). Cada mudança vai direto para
 * a vista 3D.
 */
import { computed, ref, toRefs, watch } from 'vue';
import type { Maybe } from '@/src/types';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import {
  type Palette,
  type Stop,
  gradientCss,
  sortedStops,
} from '@/src/catstudio/palette';
import {
  activePalette,
  allPalettes,
  applyPalette,
  deletePalette,
  savePalette,
} from '@/src/catstudio/paletteStore';

interface Props {
  viewId: Maybe<string>;
}

const props = defineProps<Props>();
const { viewId } = toRefs(props);
const { currentImageID } = useCurrentImage();

const palettes = computed(allPalettes);
/** cópia de trabalho; null = a vista está com um preset comum do VolView */
const draft = ref<Palette | null>(null);
const title = ref('');

const target = computed(() =>
  viewId.value && currentImageID.value
    ? { viewID: viewId.value, imageID: currentImageID.value }
    : null
);

const copyOf = (palette: Palette): Palette => ({
  ...palette,
  stops: palette.stops.map((s) => ({ ...s })),
});

// trocar de exame ou de preset: a edição acompanha o que a vista mostra
watch(
  () =>
    target.value
      ? activePalette(target.value.viewID, target.value.imageID)?.preset
      : null,
  (preset) => {
    if (!preset) draft.value = null;
  }
);

function push() {
  if (!target.value || !draft.value) return;
  applyPalette(target.value, {
    ...draft.value,
    stops: sortedStops(draft.value.stops),
  });
}

function choose(palette: Palette) {
  draft.value = copyOf(palette);
  title.value = palette.own ? palette.title : `${palette.title} (minha)`;
  push();
}

function addStop() {
  if (!draft.value) return;
  const stops = sortedStops(draft.value.stops);
  const last = stops[stops.length - 1];
  const before = stops[stops.length - 2] ?? last;
  draft.value.stops.push({
    name: 'Novo ponto',
    hu: Math.round((last.hu + before.hu) / 2) || last.hu + 100,
    color: last.color,
    opacity: (last.opacity + before.opacity) / 2,
  });
  push();
}

function removeStop(item: Stop) {
  if (!draft.value || draft.value.stops.length <= 2) return;
  draft.value.stops = draft.value.stops.filter((s) => s !== item);
  push();
}

function save() {
  if (!draft.value) return;
  const saved = savePalette({
    ...draft.value,
    title: title.value.trim() || 'Minha paleta',
    stops: sortedStops(draft.value.stops),
  });
  draft.value = copyOf(saved);
  push();
}

function remove() {
  if (!draft.value?.own) return;
  deletePalette(draft.value.id);
  draft.value = null;
}

const preview = computed(() =>
  draft.value ? gradientCss(draft.value.stops) : 'none'
);
const percent = (item: Stop) => Math.round(item.opacity * 100);
const setPercent = (item: Stop, event: Event) => {
  item.opacity = Number((event.target as HTMLInputElement).value) / 100;
  push();
};
</script>

<template>
  <div class="mx-2" data-testid="palette-editor">
    <div class="palette-list">
      <v-btn
        v-for="palette in palettes"
        :key="palette.id"
        size="small"
        :variant="draft?.id === palette.id ? 'flat' : 'tonal'"
        :color="draft?.id === palette.id ? 'primary' : undefined"
        :data-testid="`palette-${palette.id}`"
        @click="choose(palette)"
      >
        <span
          class="palette-swatch"
          :style="{ background: gradientCss(palette.stops) }"
        />
        {{ palette.title }}
      </v-btn>
    </div>

    <div v-if="!draft" class="palette-note text-caption">
      Escolha uma paleta para colorir o 3D por tecido e editar os pontos. Os
      presets de cor do VolView continuam valendo se você não escolher nenhuma.
    </div>

    <template v-else>
      <div class="palette-bar" data-testid="palette-bar">
        <div class="palette-bar-fill" :style="{ background: preview }" />
      </div>
      <div
        v-for="(item, index) in draft.stops"
        :key="index"
        class="palette-stop"
        :data-testid="`palette-stop-${index}`"
      >
        <input
          v-model="item.color"
          type="color"
          class="palette-color"
          :aria-label="`Cor de ${item.name}`"
          @input="push"
        />
        <input
          v-model="item.name"
          type="text"
          class="palette-name"
          aria-label="Nome do tecido"
        />
        <input
          v-model.number="item.hu"
          type="number"
          step="10"
          class="palette-hu"
          :aria-label="`Densidade de ${item.name} em HU`"
          @change="push"
        />
        <span class="palette-unit">HU</span>
        <input
          type="range"
          min="0"
          max="100"
          class="palette-opacity"
          :value="percent(item)"
          :aria-label="`Opacidade de ${item.name}`"
          @input="setPercent(item, $event)"
        />
        <span class="palette-percent">{{ percent(item) }}%</span>
        <v-btn
          icon="mdi-close"
          size="x-small"
          variant="text"
          :disabled="draft.stops.length <= 2"
          :aria-label="`Tirar o ponto ${item.name}`"
          @click="removeStop(item)"
        />
      </div>
      <div class="palette-actions">
        <v-btn
          size="small"
          variant="tonal"
          prepend-icon="mdi-plus"
          data-testid="palette-add-stop"
          @click="addStop"
        >
          Ponto
        </v-btn>
        <input
          v-model="title"
          type="text"
          class="palette-title"
          aria-label="Nome da paleta"
          data-testid="palette-title"
        />
        <v-btn
          size="small"
          variant="tonal"
          prepend-icon="mdi-content-save"
          data-testid="palette-save"
          @click="save"
        >
          Salvar
        </v-btn>
        <v-btn
          v-if="draft.own"
          size="small"
          variant="text"
          data-testid="palette-delete"
          @click="remove"
        >
          Apagar
        </v-btn>
      </div>
      <div class="palette-note text-caption">
        Cada ponto diz: a partir desta densidade, esta cor e esta opacidade;
        entre dois pontos a mudança é gradual. No 3D, os dois botões do mouse
        juntos deslocam a paleta inteira (para cima/baixo) e mudam a opacidade
        (para os lados).
      </div>
    </template>
  </div>
</template>

<style scoped>
.palette-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}

.palette-list :deep(.v-btn) {
  text-transform: none;
  letter-spacing: 0;
}

.palette-swatch {
  display: inline-block;
  width: 28px;
  height: 12px;
  margin-right: 6px;
  border-radius: 3px;
  background-color: #000;
}

.palette-bar {
  height: 18px;
  margin: 6px 0 10px;
  border-radius: 4px;
  background: #000;
  overflow: hidden;
}

.palette-bar-fill {
  width: 100%;
  height: 100%;
}

.palette-stop {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
  font-size: 12px;
}

.palette-color {
  flex: 0 0 30px;
  width: 30px;
  height: 24px;
  padding: 0;
  border: none;
  background: none;
}

.palette-name,
.palette-hu,
.palette-title {
  padding: 2px 6px;
  border: 1px solid rgba(128, 128, 128, 0.5);
  border-radius: 4px;
  color: inherit;
  background: transparent;
  font-size: 12px;
}

.palette-name {
  flex: 1 1 90px;
  min-width: 60px;
}

.palette-hu {
  flex: 0 0 64px;
  width: 64px;
  text-align: right;
}

.palette-unit,
.palette-percent {
  flex: 0 0 auto;
  opacity: 0.7;
}

.palette-percent {
  width: 34px;
  text-align: right;
}

.palette-opacity {
  flex: 1 1 70px;
  min-width: 50px;
}

.palette-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin: 8px 0;
}

.palette-actions :deep(.v-btn) {
  text-transform: none;
  letter-spacing: 0;
}

.palette-title {
  flex: 1 1 120px;
  min-width: 90px;
}

.palette-note {
  opacity: 0.7;
}
</style>
