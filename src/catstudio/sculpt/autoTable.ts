/**
 * CatStudio — escultura do 3D: tirar a mesa sozinho ao abrir o exame
 * (opcional; a escolha fica guardada no navegador).
 */
import { reactive } from 'vue';

const STORAGE_KEY = 'catstudio.3d.tirarMesa';

function stored(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export const autoTable = reactive({ enabled: stored() });

export function setAutoTable(enabled: boolean) {
  autoTable.enabled = enabled;
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
  } catch {
    // vale só nesta aba
  }
}

/** Exames em que o corte automático já rodou (não repete depois de desfazer). */
const done = new Set<string>();

export function shouldAutoCut(imageID: string, alreadySculpted: boolean) {
  if (!autoTable.enabled || alreadySculpted || done.has(imageID)) return false;
  done.add(imageID);
  return true;
}

export const forgetAutoCuts = () => done.clear();
