import { pinImage, unpinImage } from '@/src/catstudio/lazy';
import { computed, MaybeRef, unref } from 'vue';
import { until } from '@vueuse/core';
import { useImageCacheStore } from '@/src/store/image-cache';

export function untilLoaded(imageID: MaybeRef<string>) {
  const imageCacheStore = useImageCacheStore();
  // CatStudio: quem espera um volume precisa dele carregado (memória sob demanda)
  const pinnedID = unref(imageID);
  pinImage(pinnedID);
  imageCacheStore.imageById[pinnedID]?.startLoad();
  const settled = computed(() => {
    const id = unref(imageID);
    const image = imageCacheStore.imageById[id];
    if (!image || image.status.value === 'complete') return true;
    return !image.loading.value && !!imageCacheStore.imageErrors[id]?.length;
  });
  return until(settled)
    .toBe(true)
    .finally(() => unpinImage(pinnedID))
    .then(() => {
      const image = imageCacheStore.imageById[unref(imageID)];
      if (image?.status.value !== 'complete') {
        throw new Error('Image did not load');
      }
    });
}
