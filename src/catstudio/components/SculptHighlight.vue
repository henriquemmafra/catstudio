<script setup lang="ts">
/**
 * CatStudio — escultura do 3D: cor do destaque, quanto do resto aparece e
 * limpar. Aparece depois do primeiro "Crescer: destacar".
 */
import { computed, toRefs } from 'vue';
import type { Maybe } from '@/src/types';
import {
  clearHighlight,
  highlightViews,
  setHighlightLook,
} from '@/src/catstudio/sculpt/state';

interface Props {
  imageId: Maybe<string>;
}

const props = defineProps<Props>();
const { imageId } = toRefs(props);

const view = computed(() =>
  imageId.value ? (highlightViews[imageId.value] ?? null) : null
);
const rest = computed({
  get: () => Math.round((view.value?.rest ?? 0.25) * 100),
  set: (value: number) => {
    if (imageId.value) setHighlightLook(imageId.value, { rest: value / 100 });
  },
});
const color = computed({
  get: () => view.value?.color ?? '#ff3b30',
  set: (value: string) => {
    if (imageId.value) setHighlightLook(imageId.value, { color: value });
  },
});

function clear() {
  if (imageId.value) clearHighlight(imageId.value);
}
</script>

<template>
  <div v-if="view?.voxels" class="highlight" data-testid="sculpt-highlight">
    <div class="highlight-row">
      <span>Destaque</span>
      <input
        v-model="color"
        type="color"
        class="highlight-color"
        aria-label="Cor do destaque"
        data-testid="sculpt-highlight-color"
      />
      <v-btn
        size="small"
        variant="text"
        data-testid="sculpt-highlight-clear"
        @click="clear"
      >
        Limpar destaque
      </v-btn>
    </div>
    <label class="highlight-label">
      O resto: <b>{{ rest }}%</b>
      <input
        v-model.number="rest"
        type="range"
        min="0"
        max="100"
        step="5"
        data-testid="sculpt-highlight-rest"
      />
    </label>
  </div>
</template>

<style scoped>
.highlight {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid rgba(255, 255, 255, 0.15);
}

.highlight-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.highlight-row :deep(.v-btn) {
  text-transform: none;
  letter-spacing: 0;
}

.highlight-color {
  width: 34px;
  height: 22px;
  padding: 0;
  border: none;
  background: none;
}

.highlight-label {
  display: block;
  margin-top: 4px;
  color: rgba(255, 255, 255, 0.8);
}

.highlight-label input {
  display: block;
  width: 100%;
}
</style>
