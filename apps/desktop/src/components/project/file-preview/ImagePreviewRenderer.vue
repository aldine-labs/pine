<script setup lang="ts">
import { computed, ref, useTemplateRef, watch } from "vue";
import { useElementSize } from "@vueuse/core";
import type {
  PreviewRendererEvents,
  PreviewRendererProps,
} from "./previewRenderer";

const props = defineProps<PreviewRendererProps>();
const emit = defineEmits<PreviewRendererEvents>();
const viewport = useTemplateRef<HTMLDivElement>("viewport");
const { width: viewportWidth, height: viewportHeight } =
  useElementSize(viewport);
const dimensions = ref<{ width: number; height: number }>();
const imageSize = computed(() => {
  const width = dimensions.value?.width ?? 0;
  const height = dimensions.value?.height ?? 0;
  if (!width || !height) return undefined;
  const fit = Math.min(
    1,
    viewportWidth.value > 48 ? (viewportWidth.value - 48) / width : 1,
    viewportHeight.value > 48 ? (viewportHeight.value - 48) / height : 1,
  );
  const scale = (fit * props.zoom) / 100;
  return { width: `${width * scale}px`, height: `${height * scale}px` };
});

function imageLoaded(event: Event): void {
  const image = event.currentTarget as HTMLImageElement;
  dimensions.value = {
    width: image.naturalWidth,
    height: image.naturalHeight,
  };
  emit("metadataChange", dimensions.value);
}

watch(
  () => props.preview,
  () => {
    dimensions.value = undefined;
  },
);
</script>

<template>
  <div
    v-if="preview.kind === 'image'"
    ref="viewport"
    data-slot="image-preview-viewport"
    class="scroll-fade h-full min-h-0 overflow-auto p-6"
  >
    <div class="grid min-h-full min-w-full h-max w-max place-items-center">
      <img
        :src="preview.url"
        :alt="fileName"
        class="block max-w-none shrink-0 object-contain"
        :style="imageSize"
        @load="imageLoaded"
        @error="emit('failed')"
      />
    </div>
  </div>
</template>
