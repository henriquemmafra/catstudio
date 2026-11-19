<script setup lang="ts">
/**
 * CatStudio — escolha do desempenho da renderização 3D.
 */
import { computed } from 'vue';
import {
  PERFORMANCE_MODES,
  performanceSettings,
  setPerformanceMode,
  type PerformanceMode,
} from '@/src/catstudio/performance';

const hint = computed(
  () =>
    PERFORMANCE_MODES.find((m) => m.value === performanceSettings.mode)?.hint
);
const select = (mode: PerformanceMode) => setPerformanceMode(mode);
</script>

<template>
  <div class="mb-4" data-testid="performance-select">
    <div class="text-caption text-medium-emphasis mb-1">Desempenho do 3D</div>
    <v-btn-toggle
      :model-value="performanceSettings.mode"
      mandatory
      divided
      density="compact"
      variant="outlined"
      class="w-100"
      @update:model-value="select"
    >
      <v-btn
        v-for="mode in PERFORMANCE_MODES"
        :key="mode.value"
        :value="mode.value"
        :data-testid="`performance-${mode.value}`"
        class="flex-grow-1 text-none"
        size="small"
      >
        {{ mode.title }}
      </v-btn>
    </v-btn-toggle>
    <div class="text-caption text-medium-emphasis mt-1">{{ hint }}</div>
  </div>
</template>
