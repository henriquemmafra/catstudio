/**
 * CatStudio — política de memória.
 *
 * O VolView original começava a carregar todas as séries assim que a pasta
 * era aberta; num exame completo (várias fases, reconstruções, MPRs) isso
 * soma gigabytes e derruba a aba. Aqui só ficam na memória os volumes
 * exibidos em alguma vista (e as camadas sobre eles); ao trocar de série, o
 * volume anterior é liberado e volta a ser lido dos arquivos se for aberto
 * de novo.
 */
import { computed, watch } from 'vue';
import { isLazyImage, memoryPolicy, pinned } from './lazy';
import { useViewStore } from '@/src/store/views';
import { useLayersStore } from '@/src/store/datasets-layers';
import { useImageCacheStore } from '@/src/store/image-cache';

export function useMemoryPolicy() {
  const viewStore = useViewStore();
  const layersStore = useLayersStore();
  const imageCache = useImageCacheStore();
  memoryPolicy.active = true;

  const needed = computed(() => {
    const ids = new Set<string>();
    Object.values(viewStore.viewByID).forEach((view) => {
      if (view?.dataID) ids.add(view.dataID);
    });
    [...ids].forEach((id) =>
      (layersStore.parentToLayers[id] ?? []).forEach((layer) =>
        ids.add(layer.selection)
      )
    );
    pinned.forEach((_, id) => ids.add(id));
    return ids;
  });

  watch(
    [needed, () => imageCache.imageIds.length],
    () => {
      const ids = needed.value;
      Object.entries(imageCache.imageById).forEach(([id, image]) => {
        if (!isLazyImage(image)) return;
        if (ids.has(id)) image.startLoad();
        else image.unloadData();
      });
    },
    { immediate: true, flush: 'post' }
  );
}
