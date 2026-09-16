<script setup lang="ts">
import { ImageNode } from "markstream-vue";
import { computed } from "vue";
import { resolveMarkdownImageSrc } from "@/lib/markdownImage";

/**
 * The `node` markstream hands a custom `image` renderer. `loading` mirrors
 * the streaming flag markstream passes its own image renderer.
 */
interface MarkdownImageNodeProps {
  node: {
    type: "image";
    src: string;
    alt: string;
    title: string | null;
    raw: string;
    loading?: boolean;
  };
  loading?: boolean;
}

const props = defineProps<MarkdownImageNodeProps>();

/**
 * Markdown images must resolve like Typora's: remote and inline-data URLs
 * load directly, while local files route through `pine-attachment://` so the
 * main process can validate the path. markstream's own ImageNode stays in
 * charge of placeholders, error states, and viewport reporting — only the
 * `src` is rewritten here.
 */
const displayNode = computed(() => ({
  ...props.node,
  src: resolveMarkdownImageSrc(props.node.src),
}));

const isLoading = computed(() => props.loading ?? props.node.loading);
</script>

<template>
  <ImageNode :node="displayNode" :loading="isLoading" />
</template>
