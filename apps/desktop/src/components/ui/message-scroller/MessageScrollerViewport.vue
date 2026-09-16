<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { onBeforeUnmount, onMounted, useTemplateRef, watch } from "vue";
import { cn } from "@/lib/utils";
import { SCROLL_KEYS, useMessageScrollerContext } from "./useMessageScroller";

const props = withDefaults(
  defineProps<{
    class?: HTMLAttributes["class"];
    preserveScrollOnPrepend?: boolean;
  }>(),
  {
    preserveScrollOnPrepend: true,
  },
);

const emit = defineEmits<{
  scroll: [event: Event];
}>();

const {
  autoscrolling,
  handleResize,
  scrollableAttr,
  setPreserveScrollOnPrepend,
  setViewportElement,
  syncAfterScroll,
  userScrollIntent,
} = useMessageScrollerContext();

const viewportEl = useTemplateRef<HTMLElement>("viewport");

watch(() => props.preserveScrollOnPrepend, setPreserveScrollOnPrepend, {
  immediate: true,
});

function onKeyDown(event: KeyboardEvent) {
  if (SCROLL_KEYS.has(event.key)) userScrollIntent();
}

let resizeObserver: ResizeObserver | null = null;
let resizeFrame = 0;
let scrollFrame = 0;

function onScroll(): void {
  // Scroll is a high-frequency event; coalesce state and anchor bookkeeping
  // into one commit per animation frame.
  window.cancelAnimationFrame(scrollFrame);
  scrollFrame = window.requestAnimationFrame(syncAfterScroll);
}

function onViewportScroll(event: Event): void {
  onScroll();
  emit("scroll", event);
}

onMounted(() => {
  const viewport = viewportEl.value;
  setViewportElement(viewport);
  if (!viewport || typeof ResizeObserver === "undefined") return;
  resizeObserver = new ResizeObserver(() => {
    window.cancelAnimationFrame(resizeFrame);
    resizeFrame = window.requestAnimationFrame(handleResize);
  });
  resizeObserver.observe(viewport);
});

onBeforeUnmount(() => {
  window.cancelAnimationFrame(resizeFrame);
  window.cancelAnimationFrame(scrollFrame);
  resizeObserver?.disconnect();
  resizeObserver = null;
  setViewportElement(null);
});
</script>

<template>
  <div
    ref="viewport"
    data-slot="message-scroller-viewport"
    role="region"
    aria-label="Messages"
    :tabindex="0"
    :data-scrollable="scrollableAttr"
    :data-autoscrolling="autoscrolling ? '' : undefined"
    :class="
      cn(
        'size-full min-h-0 min-w-0 scroll-fade-y no-scrollbar overflow-y-auto overscroll-contain contain-content outline-none',
        props.class,
      )
    "
    @scroll="onViewportScroll"
    @wheel="userScrollIntent()"
    @touchmove="userScrollIntent()"
    @keydown="onKeyDown"
  >
    <slot />
  </div>
</template>
