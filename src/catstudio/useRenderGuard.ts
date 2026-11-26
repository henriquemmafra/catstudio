/**
 * CatStudio — liga a trava de segurança (renderGuard) a uma vista 3D do vtk.js.
 *
 * O patch do vtk.js chama o guarda antes de desenhar o volume; é ali que ele
 * decide em que resolução o quadro parado sai. O fator vai para o mapper do
 * volume (lido pelo mesmo patch em renderPieceStart).
 */
import { onScopeDispose } from 'vue';
import type { vtkObject } from '@kitware/vtk.js/interfaces';
import type vtkVolumeMapper from '@kitware/vtk.js/Rendering/Core/VolumeMapper';
import type { View } from '@/src/core/vtk/types';
import {
  createRenderGuard,
  dropGuardStatus,
  guardStatus,
} from '@/src/catstudio/renderGuard';

function glOf(view: View): WebGL2RenderingContext | null {
  const own = view.renderWindowView as any;
  const root = own.getRootOpenGLRenderWindow?.() ?? own;
  try {
    return (root.get3DContext?.() ?? root.getContext?.() ?? null) as any;
  } catch {
    return null;
  }
}

/** Espera a placa terminar tudo o que foi enviado até aqui. */
function waitForGpu(view: View) {
  const gl = glOf(view);
  if (!gl || gl.isContextLost()) return;
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
}

export interface RenderGuardSources {
  viewID: () => string;
  mapper: vtkVolumeMapper;
  /** objetos cujo MTime muda quando o quadro mudaria */
  watched: () => Array<vtkObject | null | undefined>;
}

export function useRenderGuard(view: View, sources: RenderGuardSources) {
  const viewID = sources.viewID();
  const status = guardStatus(viewID);
  const specific = () =>
    sources.mapper.getViewSpecificProperties() as Record<string, unknown>;

  const setScale = (scale: number) => {
    // não chama modified(): o fator só vale para o próximo quadro
    specific().CatStudioStillScale = scale > 1 ? scale : 0;
  };

  const size = () => {
    const [w, h] = (view.renderWindowView as any).getSize?.() ?? [0, 0];
    return `${w}x${h}`;
  };

  const guard = createRenderGuard(
    {
      isAnimating: () => view.interactor.isAnimating(),
      signature: () =>
        [
          size(),
          ...sources
            .watched()
            .map((obj) => (obj && !obj.isDeleted() ? obj.getMTime() : 0)),
        ].join('.'),
      setScale,
      setInteractionScale: (scale) => {
        specific().CatStudioInteractionScale = scale;
      },
      renderTimed: () => {
        const start = performance.now();
        view.widgetManager.renderWidgets();
        view.renderWindow.render();
        waitForGpu(view);
        return performance.now() - start;
      },
      afterCurrentRender: (fn) => queueMicrotask(fn),
      yieldFrame: () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => setTimeout(resolve));
        }),
      now: () => performance.now(),
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (handle) => clearTimeout(handle as number),
    },
    status
  );

  // o patch do vtk.js chama estes ganchos no início e no fim do desenho do
  // volume (os objetos do vtk.js são congelados; não dá para embrulhar métodos)
  let externalStart = 0;
  specific().CatStudioBeforeRender = () => {
    guard.beforeRender();
    externalStart = guard.wantsTiming() ? performance.now() : 0;
  };
  specific().CatStudioAfterRender = () => {
    if (!externalStart) return;
    waitForGpu(view);
    guard.afterExternalRender(performance.now() - externalStart);
    externalStart = 0;
  };

  onScopeDispose(() => {
    guard.dispose();
    delete specific().CatStudioBeforeRender;
    delete specific().CatStudioAfterRender;
    delete specific().CatStudioInteractionScale;
    setScale(0);
    dropGuardStatus(viewID);
  });

  return status;
}
