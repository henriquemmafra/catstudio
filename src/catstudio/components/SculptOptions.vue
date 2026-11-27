<script setup lang="ts">
/**
 * CatStudio — as caixas de marcar das Ferramentas 3D: mostrar a escultura
 * nos cortes 2D, suavizar o granulado e tirar a mesa sempre.
 */
import { sliceOverlay } from '@/src/catstudio/sculpt/overlay';
import { smoothing } from '@/src/catstudio/sculpt/smooth';
import { autoTable, setAutoTable } from '@/src/catstudio/sculpt/autoTable';
</script>

<template>
  <label class="sculpt-check">
    <input
      v-model="sliceOverlay.enabled"
      type="checkbox"
      data-testid="sculpt-show-2d"
    />
    mostrar nos cortes 2D (apagado em azul, destaque na cor)
  </label>
  <label class="sculpt-check">
    <input
      v-model="smoothing.enabled"
      type="checkbox"
      data-testid="sculpt-smooth"
    />
    tirar o granulado (suavizar)
  </label>
  <label class="sculpt-check">
    <input
      type="checkbox"
      :checked="autoTable.enabled"
      data-testid="sculpt-table-auto"
      @change="setAutoTable(($event.target as HTMLInputElement).checked)"
    />
    tirar a mesa sempre, ao abrir
  </label>
</template>

<style scoped>
.sculpt-check {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 2px;
  color: rgba(255, 255, 255, 0.8);
}
</style>
