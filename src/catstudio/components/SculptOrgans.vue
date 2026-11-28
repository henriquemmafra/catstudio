<script setup lang="ts">
/**
 * CatStudio — atalhos de órgão das Ferramentas 3D: deixar só os pulmões ou
 * só o coração (cada um aparece nos modos de exame em que faz sentido).
 */
defineProps<{ busy: boolean; lungs: boolean; heart: boolean }>();
defineEmits<{ lungs: []; heart: [] }>();
</script>

<template>
  <div class="organs">
    <v-btn
      v-if="lungs"
      size="small"
      variant="tonal"
      prepend-icon="mdi-lungs"
      :disabled="busy"
      title="Esconde tudo menos os pulmões e usa as cores de pulmão"
      data-testid="sculpt-lungs"
      @click="$emit('lungs')"
    >
      Só pulmões
    </v-btn>
    <v-btn
      v-if="heart"
      size="small"
      variant="tonal"
      prepend-icon="mdi-heart-outline"
      :disabled="busy"
      title="Esconde tudo menos o coração (aproximado; acerte com a borracha)"
      data-testid="sculpt-heart"
      @click="$emit('heart')"
    >
      Só coração
    </v-btn>
  </div>
</template>

<style scoped>
.organs {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 6px;
}
</style>
