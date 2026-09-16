<script setup lang="ts">
import { computed, onBeforeUnmount, useTemplateRef } from "vue";

const props = withDefaults(
  defineProps<{
    source: string;
    title: string;
    zoom?: number;
  }>(),
  { zoom: 100 },
);
const emit = defineEmits<{ zoomWheel: [event: WheelEvent] }>();
const frame = useTemplateRef<HTMLIFrameElement>("frame");

function forwardWheel(event: WheelEvent): void {
  emit("zoomWheel", event);
}

function frameLoaded(): void {
  frame.value?.contentDocument?.addEventListener("wheel", forwardWheel, {
    passive: false,
  });
}

onBeforeUnmount(() => {
  frame.value?.contentDocument?.removeEventListener("wheel", forwardWheel);
});

const scale = computed(() => props.zoom / 100);
const frameStyle = computed(() => ({
  height: `${100 / scale.value}%`,
  transform: `scale(${scale.value})`,
  transformOrigin: "top left",
  width: `${100 / scale.value}%`,
}));
</script>

<template>
  <div class="h-full min-h-0 overflow-hidden bg-white">
    <iframe
      ref="frame"
      class="block border-0 bg-white"
      :srcdoc="source"
      :style="frameStyle"
      :title="title"
      sandbox="allow-same-origin"
      referrerpolicy="no-referrer"
      @load="frameLoaded"
    />
  </div>
</template>
