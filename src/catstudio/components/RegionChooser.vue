<script setup lang="ts">
/**
 * CatStudio — exame com tórax e abdome juntos: pergunta, uma vez, qual
 * região a pessoa quer ver (ou o exame inteiro, para a aorta total). A mesma
 * escolha fica no menu do modo do exame.
 */
import { computed } from 'vue';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { examModes } from '@/src/catstudio/examMode';
import { REGION_CHOICES } from '@/src/catstudio/examRegions';
import { chooseRegion, dismissRegions } from '@/src/catstudio/useExamMode';

const { currentImageID } = useCurrentImage('global');
const pending = computed(() => {
  const id = currentImageID.value;
  const state = id ? examModes[id] : undefined;
  return id && state?.regions?.combined && !state.asked ? id : null;
});
</script>

<template>
  <v-card
    v-if="pending"
    class="region-chooser"
    elevation="8"
    data-testid="region-chooser"
  >
    <span class="region-question">
      Este exame pega tórax e abdome. O que você quer ver?
    </span>
    <v-btn
      v-for="choice in REGION_CHOICES"
      :key="choice.id"
      size="small"
      variant="tonal"
      color="primary"
      :prepend-icon="choice.icon"
      :title="choice.hint"
      :data-testid="`region-${choice.id}`"
      @click="chooseRegion(pending, choice.id)"
    >
      {{ choice.title }}
    </v-btn>
    <v-btn
      icon="mdi-close"
      size="x-small"
      variant="text"
      title="Deixar como está"
      data-testid="region-dismiss"
      @click="dismissRegions(pending)"
    />
  </v-card>
</template>

<style scoped>
.region-chooser {
  position: fixed;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1600;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  font-size: 13px;
  max-width: calc(100vw - 32px);
}
.region-question {
  font-weight: 600;
}
</style>
