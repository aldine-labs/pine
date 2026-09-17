<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { onBeforeUnmount, onMounted, useTemplateRef, watch } from "vue";
import { cn } from "@/lib/utils";
import {
  SCROLL_KEYS,
  type MessageScrollerScrollDirection,
  useMessageScrollerContext,
} from "./useMessageScroller";

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
  scroll: [event: Event, isProgrammatic: boolean];
  userScrollIntent: [];
}>();

const {
  autoscrolling,
  handleResize,
  isProgrammaticScroll,
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
  if (!SCROLL_KEYS.has(event.key)) return;
  const direction: MessageScrollerScrollDirection = [
    "ArrowDown",
    "End",
    "PageDown",
    " ",
  ].includes(event.key)
    ? "end"
    : "start";
  onUserScrollIntent(direction);
}

function onUserScrollIntent(
  direction?: MessageScrollerScrollDirection,
): void {
  userScrollIntent(direction);
  emit("userScrollIntent");
}

function onWheel(event: WheelEvent): void {
  onUserScrollIntent(
    event.deltaY > 0 ? "end" : event.deltaY < 0 ? "start" : undefined,
  );
}

let lastTouchY: number | null = null;

function onTouchStart(event: TouchEvent): void {
  lastTouchY = event.touches[0]?.clientY ?? null;
}

function onTouchMove(event: TouchEvent): void {
  const touchY = event.touches[0]?.clientY ?? null;
  const direction =
    touchY !== null && lastTouchY !== null
      ? touchY < lastTouchY
        ? "end"
        : touchY > lastTouchY
          ? "start"
          : undefined
      : undefined;
  lastTouchY = touchY;
  onUserScrollIntent(direction);
}

function onTouchEnd(): void {
  lastTouchY = null;
}

let resizeObserver: ResizeObserver | null = null;
let scrollFrame = 0;

function onScroll(): void {
  // Scroll is a high-frequency event; coalesce state and anchor bookkeeping
  // into one commit per animation frame.
  window.cancelAnimationFrame(scrollFrame);
  scrollFrame = window.requestAnimationFrame(syncAfterScroll);
}

function onViewportScroll(event: Event): void {
  onScroll();
  emit("scroll", event, isProgrammaticScroll.value);
}

onMounted(() => {
  const viewport = viewportEl.value;
  setViewportElement(viewport);
  if (!viewport || typeof ResizeObserver === "undefined") return;
  resizeObserver = new ResizeObserver(() => {
    handleResize();
  });
  resizeObserver.observe(viewport);
});

onBeforeUnmount(() => {
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
    @wheel="onWheel"
    @touchstart="onTouchStart"
    @touchmove="onTouchMove"
    @touchend="onTouchEnd"
    @touchcancel="onTouchEnd"
    @keydown="onKeyDown"
  >
    <slot />
  </div>
</template>
