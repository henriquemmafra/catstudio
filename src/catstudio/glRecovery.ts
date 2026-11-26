/**
 * CatStudio — recuperação da perda do contexto de vídeo (WebGL).
 *
 * Quando a placa fica sem memória o navegador derruba o contexto e todas as
 * vistas ficam pretas, sem volta. Aqui as vistas são recriadas (a chave do
 * componente-pai muda). Se a queda se repetir várias vezes em pouco tempo, o
 * CatStudio para de insistir e oferece um botão.
 */
import { ref } from 'vue';

export const MAX_RECOVERIES = 3;
export const RECOVERY_WINDOW_MS = 60_000;
export const RECOVERY_DELAY_MS = 400;

/** Decide se ainda vale recriar: no máximo 3 quedas por minuto. */
export function shouldRecover(recent: number[], now: number): boolean {
  return (
    recent.filter((at) => now - at < RECOVERY_WINDOW_MS).length < MAX_RECOVERIES
  );
}

export function useGlRecovery(now: () => number = Date.now) {
  const glGeneration = ref(0);
  const glGaveUp = ref(false);
  let recent: number[] = [];

  const recoverGl = () => {
    if (!shouldRecover(recent, now())) {
      glGaveUp.value = true;
      return;
    }
    recent = [...recent.filter((at) => now() - at < RECOVERY_WINDOW_MS), now()];
    // o navegador precisa de um instante para liberar o contexto antigo
    setTimeout(() => {
      glGeneration.value += 1;
    }, RECOVERY_DELAY_MS);
  };

  const retryGl = () => {
    recent = [];
    glGaveUp.value = false;
    glGeneration.value += 1;
  };

  return { glGeneration, glGaveUp, recoverGl, retryGl };
}
