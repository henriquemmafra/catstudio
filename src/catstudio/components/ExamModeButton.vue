<script setup lang="ts">
/**
 * CatStudio — botão do modo do exame na barra lateral: mostra o modo em uso
 * (e por que foi escolhido), deixa trocar e guarda as ferramentas que não
 * são do modo.
 */
import { computed } from 'vue';
import ControlButton from '@/src/components/ControlButton.vue';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import {
  MODES,
  MODE_ORDER,
  examModes,
  modeSettings,
  setDetect,
  setMode,
  type ExamMode,
} from '@/src/catstudio/examMode';
import { detectFor, useModeDetection } from '@/src/catstudio/useExamMode';

defineProps<{
  /** ferramentas fora do modo atual, para o fim do menu */
  extras: { id: string; title: string; icon: string }[];
}>();
defineEmits<{ extra: [id: string] }>();

const { currentImageID } = useCurrentImage('global');
useModeDetection(currentImageID);

const state = computed(() =>
  currentImageID.value ? examModes[currentImageID.value] : undefined
);
const mode = computed<ExamMode>(() => state.value?.mode ?? 'livre');

function choose(next: ExamMode) {
  const id = currentImageID.value;
  if (id) setMode(id, { mode: next, why: 'escolhido por você' }, false);
}

function detectNow() {
  const id = currentImageID.value;
  if (id) setMode(id, detectFor(id), true);
}
</script>

<template>
  <v-menu location="right" :close-on-content-click="false">
    <template #activator="{ props }">
      <div>
        <control-button
          v-bind="props"
          size="40"
          :icon="MODES[mode].icon"
          :name="`Modo do exame: ${MODES[mode].title}`"
          data-testid="exam-mode"
        />
      </div>
    </template>
    <v-card width="300" data-testid="exam-mode-menu">
      <v-card-text class="mode-body">
        <div class="mode-title">Modo do exame</div>
        <div class="mode-why" data-testid="exam-mode-why">
          <template v-if="state">
            {{ MODES[mode].title }}
            {{ state.auto ? '(automático)' : '' }}: {{ state.why }}.
          </template>
          <template v-else>Livre: nada foi detectado ainda.</template>
        </div>
        <v-list density="compact" class="pa-0">
          <v-list-item
            v-for="id in MODE_ORDER"
            :key="id"
            :prepend-icon="MODES[id].icon"
            :title="MODES[id].title"
            :active="id === mode"
            :data-testid="`exam-mode-${id}`"
            @click="choose(id)"
          />
          <v-list-item
            prepend-icon="mdi-auto-fix"
            title="Detectar de novo"
            data-testid="exam-mode-detect"
            @click="detectNow"
          />
        </v-list>
        <label class="mode-check">
          <input
            type="checkbox"
            :checked="modeSettings.detect"
            data-testid="exam-mode-auto"
            @change="setDetect(($event.target as HTMLInputElement).checked)"
          />
          detectar sozinho ao abrir um exame
        </label>
        <template v-if="extras.length">
          <div class="mode-title mt-2">Mais ferramentas</div>
          <v-list density="compact" class="pa-0">
            <v-list-item
              v-for="extra in extras"
              :key="extra.id"
              :prepend-icon="extra.icon"
              :title="extra.title"
              :data-testid="`exam-mode-extra-${extra.id}`"
              @click="$emit('extra', extra.id)"
            />
          </v-list>
        </template>
        <div class="mode-note">
          O modo escolhe a janela dos cortes, as cores do 3D e o que fica à mão.
          Nada some: o resto fica aqui em "Mais ferramentas".
        </div>
      </v-card-text>
    </v-card>
  </v-menu>
</template>

<style scoped>
.mode-body {
  font-size: 13px;
}
.mode-title {
  font-weight: 600;
  margin-bottom: 2px;
}
.mode-why {
  font-size: 12px;
  opacity: 0.8;
  margin-bottom: 6px;
}
.mode-check {
  display: flex;
  gap: 6px;
  align-items: center;
  font-size: 12px;
  margin-top: 6px;
}
.mode-note {
  font-size: 11px;
  opacity: 0.65;
  margin-top: 8px;
}
</style>
