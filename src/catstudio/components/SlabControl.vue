<script setup lang="ts">
/** CatStudio — indicador e ajuste da fatia espessa (MIP/MinIP) da vista. */
import { computed } from 'vue';
import {
  SLAB_LABEL,
  SLAB_MAX_THICKNESS,
  SLAB_MIN_THICKNESS,
  setSlab,
  slabFor,
  stepSlabThickness,
} from '@/src/catstudio/slab';

const props = defineProps<{ viewId: string }>();
const slab = computed(() => slabFor(props.viewId));
const label = computed(() =>
  slab.value.mode === 'off' ? '' : SLAB_LABEL[slab.value.mode]
);
const thickness = computed(() =>
  String(Number(slab.value.thickness.toFixed(1))).replace('.', ',')
);
</script>

<template>
  <div class="slab-control" data-testid="slab-control" @pointerdown.stop>
    <span class="slab-mode" data-testid="slab-mode">{{ label }}</span>
    <button
      type="button"
      class="slab-btn"
      aria-label="Diminuir espessura"
      :disabled="slab.thickness <= SLAB_MIN_THICKNESS"
      @click="stepSlabThickness(viewId, -1)"
    >
      −
    </button>
    <span class="slab-thickness" data-testid="slab-thickness"
      >{{ thickness }} mm</span
    >
    <button
      type="button"
      class="slab-btn"
      aria-label="Aumentar espessura"
      :disabled="slab.thickness >= SLAB_MAX_THICKNESS"
      @click="stepSlabThickness(viewId, 1)"
    >
      +
    </button>
    <button
      type="button"
      class="slab-btn"
      aria-label="Voltar ao corte fino"
      title="Voltar ao corte fino"
      @click="setSlab(viewId, 'off')"
    >
      ×
    </button>
  </div>
</template>

<style scoped>
.slab-control {
  position: absolute;
  top: 26px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  border-radius: 14px;
  background: rgba(20, 24, 28, 0.82);
  border: 1px solid rgba(255, 255, 255, 0.18);
  color: #fff;
  font-size: 12px;
  line-height: 20px;
  user-select: none;
}

.slab-mode {
  font-weight: 700;
  color: #ffd166;
  margin-right: 2px;
}

.slab-thickness {
  min-width: 52px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.slab-btn {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 0;
  background: rgba(255, 255, 255, 0.12);
  color: inherit;
  cursor: pointer;
  font-size: 14px;
  line-height: 18px;
  padding: 0;
}

.slab-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.28);
}

.slab-btn:disabled {
  opacity: 0.35;
  cursor: default;
}
</style>
