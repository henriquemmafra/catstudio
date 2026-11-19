<script setup lang="ts">
/**
 * CatStudio — lista de séries mostrada antes de carregar um exame grande.
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { triage, type SeriesSummary } from '@/src/catstudio/triage';

triage.available = true;
onBeforeUnmount(() => {
  triage.available = false;
  triage.pending?.resolve([]);
});

const list = computed<SeriesSummary[]>(() => triage.pending?.list ?? []);
const open = computed(() => !!triage.pending);
const selected = ref<string[]>([]);

watch(
  list,
  (items) => {
    const suggested = items.filter((s) => s.recommended).map((s) => s.id);
    // sem sugestão (ex.: só cortes espessos): marca o maior volume
    const fallback = items
      .filter((s) => s.kind === 'volume')
      .sort((a, b) => b.images - a.images)
      .slice(0, 1)
      .map((s) => s.id);
    selected.value = suggested.length ? suggested : fallback;
  },
  { immediate: true }
);

const megabytes = (ids: string[]) =>
  list.value
    .filter((s) => ids.includes(s.id))
    .reduce((n, s) => n + s.megabytes, 0);

const size = (mb: number) =>
  mb >= 1000
    ? `${(mb / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} GB`
    : `${Math.round(mb)} MB`;

const detail = (s: SeriesSummary) =>
  [
    s.modality,
    s.plane,
    `${s.images} imagens`,
    s.rows && s.cols ? `${s.cols}×${s.rows}` : '',
    s.spacing
      ? `${s.spacing.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} mm`
      : '',
    ...s.notes,
  ]
    .filter(Boolean)
    .join(' · ');

const title = (s: SeriesSummary) =>
  [s.number && `Série ${s.number}`, s.description]
    .filter(Boolean)
    .join(' · ') || 'Série sem descrição';

const toggle = (id: string) => {
  selected.value = selected.value.includes(id)
    ? selected.value.filter((x) => x !== id)
    : [...selected.value, id];
};

const finish = (ids: string[]) => triage.pending?.resolve(ids);
</script>

<template>
  <v-dialog :model-value="open" persistent max-width="760" scrollable>
    <v-card data-testid="series-triage">
      <v-card-title class="pt-4">Quais séries carregar?</v-card-title>
      <v-card-subtitle class="triage-subtitle">
        Este exame tem {{ list.length }} séries ({{
          size(megabytes(list.map((s) => s.id)))
        }}). Só as marcadas entram na lista; a sugerida abre primeiro.
      </v-card-subtitle>
      <v-card-text class="pa-0">
        <v-list density="compact" select-strategy="classic">
          <v-list-item
            v-for="s in list"
            :key="s.id"
            :class="{ 'triage-aux': s.kind === 'aux' }"
            data-testid="series-triage-item"
            @click="toggle(s.id)"
          >
            <template #prepend>
              <v-checkbox-btn
                :model-value="selected.includes(s.id)"
                density="compact"
                tabindex="-1"
              />
            </template>
            <v-list-item-title>
              {{ title(s) }}
              <v-chip
                v-if="s.recommended"
                size="x-small"
                color="primary"
                variant="flat"
                class="ml-2"
                >Sugerida</v-chip
              >
            </v-list-item-title>
            <v-list-item-subtitle>{{ detail(s) }}</v-list-item-subtitle>
            <template #append>
              <span class="triage-size">{{ size(s.megabytes) }}</span>
            </template>
          </v-list-item>
        </v-list>
      </v-card-text>
      <v-card-actions class="px-4 pb-4">
        <v-btn
          variant="text"
          class="text-none"
          data-testid="series-triage-cancel"
          @click="finish([])"
          >Cancelar</v-btn
        >
        <v-spacer />
        <v-btn
          variant="text"
          class="text-none"
          data-testid="series-triage-all"
          @click="finish(list.map((s) => s.id))"
          >Carregar todas</v-btn
        >
        <v-btn
          color="primary"
          variant="flat"
          class="text-none"
          :disabled="!selected.length"
          data-testid="series-triage-confirm"
          @click="finish(selected)"
        >
          Carregar {{ selected.length }}
          {{ selected.length === 1 ? 'série' : 'séries' }} ({{
            size(megabytes(selected))
          }})
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.triage-subtitle {
  white-space: normal;
  opacity: 0.8;
}
.triage-aux {
  opacity: 0.6;
}
.triage-size {
  font-variant-numeric: tabular-nums;
  opacity: 0.8;
}
</style>
