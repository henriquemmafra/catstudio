<script setup lang="ts">
/**
 * CatStudio — modo Valvas: cor do fundo e luz principal (de onde vem, altura,
 * intensidade e força da sombra). A escolha fica em valveLook.ts.
 */
import {
  BACKGROUND_PRESETS,
  describeDirection,
  isLight,
  resetLook,
  valveLook as look,
} from '@/src/catstudio/valveLook';

defineProps<{
  /** Reconstrução 3D (a luz e a sombra não valem para o holograma). */
  solid: boolean;
}>();

function pickColor(event: Event) {
  look.background = (event.target as HTMLInputElement).value;
}
</script>

<template>
  <div data-testid="valve-look">
    <div class="d-flex align-center ga-3 mt-1">
      <span class="text-caption valve-label">Fundo</span>
      <div class="d-flex align-center flex-wrap ga-1">
        <v-btn
          v-for="preset in BACKGROUND_PRESETS"
          :key="preset.label"
          size="x-small"
          :variant="look.background === preset.value ? 'flat' : 'outlined'"
          :color="look.background === preset.value ? 'primary' : undefined"
          class="text-none"
          :data-testid="`valve-bg-${preset.label}`"
          @click="look.background = preset.value"
          >{{ preset.label }}</v-btn
        >
        <label class="valve-color" title="Escolher outra cor">
          <input
            type="color"
            :value="look.background || '#07162a'"
            aria-label="Cor do fundo"
            data-testid="valve-bg-color"
            @input="pickColor"
          />
        </label>
      </div>
    </div>
    <template v-if="solid">
      <div class="d-flex align-center ga-3">
        <span class="text-caption valve-label"
          >Luz vem {{ describeDirection(look.light.direction) }}</span
        >
        <v-slider
          v-model="look.light.direction"
          :min="0"
          :max="355"
          :step="5"
          density="compact"
          hide-details
          aria-label="Direção da luz"
          data-testid="valve-light-direction"
        />
      </div>
      <div class="d-flex align-center ga-3">
        <span class="text-caption valve-label"
          >Altura da luz {{ look.light.height }}°</span
        >
        <v-slider
          v-model="look.light.height"
          :min="15"
          :max="85"
          :step="1"
          density="compact"
          hide-details
          aria-label="Altura da luz"
          data-testid="valve-light-height"
        />
      </div>
      <div class="d-flex align-center ga-3">
        <span class="text-caption valve-label"
          >Luz {{ Math.round(look.light.intensity * 100) }}%</span
        >
        <v-slider
          v-model="look.light.intensity"
          :min="0.3"
          :max="2"
          :step="0.05"
          density="compact"
          hide-details
          aria-label="Intensidade da luz"
          data-testid="valve-light-intensity"
        />
      </div>
      <div class="d-flex align-center ga-3">
        <span class="text-caption valve-label"
          >Sombra {{ Math.round(look.light.shadow * 100) }}%</span
        >
        <v-slider
          v-model="look.light.shadow"
          :min="0"
          :max="1"
          :step="0.05"
          density="compact"
          hide-details
          aria-label="Intensidade da sombra"
          data-testid="valve-light-shadow"
        />
      </div>
    </template>
    <div class="d-flex align-center ga-3">
      <span class="text-caption valve-label valve-hint">
        <template v-if="!solid && isLight(look.background)"
          >O holograma some em fundo claro: use a Reconstrução 3D</template
        >
        <template v-else-if="!solid">Luz e sombra: na Reconstrução 3D</template>
      </span>
      <v-spacer />
      <v-btn
        size="x-small"
        variant="text"
        class="text-none"
        data-testid="valve-look-reset"
        @click="resetLook"
        >Fundo e luz padrão</v-btn
      >
    </div>
  </div>
</template>

<style scoped>
.valve-label {
  width: 150px;
  flex: none;
}
.valve-hint {
  width: auto;
  opacity: 0.7;
}
.valve-color {
  display: inline-flex;
  width: 26px;
  height: 22px;
  border: 1px solid rgba(255, 255, 255, 0.35);
  border-radius: 4px;
  overflow: hidden;
  cursor: pointer;
}
.valve-color input {
  width: 40px;
  height: 34px;
  margin: -6px;
  padding: 0;
  border: 0;
  cursor: pointer;
}
</style>
