<!-- CatStudio: "Sobre" em português, com o crédito ao VolView/Kitware -->
<template>
  <v-card>
    <v-card-title class="d-flex flex-row justify-center py-4">
      <CatStudioLogo />
    </v-card-title>
    <v-alert color="secondary" variant="tonal" class="notice">
      Uso em pesquisa e ensino. Não é dispositivo médico; não use para
      diagnóstico.
    </v-alert>
    <v-card-text>
      <v-btn
        class="my-2"
        @click="openKeyboardShortcuts"
        prepend-icon="mdi-keyboard"
        color="secondary"
      >
        Atalhos de teclado e controles das vistas
      </v-btn>
      <h2 class="mt-2">Sobre o CatStudio</h2>
      <v-divider class="mb-2" />
      <p>
        <strong>CatStudio — Cinematic Anatomical Tomography Studio</strong> é um
        visualizador de tomografia com MPR e reconstrução 3D cinematográfica que
        roda inteiramente no navegador: os arquivos DICOM são lidos,
        decodificados e reconstruídos neste computador, sem servidor.
      </p>
      <ul class="my-2">
        <li>
          Geometria DICOM verificada: gantry inclinado, lacunas e espaçamento
          irregular são reamostrados para uma grade regular (com aviso);
          aquisições repetidas e matrizes diferentes viram volumes separados;
          Enhanced CT/MR multi-frame usa a posição de cada quadro.
        </li>
        <li>Privacidade: a identificação do paciente não aparece na tela.</li>
      </ul>
      <h2 class="mt-4">Base: VolView (Kitware)</h2>
      <v-divider class="mb-2" />
      <p>
        O CatStudio é construído sobre o
        <a
          rel="noopener noreferrer"
          target="_blank"
          href="https://github.com/Kitware/VolView"
          >VolView</a
        >, aplicação de código aberto da
        <a
          rel="noopener noreferrer"
          target="_blank"
          href="https://www.kitware.com/"
          >Kitware</a
        >
        (licença Apache 2.0), que usa
        <a
          rel="noopener noreferrer"
          target="_blank"
          href="https://github.com/Kitware/vtk-js"
          >vtk.js</a
        >
        para a visualização e
        <a
          rel="noopener noreferrer"
          target="_blank"
          href="https://github.com/InsightSoftwareConsortium/itk-wasm/"
          >itk-wasm</a
        >
        para leitura DICOM. O desenvolvimento do VolView foi financiado, em
        parte, pelo NIH (NIBIB e NIGMS R01EB021396, NIBIB R01EB014955, NCI
        R01CA220681 e NINDS R42NS086295). Os presets de renderização volumétrica
        vêm do VolView/ParaView/3D Slicer.
      </p>
      <h2 class="mt-4">Versões</h2>
      <v-divider class="mb-2" />
      <ul>
        <li>
          <div class="d-flex flex-flow align-center text-no-wrap">
            <span>VolView (base): </span>
            <v-badge inline :content="versions.volview" />
          </div>
        </li>
        <li>
          <div class="d-flex flex-flow align-center text-no-wrap">
            <span>vtk.js: </span>
            <v-badge inline :content="versions['vtk.js']" />
          </div>
        </li>
        <li>
          <div class="d-flex flex-flow align-center text-no-wrap">
            <span>itk-wasm: </span>
            <v-badge inline :content="versions['itk-wasm']" />
          </div>
        </li>
      </ul>
    </v-card-text>
  </v-card>
</template>

<script>
/* global __VERSIONS__ */

import { defineComponent } from 'vue';
import { useDisplay } from 'vuetify';
import CatStudioLogo from '@/src/catstudio/components/CatStudioLogo.vue';
import { useKeyboardShortcutsStore } from '../store/keyboard-shortcuts';

export default defineComponent({
  name: 'AboutBox',
  components: {
    CatStudioLogo,
  },
  setup() {
    const display = useDisplay();

    const keyboardStore = useKeyboardShortcutsStore();
    const openKeyboardShortcuts = () => {
      keyboardStore.settingsOpen = true;
    };

    return {
      openKeyboardShortcuts,
      mobile: display.xs,
      versions: {
        volview: __VERSIONS__.volview,
        'vtk.js': __VERSIONS__['vtk.js'],
        'itk-wasm': __VERSIONS__['itk-wasm'],
      },
    };
  },
});
</script>
