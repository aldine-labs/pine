<script setup lang="ts">
import ProjectOfficePreview from "../ProjectOfficePreview.vue";
import type {
  PreviewRendererEvents,
  PreviewRendererProps,
} from "./previewRenderer";

defineProps<PreviewRendererProps>();
const emit = defineEmits<PreviewRendererEvents>();
</script>

<template>
  <ProjectOfficePreview
    v-if="preview.kind === 'office'"
    class="h-full min-h-0"
    :format="preview.format"
    :source="preview.url"
    :inverted="inverted"
    :zoom="zoom"
    :render-zoom="renderZoom"
    :selection-label="selectionLabel"
    @failed="emit('failed')"
    @selection-change="emit('selectionChange', $event)"
  />
</template>
