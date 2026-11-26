<script setup lang="ts">
/**
 * CatStudio — andamento da foto final na vista 3D.
 */
import { computed, toRefs } from 'vue';
import { cancelPhoto, photoStatus } from '@/src/catstudio/photo/run';

interface Props {
  viewId: string;
}

const props = defineProps<Props>();
const { viewId } = toRefs(props);
const status = computed(() => photoStatus[viewId.value] ?? null);
const percent = computed(() => Math.round((status.value?.progress ?? 0) * 100));
</script>

<template>
  <div
    v-if="status && (status.running || status.message)"
    class="photo-badge"
    data-testid="photo-badge"
  >
    <template v-if="status.running">
      <v-progress-circular
        :model-value="percent"
        size="16"
        width="2"
        color="#ffd166"
      />
      Foto final: {{ status.stage.toLowerCase() }} {{ percent }}%
      <v-btn
        size="x-small"
        variant="text"
        data-testid="photo-cancel"
        @click="cancelPhoto(viewId)"
      >
        Cancelar
      </v-btn>
    </template>
    <template v-else>
      {{ status.message }}
      <v-btn
        icon="mdi-close"
        size="x-small"
        variant="text"
        aria-label="Fechar aviso"
        @click="status.message = ''"
      />
    </template>
  </div>
</template>

<style scoped>
.photo-badge {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 4px 2px 10px;
  border-radius: 12px;
  background: rgba(20, 24, 28, 0.85);
  color: #ffd166;
  font-size: 12px;
  pointer-events: all;
}
</style>
