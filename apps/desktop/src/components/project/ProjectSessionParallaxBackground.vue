<script setup lang="ts">
import {
  BotIcon,
  BracesIcon,
  Code2Icon,
  CpuIcon,
  DatabaseIcon,
  FileCode2Icon,
  FolderTreeIcon,
  GitBranchIcon,
  GitPullRequestIcon,
  PanelLeftIcon,
  SearchCodeIcon,
  ShieldCheckIcon,
  SparklesIcon,
  TerminalIcon,
  WorkflowIcon,
  WrenchIcon,
} from "@lucide/vue";
import type { Component } from "vue";
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  ParallaxFloat,
  ParallaxFloatElement,
} from "@/components/ui/parallax-float";
import { cn } from "@/lib/utils";

interface ParallaxIcon {
  id: string;
  icon: Component;
  x: string;
  y: string;
  depth: number;
  opacity: number;
  size: "size-12" | "size-14" | "size-16" | "size-20";
  iconSize: "size-8" | "size-10" | "size-12";
  fadeDelay: number;
}

const props = withDefaults(defineProps<{ fadeOut?: boolean }>(), {
  fadeOut: false,
});
const emit = defineEmits<{ faded: [] }>();
const FADE_STEP_MS = 20;
const FADE_DURATION_MS = 425;
const isRevealed = ref(false);

const iconSizeClasses: Record<ParallaxIcon["iconSize"], string> = {
  "size-8": "[&_svg]:size-8",
  "size-10": "[&_svg]:size-10",
  "size-12": "[&_svg]:size-12",
};

interface IconDefinition {
  id: string;
  icon: Component;
}

interface PositionSlot {
  x: string;
  y: string;
}

const parallaxIconDefinitions: readonly IconDefinition[] = [
  {
    id: "agent",
    icon: BotIcon,
  },
  {
    id: "code",
    icon: Code2Icon,
  },
  {
    id: "workflow",
    icon: WorkflowIcon,
  },
  {
    id: "terminal",
    icon: TerminalIcon,
  },
  {
    id: "files",
    icon: FolderTreeIcon,
  },
  {
    id: "branch",
    icon: GitBranchIcon,
  },
  {
    id: "security",
    icon: ShieldCheckIcon,
  },
  {
    id: "tools",
    icon: WrenchIcon,
  },
  {
    id: "runtime",
    icon: CpuIcon,
  },
  {
    id: "data",
    icon: DatabaseIcon,
  },
  {
    id: "search",
    icon: SearchCodeIcon,
  },
  {
    id: "panels",
    icon: PanelLeftIcon,
  },
  {
    id: "syntax",
    icon: BracesIcon,
  },
  {
    id: "review",
    icon: GitPullRequestIcon,
  },
  {
    id: "file-code",
    icon: FileCode2Icon,
  },
  {
    id: "spark",
    icon: SparklesIcon,
  },
];

/** Fixed positions keep the composition art-directed while each visual
 * parameter is shuffled independently, so no slot implies a depth or size. */
const parallaxSlots: readonly PositionSlot[] = [
  { x: "22%", y: "34%" },
  { x: "72%", y: "26%" },
  { x: "29%", y: "69%" },
  { x: "79%", y: "61%" },
  { x: "14%", y: "18%" },
  { x: "82%", y: "21%" },
  { x: "18%", y: "79%" },
  { x: "82%", y: "75%" },
  { x: "47%", y: "10%" },
  { x: "57%", y: "88%" },
  { x: "9%", y: "51%" },
  { x: "91%", y: "43%" },
  { x: "26%", y: "12%" },
  { x: "76%", y: "12%" },
  { x: "10%", y: "86%" },
  { x: "89%", y: "86%" },
];

const depthValues = [
  0.28, 0.32, 0.4, 0.65, 0.7, 0.75, 0.85, 1.15, 1.2, 1.35, 1.4, 1.55, 1.8, 2.1,
  2.4, 3.8,
];

const MIN_ICON_OPACITY = 0.16;
const MAX_ICON_OPACITY = 0.45;

