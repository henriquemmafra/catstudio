<script setup lang="ts">
import { VtkRenderWindowParentContext } from '@/src/components/vtk/context';
import { useWebGLWatchdog } from '@/src/composables/useWebGLWatchdog';
import { debugGl } from '@/src/catstudio/debug';
import { releaseOpenGLRenderWindow } from '@/src/core/vtk/releaseRenderWindow';
import vtkRenderWindow from '@kitware/vtk.js/Rendering/Core/RenderWindow';
import vtkOpenGLRenderWindow from '@kitware/vtk.js/Rendering/OpenGL/RenderWindow';
import { effectScope, onScopeDispose, onUnmounted, provide, watch } from 'vue';

const scope = effectScope(true);

const api = scope.run(() => {
  const renderWindow = vtkRenderWindow.newInstance();
  const rwView = renderWindow.newAPISpecificView('WebGL');
  renderWindow.addView(rwView);
  rwView.initialize();
  debugGl.canvas = rwView.getCanvas() ?? null;

  // Child views unmount before this hook runs, so their nodes are already off
  // the scene graph by the time the WebGL context they draw through goes away.
  onScopeDispose(() => {
    renderWindow.removeView(rwView);
    releaseOpenGLRenderWindow(rwView as vtkOpenGLRenderWindow);
    renderWindow.delete();
  });

  return {
    renderWindow,
    renderWindowView: rwView as vtkOpenGLRenderWindow,
  };
})!;

const contextLost = useWebGLWatchdog(api);

// CatStudio: quem monta este componente pode recriá-lo quando a placa de
// vídeo derruba o contexto, em vez de deixar todas as vistas pretas.
const emit = defineEmits<{ (e: 'context-lost'): void }>();
watch(contextLost, (lost) => {
  if (lost) emit('context-lost');
});

onUnmounted(() => {
  scope.stop();
});

provide(VtkRenderWindowParentContext, { ...api, contextLost });
</script>

<template><slot /></template>
