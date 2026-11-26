<script setup lang="ts">
/**
 * CatStudio — iluminação e fundo da vista 3D.
 */
import {
  BACKGROUNDS,
  LIGHT_LIMITS,
  LIGHT_PRESETS,
  type LightPreset,
  choosePreset,
  lightLook,
} from '@/src/catstudio/lightLook';

const PRESETS: Array<{ value: LightPreset; title: string }> = [
  { value: 'padrao', title: 'Padrão' },
  ...Object.entries(LIGHT_PRESETS).map(([value, preset]) => ({
    value: value as LightPreset,
    title: preset.title,
  })),
];

const SLIDERS = [
  { key: 'direction', title: 'Direção da luz', unit: '°', step: 5 },
  { key: 'height', title: 'Altura da luz', unit: '°', step: 5 },
  { key: 'intensity', title: 'Intensidade', unit: '', step: 0.05 },
] as const;
</script>

<template>
  <div class="mx-2" data-testid="light-look">
    <div class="look-presets">
      <v-btn
        v-for="preset in PRESETS"
        :key="preset.value"
        size="small"
        :variant="lightLook.preset === preset.value ? 'flat' : 'tonal'"
        :color="lightLook.preset === preset.value ? 'primary' : undefined"
        :data-testid="`light-preset-${preset.value}`"
        @click="choosePreset(preset.value)"
      >
        {{ preset.title }}
      </v-btn>
    </div>
    <template v-if="lightLook.preset !== 'padrao'">
      <label v-for="slider in SLIDERS" :key="slider.key" class="look-label">
        {{ slider.title }}:
        <b>{{ lightLook[slider.key] }}{{ slider.unit }}</b>
        <input
          v-model.number="lightLook[slider.key]"
          type="range"
          :min="LIGHT_LIMITS[slider.key][0]"
          :max="LIGHT_LIMITS[slider.key][1]"
          :step="slider.step"
          :data-testid="`light-${slider.key}`"
        />
      </label>
    </template>
    <div v-else class="look-note text-caption">
      Padrão usa a luz da câmera e os ajustes de "Renderização cinematográfica".
      Os outros funcionam em qualquer modo de desempenho.
    </div>
    <div class="look-label">Fundo</div>
    <div class="look-backgrounds">
      <button
        v-for="color in BACKGROUNDS"
        :key="color"
        class="look-chip"
        :class="{ chosen: lightLook.background === color }"
        :style="{ background: color }"
        :data-testid="`light-background-${color.slice(1)}`"
        :aria-label="`Fundo ${color}`"
        @click="lightLook.background = color"
      />
      <input
        v-model="lightLook.background"
        type="color"
        class="look-picker"
        aria-label="Outra cor de fundo"
      />
    </div>
  </div>
</template>

<style scoped>
.look-presets {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}

.look-presets :deep(.v-btn) {
  text-transform: none;
  letter-spacing: 0;
}

.look-label {
  display: block;
  margin-top: 8px;
  font-size: 13px;
}

.look-label input {
  display: block;
  width: 100%;
}

.look-note {
  opacity: 0.7;
}

.look-backgrounds {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
}

.look-chip {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 2px solid rgba(128, 128, 128, 0.6);
  cursor: pointer;
}

.look-chip.chosen {
  border-color: rgb(var(--v-theme-primary));
  box-shadow: 0 0 0 2px rgba(var(--v-theme-primary), 0.4);
}

.look-picker {
  width: 36px;
  height: 28px;
  padding: 0;
  border: none;
  background: none;
}
</style>
