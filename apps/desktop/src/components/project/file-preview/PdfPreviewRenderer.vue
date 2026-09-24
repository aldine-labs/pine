<script setup lang="ts">
import ProjectPdfPreview from "../ProjectPdfPreview.vue";
import type {
  PreviewRendererEvents,
  PreviewRendererProps,
} from "./previewRenderer";

defineProps<PreviewRendererProps>();
const emit = defineEmits<PreviewRendererEvents>();
</script>

<template>
  <ProjectPdfPreview
    v-if="preview.kind === 'pdf'"
    class="h-full min-h-0"
    :source="preview.url"
    :inverted="inverted"
    :zoom="zoom"
    :render-zoom="renderZoom"
    :selection-label="selectionLabel"
    @loaded="emit('metadataChange', { pageCount: $event })"
    @failed="emit('failed')"
    @selection-change="emit('selectionChange', $event)"
  />
</template>
