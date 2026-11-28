<script setup lang="ts">
/**
 * CatStudio — janela "Volume de cavidade": mede o VE e o VD pelo sangue
 * contrastado, a partir do cruzamento dos cortes, com as réguas de limite.
 */
import { computed, ref } from 'vue';
import { useLocalStorage } from '@vueuse/core';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { useRulerStore } from '@/src/store/tools/rulers';
import { bodySurface } from '@/src/catstudio/cavity/grow';
import {
  CAVITIES,
  cavityMode,
  cavityResults,
  type CavityName,
} from '@/src/catstudio/cavity/state';
import {
  MAX_ML,
  clearCavity,
  measureCavity,
} from '@/src/catstudio/cavity/measure';

const NAMES = Object.keys(CAVITIES) as CavityName[];
const { currentImageID } = useCurrentImage('global');

const body = useLocalStorage('catstudio.cavidade.corpo', {
  height: 0,
  weight: 0,
});
const useRulers = ref(true);
const message = ref('');
const busy = ref(false);

const results = computed(() =>
  currentImageID.value ? (cavityResults[currentImageID.value] ?? {}) : {}
);
const rulers = computed(
  () =>
    useRulerStore().finishedTools.filter(
      (ruler) => ruler.imageID === currentImageID.value
    ).length
);
const surface = computed(() =>
  bodySurface(body.value.height, body.value.weight)
);

const ml = (value: number) =>
  value >= 100 ? String(Math.round(value)) : value.toFixed(1).replace('.', ',');

function line(name: CavityName): string {
  const measured = results.value[name];
  if (!measured) return '';
  const indexed = surface.value
    ? ` (${ml(measured.ml / surface.value)} mL/m²)`
    : '';
  return `${name}: ${ml(measured.ml)} mL${indexed}`;
}

function run(name: CavityName, options: { low?: number; reseed: boolean }) {
  const imageID = currentImageID.value;
  if (!imageID || busy.value) return;
  busy.value = true;
  message.value = '';
  // deixa a tela mostrar "medindo" antes da conta
  setTimeout(() => {
    try {
      const measured = measureCavity(imageID, name, {
        ...options,
        useRulers: useRulers.value,
      });
      if (measured.leaked)
        message.value = `${name} passou de ${MAX_ML} mL: vazou. Desenhe uma régua no plano valvar (e na via de saída) ou suba o limiar.`;
    } catch (error) {
      message.value = `Não deu: ${(error as Error).message}`;
    } finally {
      busy.value = false;
    }
  }, 30);
}

const remeasure = (name: CavityName, event: Event) =>
  run(name, {
    low: Number((event.target as HTMLInputElement).value),
    reseed: false,
  });

function remove(name: CavityName) {
  if (currentImageID.value) clearCavity(currentImageID.value, name);
}

async function copy() {
  const text = NAMES.map(line).filter(Boolean).join('; ');
  try {
    await navigator.clipboard.writeText(text);
    message.value = 'Copiado.';
  } catch {
    message.value = text;
  }
}
</script>