const iconScaleOptions: readonly Pick<ParallaxIcon, "size" | "iconSize">[] = [
  { size: "size-12", iconSize: "size-8" },
  { size: "size-14", iconSize: "size-8" },
  { size: "size-14", iconSize: "size-10" },
  { size: "size-16", iconSize: "size-10" },
  { size: "size-16", iconSize: "size-12" },
  { size: "size-20", iconSize: "size-12" },
  { size: "size-12", iconSize: "size-8" },
  { size: "size-14", iconSize: "size-10" },
  { size: "size-16", iconSize: "size-10" },
  { size: "size-20", iconSize: "size-12" },
  { size: "size-14", iconSize: "size-8" },
  { size: "size-16", iconSize: "size-12" },
  { size: "size-12", iconSize: "size-8" },
  { size: "size-14", iconSize: "size-10" },
  { size: "size-16", iconSize: "size-10" },
  { size: "size-14", iconSize: "size-8" },
];

function shuffle<T>(values: readonly T[]): T[] {
  const shuffled = [...values];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [
      shuffled[swapIndex],
      shuffled[index],
    ];
  }
  return shuffled;
}

function opacityForDepth(depth: number): number {
  const minDepth = Math.min(...depthValues);
  const maxDepth = Math.max(...depthValues);
  const normalizedDepth = (depth - minDepth) / (maxDepth - minDepth);
  return (
    MIN_ICON_OPACITY + normalizedDepth * (MAX_ICON_OPACITY - MIN_ICON_OPACITY)
  );
}

const shuffledIcons = shuffle(parallaxIconDefinitions);
const shuffledDepths = shuffle(depthValues);
const shuffledScales = shuffle(iconScaleOptions);
const parallaxIcons: readonly ParallaxIcon[] = parallaxSlots.map(
  (slot, index) => {
    const depth = shuffledDepths[index];
    return {
      ...shuffledIcons[index],
      ...slot,
      depth,
      opacity: opacityForDepth(depth),
      ...shuffledScales[index],
      fadeDelay: 0,
    };
  },
);

const fadeOrder = new Map(
  [...parallaxIcons]
    .sort((first, second) => first.depth - second.depth)
    .map((item, index) => [item.id, index]),
);
const parallaxIconsWithFade: readonly ParallaxIcon[] = parallaxIcons.map(
  (item) => ({
    ...item,
    fadeDelay: (fadeOrder.get(item.id) ?? 0) * FADE_STEP_MS,
  }),
);

let fadeTimer: number | undefined;
let revealFrame: number | undefined;
watch(
  () => props.fadeOut,
  (fadeOut) => {
    if (fadeTimer !== undefined) window.clearTimeout(fadeTimer);
    if (!fadeOut) return;

    fadeTimer = window.setTimeout(
      () => {
        fadeTimer = undefined;
        emit("faded");
      },
      (parallaxIconsWithFade.length - 1) * FADE_STEP_MS + FADE_DURATION_MS,
    );
  },
  { immediate: true },
);

onMounted(() => {
  revealFrame = window.requestAnimationFrame(() => {
    revealFrame = undefined;
    isRevealed.value = true;
  });
});

onBeforeUnmount(() => {
  if (fadeTimer !== undefined) window.clearTimeout(fadeTimer);
  if (revealFrame !== undefined) window.cancelAnimationFrame(revealFrame);
});
</script>

<template>
  <div
    aria-hidden="true"
    data-slot="session-parallax-background"
    class="pointer-events-none absolute inset-0 overflow-hidden"
  >
    <ParallaxFloat
      class="absolute inset-0"
      :easing-factor="0.05"
      :sensitivity="-0.5"
    >
      <ParallaxFloatElement
        v-for="item in parallaxIconsWithFade"
        :key="item.id"
        :depth="item.depth"
        :style="{
          left: item.x,
          top: item.y,
          opacity: props.fadeOut || !isRevealed ? 0 : item.opacity,
          transitionDelay: isRevealed ? `${item.fadeDelay}ms` : '0ms',
          transitionDuration: `${FADE_DURATION_MS}ms`,
        }"
        :class="
          cn(
            'flex -translate-x-1/2 -translate-y-1/2 items-center justify-center text-chart-2 transition-opacity ease-out',
            item.size,
            iconSizeClasses[item.iconSize],
          )
        "
      >
        <component :is="item.icon" />
      </ParallaxFloatElement>
    </ParallaxFloat>
  </div>
</template>
