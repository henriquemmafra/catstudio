<script setup lang="ts">
import { ref } from 'vue';
import CloseableDialog from '@/src/components/CloseableDialog.vue';
import DataSecurityBox from '@/src/components/DataSecurityBox.vue';
import CatStudioLogo from '@/src/catstudio/components/CatStudioLogo.vue';
import {
  loadUserPromptedFiles,
  loadUserPromptedFolder,
} from '@/src/actions/loadUserFiles';

withDefaults(
  defineProps<{
    loading?: boolean;
  }>(),
  {
    loading: false,
  }
);

const dataSecurityDialog = ref(false);
</script>

<!-- CatStudio: tela inicial em português, com abertura de pasta de exame -->
<template>
  <v-container class="page-container bg-grey-darken-4" v-bind="$attrs">
    <div class="welcome">
      <template v-if="!loading">
        <CatStudioLogo class="mb-8 welcome-logo" />
        <h1 class="welcome-title">Abra um exame de tomografia</h1>
        <p class="welcome-lead">
          Selecione a pasta do exame (com subpastas, DICOMDIR ou .zip) ou os
          arquivos DICOM. O processamento e as reconstruções acontecem neste
          navegador.
        </p>
        <div class="welcome-actions">
          <v-btn
            size="x-large"
            color="secondary"
            prepend-icon="mdi-folder-open"
            data-testid="welcome-open-folder"
            @click.stop="loadUserPromptedFolder"
          >
            Abrir pasta do exame
          </v-btn>
          <v-btn
            size="x-large"
            variant="tonal"
            prepend-icon="mdi-file-multiple"
            data-testid="welcome-open-files"
            @click.stop="loadUserPromptedFiles"
          >
            Abrir arquivos
          </v-btn>
        </div>
        <div class="welcome-drop">
          <v-icon size="28">mdi-tray-arrow-down</v-icon>
          <span
            >ou arraste e solte arquivos, pastas ou .zip em qualquer lugar</span
          >
        </div>

        <div class="welcome-privacy">
          <v-icon size="22" color="secondary">mdi-shield-lock-outline</v-icon>
          <div>
            <strong>Os exames não saem deste computador.</strong>
            Nada é enviado para a internet, e a identificação do paciente não
            aparece na tela nem nas capturas.
            <a href="#" @click.prevent.stop="dataSecurityDialog = true">
              Saiba mais
            </a>
          </div>
        </div>
        <p class="welcome-note">
          Ferramenta de pesquisa e ensino. Não é um dispositivo médico e não
          deve ser usada para diagnóstico.
        </p>
      </template>
      <template v-else>
        <div class="text-h6 my-4">Carregando o exame…</div>
        <v-progress-linear indeterminate color="secondary" />
      </template>
    </div>
  </v-container>
  <closeable-dialog v-model="dataSecurityDialog">
    <data-security-box />
  </closeable-dialog>
</template>

<style scoped>
.page-container {
  flex: 1 1 auto;
  display: flex;
  flex-flow: row;
  align-items: center;
  justify-content: center;
  max-width: 100%;
  background:
    radial-gradient(
      1200px 600px at 50% 0%,
      rgba(242, 184, 102, 0.07),
      transparent 60%
    ),
    radial-gradient(
      900px 500px at 80% 100%,
      rgba(127, 211, 208, 0.05),
      transparent 60%
    );
}
.welcome {
  max-width: 640px;
  width: 100%;
  padding: 24px;
}
.welcome-logo :deep(svg) {
  width: 44px;
  height: 44px;
}
.welcome-logo :deep(.cs-name) {
  font-size: 30px;
}
.welcome-title {
  font-size: 26px;
  font-weight: 500;
  color: #e9e4da;
  margin-bottom: 8px;
}
.welcome-lead {
  color: #b9bfc2;
  font-size: 15px;
  line-height: 1.5;
  margin-bottom: 24px;
}
.welcome-actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}
.welcome-drop {
  margin-top: 18px;
  display: flex;
  align-items: center;
  gap: 8px;
  color: #8d969a;
  font-size: 14px;
}
.welcome-privacy {
  margin-top: 40px;
  display: flex;
  gap: 12px;
  align-items: flex-start;
  padding: 14px 16px;
  border: 1px solid rgba(127, 211, 208, 0.25);
  border-radius: 6px;
  color: #c6ccce;
  font-size: 14px;
  line-height: 1.5;
}
.welcome-privacy a {
  color: #7fd3d0;
}
.welcome-note {
  margin-top: 14px;
  color: #80898d;
  font-size: 12.5px;
}
</style>