<template>
  <v-card
    v-if="cavityMode.open"
    class="cavity"
    elevation="8"
    data-testid="cavity-panel"
  >
    <div class="cavity-head">
      <span>Volume de cavidade</span>
      <v-btn
        icon="mdi-close"
        size="x-small"
        variant="text"
        data-testid="cavity-close"
        @click="cavityMode.open = false"
      />
    </div>
    <ol class="cavity-steps">
      <li>
        Ponha o cruzamento dos três cortes dentro da cavidade (ferramenta de
        mira, ou passando os cortes).
      </li>
      <li>
        Com a régua, risque o plano valvar e a via de saída num corte: cada
        régua vira uma parede que o crescimento não atravessa.
      </li>
      <li>Clique em medir. A cavidade aparece pintada nos cortes.</li>
    </ol>
    <div class="cavity-row">
      <v-btn
        v-for="name in NAMES"
        :key="name"
        size="small"
        variant="tonal"
        :loading="busy"
        :style="{ color: CAVITIES[name].color }"
        :title="`${CAVITIES[name].title}: mede a partir do cruzamento dos cortes`"
        :data-testid="`cavity-measure-${name}`"
        @click="run(name, { reseed: true })"
      >
        Medir {{ name }}
      </v-btn>
    </div>
    <label class="cavity-check">
      <input v-model="useRulers" type="checkbox" data-testid="cavity-rulers" />
      usar as réguas como limite ({{ rulers }} neste exame)
    </label>

    <template v-for="name in NAMES" :key="`r-${name}`">
      <div v-if="results[name]" class="cavity-result">
        <div class="cavity-value" :data-testid="`cavity-value-${name}`">
          <span class="chip" :style="{ background: CAVITIES[name].color }" />
          {{ line(name) }}
          <v-btn
            icon="mdi-delete-outline"
            size="x-small"
            variant="text"
            title="Apagar esta medida"
            :data-testid="`cavity-clear-${name}`"
            @click="remove(name)"
          />
        </div>
        <label class="cavity-slider">
          limiar {{ results[name]!.low }} UH (sangue
          {{ Math.round(results[name]!.blood) }} UH,
          {{ results[name]!.walls }} régua(s))
          <input
            type="range"
            min="80"
            :max="Math.max(200, Math.round(results[name]!.blood))"
            step="5"
            :value="results[name]!.low"
            :data-testid="`cavity-low-${name}`"
            @change="remeasure(name, $event)"
          />
        </label>
      </div>
    </template>

    <div class="cavity-body">
      <label>
        altura (cm)
        <input
          v-model.number="body.height"
          type="number"
          min="0"
          data-testid="cavity-height"
        />
      </label>
      <label>
        peso (kg)
        <input
          v-model.number="body.weight"
          type="number"
          min="0"
          data-testid="cavity-weight"
        />
      </label>
      <span v-if="surface"
        >SC {{ surface.toFixed(2).replace('.', ',') }} m²</span
      >
    </div>
    <div class="cavity-row">
      <v-btn
        size="small"
        variant="text"
        prepend-icon="mdi-content-copy"
        :disabled="!NAMES.some((name) => results[name])"
        data-testid="cavity-copy"
        @click="copy"
      >
        Copiar
      </v-btn>
    </div>
    <div v-if="message" class="cavity-message" data-testid="cavity-message">
      {{ message }}
    </div>
    <div class="cavity-note">
      Conta só o sangue acima do limiar (papilares e trabéculas ficam de fora).
      É o volume da fase aberta; para fração de ejeção, meça a diástole e a
      sístole. Confira a pintura antes de usar o número.
    </div>
  </v-card>
</template>

<style scoped>
.cavity {
  position: fixed;
  right: 16px;
  top: 64px;
  width: 320px;
  max-height: calc(100vh - 90px);
  overflow-y: auto;
  z-index: 1500;
  padding: 10px 12px;
  font-size: 13px;
}
.cavity-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 600;
  font-size: 14px;
}
.cavity-steps {
  margin: 6px 0 8px 18px;
  opacity: 0.85;
  font-size: 12px;
}
.cavity-row {
  display: flex;
  gap: 6px;
  margin-top: 6px;
}
.cavity-check {
  display: flex;
  gap: 6px;
  align-items: center;
  margin-top: 6px;
  font-size: 12px;
}
.cavity-result {
  margin-top: 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.12);
  padding-top: 6px;
}
.cavity-value {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 15px;
  font-weight: 600;
}
.chip {
  width: 12px;
  height: 12px;
  border-radius: 3px;
}
.cavity-slider {
  display: flex;
  flex-direction: column;
  font-size: 12px;
  opacity: 0.85;
}
.cavity-body {
  display: flex;
  gap: 10px;
  align-items: end;
  margin-top: 10px;
  font-size: 12px;
}
.cavity-body label {
  display: flex;
  flex-direction: column;
}
.cavity-body input {
  width: 70px;
  background: rgba(255, 255, 255, 0.08);
  color: inherit;
  border-radius: 4px;
  padding: 2px 6px;
}
.cavity-message {
  margin-top: 6px;
  color: #ffd166;
}
.cavity-note {
  margin-top: 8px;
  font-size: 11px;
  opacity: 0.65;
}
</style>
