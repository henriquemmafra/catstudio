<script setup lang="ts">
/**
 * CatStudio — botões de camadas na vista 3D: mostrar/esconder fora do corpo,
 * pele, gordura, músculos e órgãos, vasos e osso.
 */
import { computed, nextTick, ref, toRefs } from 'vue';
import type { Maybe } from '@/src/types';
import type { VtkViewApi } from '@/src/types/vtk-types';
import { LAYERS, LAYER_TITLE, type Layer } from '@/src/catstudio/sculpt/layers';
import { layerViews, setLayerVisible } from '@/src/catstudio/sculpt/state';
import { baseImageOf } from '@/src/catstudio/sculpt/useSculptedImage';
import { computeLayers } from '@/src/catstudio/sculpt/tools';

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

function toggle(layer: Layer) {
  const id = imageId.value;
  if (!id || !layers.value) return;
  setLayerVisible(id, layer, !layers.value.visible[layer]);
}

defineExpose({ prepare });
</script>

<template>
  <div v-if="open" class="layer-bar" data-testid="layer-bar">
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

.layer-message {
  color: #ffd166;
}
</style>
