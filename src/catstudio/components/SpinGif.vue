<script setup lang="ts">
/**
 * CatStudio — exportar o 3D como GIF girando (giro ou vaivém, 90/180/360°,
 * eixo vertical ou horizontal).
 */
import { computed, ref, toRefs } from 'vue';
import { useLocalStorage } from '@vueuse/core';
import type { Maybe } from '@/src/types';
import type { VtkViewApi } from '@/src/types/vtk-types';
import {
  ARCS,
  FRAMES,
  playOrder,
  type Arc,
  type Axis,
  type Motion,
} from '@/src/catstudio/gif/spin';
import { recordSpin, saveSpin } from '@/src/catstudio/gif/record';

interface Props {
  modelValue: boolean;
  view: Maybe<VtkViewApi>;
  /** espera a vista terminar de desenhar um quadro */
  settle: () => Promise<void>;
}

const props = defineProps<Props>();
const emit = defineEmits<{ 'update:modelValue': [open: boolean] }>();
const { view } = toRefs(props);

const choice = useLocalStorage('catstudio.3d.gif', {
  motion: 'giro' as Motion,
  arc: 360 as Arc,
  axis: 'vertical' as Axis,
  side: 480,
  delay: 80,
});

const MOTIONS: { value: Motion; title: string }[] = [
  { value: 'giro', title: 'Giro (um sentido)' },
  { value: 'vaivem', title: 'Vaivém (vai e volta)' },
];
const AXES: { value: Axis; title: string }[] = [
  { value: 'vertical', title: 'Vertical (gira de lado)' },
  { value: 'horizontal', title: 'Horizontal (tomba)' },
];
const SIDES = [
  { value: 360, title: 'Pequeno (360 px)' },
  { value: 480, title: 'Médio (480 px)' },
  { value: 720, title: 'Grande (720 px)' },
];
const SPEEDS = [
  { value: 120, title: 'Devagar' },
  { value: 80, title: 'Normal' },
  { value: 50, title: 'Rápido' },
];

const seconds = computed(() => {
  const { arc, motion, delay } = choice.value;
  return ((playOrder(FRAMES[arc], motion).length * delay) / 1000).toFixed(1);
});

const running = ref(false);
const progress = ref(0);
const message = ref('');
let stop = false;

function close() {
  stop = true;
  emit('update:modelValue', false);
}

async function make() {
  const target = view.value;
  if (!target || running.value) return;
  running.value = true;
  stop = false;
  progress.value = 0;
  message.value = '';
  try {
    const bytes = await recordSpin(target, {
      ...choice.value,
      settle: props.settle,
      cancelled: () => stop,
      onProgress: (done, total) => {
        progress.value = Math.round((100 * done) / total);
      },
    });
    if (!bytes) message.value = 'Cancelado.';
    else {
      await saveSpin(bytes, choice.value);
      const mb = (bytes.length / 1e6).toFixed(1).replace('.', ',');
      message.value = `GIF pronto (${mb} MB).`;
    }
  } catch (error) {
    message.value = `Não deu: ${(error as Error).message}`;
  } finally {
    running.value = false;
  }
}
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    max-width="420"
    @update:model-value="close"
  >
    <v-card data-testid="gif-dialog">
      <v-card-title class="text-subtitle-1">GIF do 3D girando</v-card-title>
      <v-card-text class="gif-body">
        <div class="gif-label">Movimento</div>
        <v-btn-toggle
          v-model="choice.motion"
          mandatory
          density="compact"
          color="primary"
          divided
        >
          <v-btn
            v-for="m in MOTIONS"
            :key="m.value"
            :value="m.value"
            size="small"
            :data-testid="`gif-motion-${m.value}`"
          >
            {{ m.title }}
          </v-btn>
        </v-btn-toggle>
        <div class="gif-label">Quanto gira</div>
        <v-btn-toggle
          v-model="choice.arc"
          mandatory
          density="compact"
          color="primary"
          divided
        >
          <v-btn
            v-for="arc in ARCS"
            :key="arc"
            :value="arc"
            size="small"
            :data-testid="`gif-arc-${arc}`"
          >
            {{ arc }}°
          </v-btn>
        </v-btn-toggle>
        <div class="gif-label">Eixo</div>
        <v-btn-toggle
          v-model="choice.axis"
          mandatory
          density="compact"
          color="primary"
          divided
        >
          <v-btn
            v-for="a in AXES"
            :key="a.value"
            :value="a.value"
            size="small"
            :data-testid="`gif-axis-${a.value}`"
          >
            {{ a.title }}
          </v-btn>
        </v-btn-toggle>
        <div class="gif-row">
          <label>
            Tamanho
            <select v-model.number="choice.side" data-testid="gif-side">
              <option v-for="s in SIDES" :key="s.value" :value="s.value">
                {{ s.title }}
              </option>
            </select>
          </label>
          <label>
            Velocidade
            <select v-model.number="choice.delay" data-testid="gif-speed">
              <option v-for="s in SPEEDS" :key="s.value" :value="s.value">
                {{ s.title }}
              </option>
            </select>
          </label>
        </div>
        <div class="gif-note">
          {{ FRAMES[choice.arc] }} quadros, {{ seconds }} s por ciclo. Nos arcos
          de 90° e 180° a vista atual fica no meio do movimento. Sem textos nem
          dados do paciente.
        </div>
        <v-progress-linear
          v-if="running"
          :model-value="progress"
          color="primary"
          height="6"
          rounded
        />
        <div v-if="message" class="gif-message" data-testid="gif-message">
          {{ message }}
        </div>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" data-testid="gif-close" @click="close">
          {{ running ? 'Cancelar' : 'Fechar' }}
        </v-btn>
        <v-btn
          color="primary"
          variant="flat"
          :loading="running"
          data-testid="gif-make"
          @click="make"
        >
          Gerar GIF
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.gif-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.gif-label {
  font-size: 12px;
  opacity: 0.75;
  margin-top: 6px;
}
.gif-row {
  display: flex;
  gap: 16px;
  margin-top: 8px;
  font-size: 13px;
}
.gif-row label {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.gif-row select {
  background: rgba(255, 255, 255, 0.08);
  color: inherit;
  border-radius: 4px;
  padding: 3px 6px;
}
.gif-note {
  font-size: 12px;
  opacity: 0.7;
  margin-top: 6px;
}
.gif-message {
  font-size: 13px;
  color: #ffd166;
}
</style>
