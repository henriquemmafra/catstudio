<script setup lang="ts">
/**
 * CatStudio — atalhos de órgão das Ferramentas 3D: deixar só os pulmões ou
 * só o coração.
 */
defineProps<{ busy: boolean }>();
defineEmits<{ lungs: []; heart: [] }>();
</script>

<template>
  <div class="organs">
    <v-btn
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
