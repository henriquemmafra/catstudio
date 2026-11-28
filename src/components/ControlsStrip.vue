<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { ref, computed } from 'vue';
import {
  loadUserPromptedFiles,
  loadUserPromptedFolder,
} from '@/src/actions/loadUserFiles';
import useRemoteSaveStateStore from '@/src/store/remote-save-state';
import CloseableDialog from '@/src/components/CloseableDialog.vue';
import SaveSession from '@/src/components/SaveSession.vue';
import ControlButton from '@/src/components/ControlButton.vue';
import MessageNotifications from '@/src/components/MessageNotifications.vue';
import Settings from '@/src/components/Settings.vue';
import ControlsStripTools from '@/src/components/ControlsStripTools.vue';
import MessageCenter from '@/src/components/MessageCenter.vue';
import { MessageType, useMessageStore } from '@/src/store/messages';
import { ConnectionState, useServerStore } from '@/src/store/server';
import LayoutSelector from '@/src/components/LayoutSelector.vue';
import { valveMode } from '@/src/catstudio/valveMode';
import { directorMode } from '@/src/catstudio/director/mode';
import { cavityMode } from '@/src/catstudio/cavity/state';
import { closeExam } from '@/src/catstudio/closeExam';

interface Props {
  hasData: boolean;
}

defineProps<Props>();

function useSaveControls() {
  const remoteSaveStateStore = useRemoteSaveStateStore();
  const { isSaving, saveUrl } = storeToRefs(remoteSaveStateStore);

  const saveDialog = ref(false);

  const handleSave = () => {
    if (saveUrl.value !== '') {
      remoteSaveStateStore.saveState();
    } else {
      saveDialog.value = true;
    }
  };

  return { handleSave, isSaving, saveDialog };
}

function useMessageBubble() {
  const messageStore = useMessageStore();
  const count = computed(() => messageStore.importantMessages.length);
  const badgeColor = computed(() => {
    if (
      messageStore.importantMessages.find(
        (msg) => msg.type === MessageType.Error
      )
    ) {
      return 'error';
    }
    if (
      messageStore.importantMessages.find(
        (msg) => msg.type === MessageType.Warning
      )
    ) {
      return 'warning';
    }
    return 'primary';
  });

  return { count, badgeColor };
}

function useServerConnection() {
  const serverStore = useServerStore();

  const icon = computed(() => {
    switch (serverStore.connState) {
      case ConnectionState.Connected:
        return 'mdi-lan-check';
      case ConnectionState.Disconnected:
        return 'mdi-lan-disconnect';
      case ConnectionState.Pending:
        return 'mdi-lan-pending';
      default:
        throw new Error('Invalid connection state');
    }
  });

  const { url } = storeToRefs(serverStore);

  return { icon, url };
}

const settingsDialog = ref(false);
const messageDialog = ref(false);
const { icon: connIcon, url: serverUrl } = useServerConnection();
const { handleSave, saveDialog, isSaving } = useSaveControls();
const { count: msgCount, badgeColor: msgBadgeColor } = useMessageBubble();
</script>

<template>
  <div id="tools-strip" class="bg-surface d-flex flex-column align-center">
    <v-menu v-if="hasData" location="right" :close-on-content-click="true">
      <template v-slot:activator="{ props: menu }">
        <div>
          <control-button
            v-bind="menu"
            size="40"
            icon="mdi-home"
            name="Tela inicial (fechar o exame)"
            data-testid="go-home"
          />
        </div>
      </template>
      <v-card max-width="280">
        <v-card-text>
          Fechar o exame e voltar à tela inicial? Medidas e cortes que não foram
          salvos se perdem.
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text">Cancelar</v-btn>
          <v-btn
            color="primary"
            variant="flat"
            data-testid="go-home-confirm"
            @click="closeExam"
          >
            Fechar exame
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-menu>
    <control-button
      size="40"
      icon="mdi-file-multiple"
      name="Abrir arquivos DICOM"
      @click="loadUserPromptedFiles"
    />
    <control-button
      size="40"
      icon="mdi-folder-open"
      name="Abrir pasta do exame"
      data-testid="open-folder"
      @click="loadUserPromptedFolder"
    />
    <control-button
      size="40"
      icon="mdi-content-save-all"
      name="Salvar sessão (arquivo local)"
      :loading="isSaving"
      @click="handleSave"
    />
    <div class="my-1 tool-separator" />
    <v-menu location="left" :close-on-content-click="true">
      <template v-slot:activator="{ props }">
        <div>
          <control-button
            v-bind="props"
            size="40"
            icon="mdi-view-dashboard"
            name="Layouts"
          />
        </div>
      </template>
      <v-card>
        <v-card-text>
          <LayoutSelector />
        </v-card-text>
      </v-card>
    </v-menu>
    <controls-strip-tools v-if="hasData" />
    <control-button
      v-if="hasData"
      size="40"
      icon="mdi-heart-pulse"
      name="Valvas (holograma e 3D)"
      data-testid="open-valve-mode"
      @click="valveMode.open = true"
    />
    <control-button
      v-if="hasData"
      size="40"
      icon="mdi-heart-half-full"
      name="Volume de cavidade (VE, VD)"
      data-testid="open-cavity-volume"
      @click="cavityMode.open = !cavityMode.open"
    />
    <control-button
      v-if="hasData"
      size="40"
      icon="mdi-movie-open-edit-outline"
      name="Diretor de arte (peça o corte por texto)"
      data-testid="open-director-mode"
      @click="directorMode.open = true"
    />
    <v-spacer />
    <control-button
      v-if="serverUrl"
      size="40"
      :icon="connIcon"
      name="Servidor remoto"
      @click="settingsDialog = true"
    />
    <v-badge
      offset-x="10"
      offset-y="10"
      :content="msgCount"
      :color="msgBadgeColor"
      :model-value="msgCount > 0"
      id="notifications"
    >
      <control-button
        size="40"
        icon="mdi-bell-outline"
        name="Mensagens"
        @click="messageDialog = true"
      />
    </v-badge>
    <control-button
      size="40"
      icon="mdi-cog"
      name="Configurações"
      @click="settingsDialog = true"
    />
  </div>
  <closeable-dialog v-model="saveDialog" max-width="30%">
    <template v-slot="{ close }">
      <save-session :close="close" />
    </template>
  </closeable-dialog>
  <closeable-dialog v-model="messageDialog" content-class="fill-height">
    <message-center />
  </closeable-dialog>

  <message-notifications @open-notifications="messageDialog = true" />

  <closeable-dialog v-model="settingsDialog">
    <settings />
  </closeable-dialog>
</template>

<style src="@/src/components/styles/utils.css"></style>
<style scoped>
#tools-strip {
  border-left: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  flex: 0 0 40px;
}

.tool-separator {
  width: 75%;
  height: 1px;
  border: none;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.3);
}
</style>
