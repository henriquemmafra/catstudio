<script setup lang="ts">
/**
 * CatStudio — botões de camadas na vista 3D: mostrar/esconder fora do corpo,
 * pele, gordura, músculos e órgãos, vasos e osso.
 */
import { computed, nextTick, ref, toRefs } from 'vue';
import type { Maybe } from '@/src/types';
import type { VtkViewApi } from '@/src/types/vtk-types';
import { LAYERS, LAYER_TITLE, type Layer } from '@/src/catstudio/sculpt/layers';
import {
  layerViews,
  setLayerVisible,
  undoSculpt,
} from '@/src/catstudio/sculpt/state';
import { baseImageOf } from '@/src/catstudio/sculpt/useSculptedImage';
import {
  computeLayers,
  fragments,
  presetThreshold,
} from '@/src/catstudio/sculpt/tools';

interface Props {
  view: Maybe<VtkViewApi>;
  imageId: Maybe<string>;
}

const props = defineProps<Props>();
const { view, imageId } = toRefs(props);
const open = defineModel<boolean>('open', { default: false });

const busy = ref(false);
const message = ref('');
const layers = computed(() =>
  imageId.value ? (layerViews[imageId.value] ?? null) : null
);

const ICONS: Record<Layer, string> = {
  fora: 'mdi-bed-outline',
  pele: 'mdi-human-handsdown',
  gordura: 'mdi-water-outline',
  moles: 'mdi-arm-flex-outline',
  vasos: 'mdi-heart-pulse',
  osso: 'mdi-bone',
};

async function prepare() {
  const id = imageId.value;
  const base = id ? baseImageOf(id) : null;
  if (!id || !base || !view.value) {
    message.value = 'O 3D ainda está carregando.';
    return;
  }
  busy.value = true;
  message.value = 'Separando os tecidos…';
  await nextTick();
  await new Promise((resolve) => {
    setTimeout(resolve, 30);
  });
  try {
    const size = view.value.renderWindowView.getSize();
    message.value = computeLayers({
      view: view.value,
      imageID: id,
      base,
      aspect: size[0] / Math.max(size[1], 1),
    });
  } finally {
    busy.value = false;
  }
}

/** Abrir já separa os tecidos (um clique a menos). */
function openBar() {
  open.value = true;
  if (!layers.value && !busy.value) prepare();
}

const DUST_SIZES = [0.5, 1, 3, 10];
const dustMl = ref(1);

/** Tira a "poeira": pedacinhos soltos, contando as camadas escondidas. */
async function cleanDust() {
  const id = imageId.value;
  const base = id ? baseImageOf(id) : null;
  if (!id || !base || !view.value) return;
  busy.value = true;
  message.value = 'Limpando…';
  await nextTick();
  await new Promise((resolve) => {
    setTimeout(resolve, 30);
  });
  try {
    const size = view.value.renderWindowView.getSize();
    const where = {
      view: view.value,
      imageID: id,
      base,
      aspect: size[0] / Math.max(size[1], 1),
    };
    const { threshold } = presetThreshold(view.value, base);
    message.value = fragments(where, threshold, dustMl.value);
  } finally {
    busy.value = false;
  }
}

function undoDust() {
  if (imageId.value && undoSculpt(imageId.value)) message.value = 'Desfeito.';
}

function toggle(layer: Layer) {
  const id = imageId.value;
  if (!id || !layers.value) return;
  setLayerVisible(id, layer, !layers.value.visible[layer]);
}

defineExpose({ prepare, openBar });
</script>

<template>
  <button
    v-if="!open"
    class="layer-pill"
    data-testid="layer-pill"
    title="Mostrar ou esconder pele, gordura, músculos, vasos, osso e o que está fora do corpo"
    @click="openBar"
  >
    <v-icon size="16">mdi-layers-outline</v-icon>
    Camadas: pele · músculos · vasos · osso
  </button>
  <div v-else class="layer-bar" data-testid="layer-bar">
    <template v-if="layers">
      <v-btn
        v-for="layer in LAYERS"
        :key="layer"
        size="x-small"
        :variant="layers.visible[layer] ? 'tonal' : 'outlined'"
        :disabled="!layers.available[layer]"
        :prepend-icon="layers.visible[layer] ? ICONS[layer] : 'mdi-eye-off'"
        :class="{ off: !layers.visible[layer] }"
        :data-testid="`layer-${layer}`"
        :title="
          layers.available[layer]
            ? 'Mostrar/esconder'
            : 'Não há esta camada neste exame'
        "
        @click="toggle(layer)"
      >
        {{ LAYER_TITLE[layer] }}
      </v-btn>
    </template>
    <v-btn
      v-else
      size="small"
      color="primary"
      variant="flat"
      :loading="busy"
      data-testid="layer-prepare"
      @click="prepare"
    >
      Separar tecidos
    </v-btn>
    <span v-if="layers" class="layer-dust">
      <v-btn
        size="x-small"
        variant="flat"
        color="#ffd166"
        prepend-icon="mdi-broom"
        :loading="busy"
        data-testid="layer-dust"
        title="Tira os pedacinhos soltos (poeira) do que está visível"
        @click="cleanDust"
      >
        Limpar poeira
      </v-btn>
      <select
        v-model.number="dustMl"
        class="layer-dust-size"
        aria-label="Tamanho máximo da poeira"
        data-testid="layer-dust-size"
      >
        <option v-for="ml in DUST_SIZES" :key="ml" :value="ml">
          até {{ String(ml).replace('.', ',') }} cm³
        </option>
      </select>
      <v-btn
        icon="mdi-undo"
        size="x-small"
        variant="text"
        aria-label="Desfazer a última limpeza"
        data-testid="layer-dust-undo"
        @click="undoDust"
      />
    </span>
    <span v-if="message" class="layer-message" data-testid="layer-message">{{
      message
    }}</span>
    <v-btn
      icon="mdi-close"
      size="x-small"
      variant="text"
      aria-label="Fechar camadas"
      @click="open = false"
    />
  </div>
</template>

<style scoped>
.layer-bar {
  position: absolute;
  left: 50%;
  bottom: 28px;
  transform: translateX(-50%);
  z-index: 3;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  gap: 4px;
  max-width: calc(100% - 120px);
  padding: 4px 6px;
  border-radius: 10px;
  background: rgba(20, 24, 28, 0.88);
  color: #fff;
  font-size: 12px;
}

.layer-bar :deep(.v-btn) {
  text-transform: none;
  letter-spacing: 0;
}

.layer-bar .off {
  opacity: 0.6;
  text-decoration: line-through;
}

.layer-pill {
  position: absolute;
  left: 50%;
  bottom: 28px;
  transform: translateX(-50%);
  z-index: 3;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  border-radius: 14px;
  border: 1px solid rgba(255, 209, 102, 0.6);
  background: rgba(20, 24, 28, 0.85);
  color: #ffd166;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}

.layer-pill:hover {
  background: rgba(40, 46, 54, 0.95);
}

.layer-dust {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: 6px;
  padding-left: 8px;
  border-left: 1px solid rgba(255, 255, 255, 0.2);
}

.layer-dust :deep(.v-btn) {
  color: #14181c !important;
}

.layer-dust-size {
  padding: 1px 4px;
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 4px;
  color: #fff;
  background: #14181c;
  font-size: 11px;
}

.layer-message {
  color: #ffd166;
}
</style>
