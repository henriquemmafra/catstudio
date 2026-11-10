<script setup lang="ts">
withDefaults(defineProps<{ compact?: boolean }>(), { compact: false });
</script>

<template>
  <div class="cs-logo" aria-label="CatStudio">
    <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="cs-ring" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#f2b866" />
          <stop offset="1" stop-color="#d9733b" />
        </linearGradient>
      </defs>
      <!-- anel do gantry -->
      <circle
        cx="16"
        cy="16"
        r="12.5"
        fill="none"
        stroke="url(#cs-ring)"
        stroke-width="4"
      />
      <!-- corte (feixe) -->
      <rect
        x="15"
        y="1.5"
        width="2"
        height="29"
        rx="1"
        fill="#7fd3d0"
        opacity="0.9"
      />
      <circle cx="16" cy="16" r="4.2" fill="#e9e4da" />
    </svg>
    <div v-if="!compact" class="cs-words">
      <span class="cs-name">Cat<b>Studio</b></span>
      <span class="cs-sub">tomografia cinematográfica no navegador</span>
    </div>
  </div>
</template>

<style scoped>
.cs-logo {
  display: flex;
  align-items: center;
  gap: 10px;
  user-select: none;
}
.cs-words {
  display: flex;
  flex-direction: column;
  line-height: 1.05;
}
.cs-name {
  font-size: 21px;
  letter-spacing: 0.02em;
  color: #e9e4da;
  font-weight: 400;
}
.cs-name b {
  font-weight: 700;
  color: #f2b866;
}
.cs-sub {
  font-size: 10.5px;
  letter-spacing: 0.06em;
  color: #9aa3a6;
  text-transform: uppercase;
}
</style>
