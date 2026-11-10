<script setup lang="ts">
import {
  errorReportingConfigured,
  useErrorReporting,
} from '@/src/utils/errorReporting';
import { computed } from 'vue';

const errorStore = useErrorReporting();
const reportingEnabled = computed({
  get: () => !errorStore.disableReporting,
  set: (enabled) => {
    errorStore.disableReporting = !enabled;
  },
});
</script>

<!-- CatStudio: aviso de privacidade em português -->
<template>
  <v-card class="text-grey-lighten-1">
    <v-card-title>Privacidade e segurança dos dados</v-card-title>
    <v-card-text>
      <ul class="bullet-points">
        <li>
          <span class="font-weight-bold">Processamento local</span>: os arquivos
          DICOM são lidos, decodificados e reconstruídos neste navegador.
          Nenhuma imagem ou metadado é enviado para servidor ou serviço de
          nuvem.
        </li>
        <li>
          <span class="font-weight-bold">Identificação do paciente</span>: nome,
          ID e data de nascimento não aparecem na interface nem nas capturas;
          cada paciente vira "Paciente 1", "Paciente 2"… só nesta aba.
        </li>
        <li>
          <span class="font-weight-bold">Sem telemetria</span>: esta versão não
          envia relatórios de erro nem estatísticas de uso.
        </li>
        <li>
          <span class="font-weight-bold">Ao fechar a aba</span>, os dados
          carregados saem da memória. "Salvar sessão" gera um arquivo local que
          inclui os DICOM originais — guarde-o como dado de paciente.
        </li>
      </ul>
      <p class="mt-4 ml-4">
        <v-switch
          v-if="errorReportingConfigured"
          v-model="reportingEnabled"
          :label="`Relatório de erros: ${reportingEnabled ? 'ligado' : 'desligado'}`"
          color="secondary"
          hide-details
        />
      </p>
    </v-card-text>
  </v-card>
</template>

<style scoped>
.bullet-points {
  padding-left: 20px;
  margin-bottom: 16px;
}

.bullet-points > li:not(:last-child) {
  margin-bottom: 8px;
}
</style>
