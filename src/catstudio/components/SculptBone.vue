<script setup lang="ts">
/**
 * CatStudio — escultura do 3D: controles do osso (detectar, corrigir no
 * clique, esconder ou deixar translúcido).
 */
import { computed, toRefs } from 'vue';
import type { Maybe } from '@/src/types';
import {
  boneViews,
  clearBone,
  setBoneOpacity,
} from '@/src/catstudio/sculpt/state';

interface Props {
  imageId: Maybe<string>;
  busy: boolean;
  /** a ferramenta de correção por clique está ligada */
  picking: boolean;
}

const props = defineProps<Props>();
const { imageId } = toRefs(props);
defineEmits<{ (e: 'detect'): void; (e: 'pick'): void }>();

const bone = computed(() =>
  imageId.value ? (boneViews[imageId.value] ?? null) : null
);
const percent = computed({
  get: () => Math.round((bone.value?.opacity ?? 1) * 100),
  set: (value: number) => {
    if (imageId.value) setBoneOpacity(imageId.value, value / 100);
  },
});
const label = computed(() => {
  if (percent.value === 0) return 'escondido';
  return percent.value === 100 ? 'normal' : `${percent.value}%`;
});

function toggleHidden() {
  percent.value = percent.value === 0 ? 100 : 0;
}

function forget() {
  if (imageId.value) clearBone(imageId.value);
}
</script>

<template>
  <div class="bone">
    <div class="bone-buttons">
      <v-btn
        size="small"
        variant="tonal"
        prepend-icon="mdi-bone"
        :disabled="busy"
        data-testid="sculpt-bone-detect"
        @click="$emit('detect')"
      >
        Detectar osso
      </v-btn>
      <v-btn
        size="small"
        :variant="picking ? 'flat' : 'tonal'"
        :color="picking ? 'primary' : undefined"
        prepend-icon="mdi-cursor-default-click-outline"
        :disabled="busy"
        data-testid="sculpt-pick-bone"
        @click="$emit('pick')"
      >
        Osso sim/não
      </v-btn>
    </div>
    <template v-if="bone">
      <label class="bone-label">
        Osso: <b data-testid="sculpt-bone-label">{{ label }}</b>
        <input
          v-model.number="percent"
          type="range"
          min="0"
          max="100"
          step="5"
          data-testid="sculpt-bone-opacity"
        />
      </label>
      <div class="bone-buttons">
        <v-btn
          size="small"
          variant="tonal"
          :prepend-icon="percent === 0 ? 'mdi-eye' : 'mdi-eye-off'"
          data-testid="sculpt-bone-toggle"
          @click="toggleHidden"
        >
          {{ percent === 0 ? 'Mostrar osso' : 'Esconder osso' }}
        </v-btn>
        <v-btn
          size="small"
          variant="text"
          data-testid="sculpt-bone-forget"
          @click="forget"
        >
          Esquecer osso
        </v-btn>
      </div>
      <div v-if="percent > 0 && percent < 100" class="bone-note">
        Osso translúcido pesa mais na placa de vídeo.
      </div>
    </template>
  </div>
</template>

<style scoped>
.bone {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid rgba(255, 255, 255, 0.15);
}

.bone-buttons {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  margin: 4px 0;
}

.bone-buttons :deep(.v-btn) {
  text-transform: none;
  letter-spacing: 0;
  justify-content: flex-start;
}

.bone-label {
  display: block;
  margin-top: 4px;
  color: rgba(255, 255, 255, 0.8);
}

.bone-label input {
  display: block;
  width: 100%;
}

.bone-note {
  color: rgba(255, 255, 255, 0.6);
}
</style>
