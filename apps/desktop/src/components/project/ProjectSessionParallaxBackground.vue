<script setup lang="ts">
import {
  BriefcaseBusinessIcon,
  BotIcon,
  BracesIcon,
  CalculatorIcon,
  CalendarDaysIcon,
  ChartColumnIcon,
  ChartPieIcon,
  ClipboardListIcon,
  Code2Icon,
  ContactRoundIcon,
  CpuIcon,
  DatabaseIcon,
  FileCode2Icon,
  FileSpreadsheetIcon,
  FileTextIcon,
  FolderTreeIcon,
  FolderOpenIcon,
  GitBranchIcon,
  GitPullRequestIcon,
  HandshakeIcon,
  ListTodoIcon,
  MailIcon,
  MessageCircleIcon,
  NotebookPenIcon,
  PanelLeftIcon,
  PresentationIcon,
  PrinterIcon,
  ReceiptTextIcon,
  SearchCodeIcon,
  ShieldCheckIcon,
  SignatureIcon,
  SparklesIcon,
  TerminalIcon,
  UsersIcon,
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
  exitDelay: number;
}

const props = withDefaults(defineProps<{ fadeOut?: boolean }>(), {
  fadeOut: false,
});
const emit = defineEmits<{ faded: [] }>();
const FADE_STEP_MS = 20;
const FADE_DURATION_MS = 900;
const EXIT_MOVE_DELAY_MS = 40;
const EXIT_MOVE_DURATION_MS = 700;
const EXIT_FADE_DURATION_MS = 420;
const ICON_BLUR_PX = 8;
const isRevealed = ref(false);

function exitTransitionDelay(delay: number): string {
  const motionDelay = delay + EXIT_MOVE_DELAY_MS;
  return `${motionDelay}ms, ${motionDelay}ms, ${delay}ms, ${motionDelay}ms, ${delay}ms`;
}

function inwardPosition(position: string): string {
  return `${50 + (Number.parseFloat(position) - 50) * 0.85}%`;
}

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
  { id: "documents", icon: FileTextIcon },
  { id: "spreadsheets", icon: FileSpreadsheetIcon },
  { id: "presentations", icon: PresentationIcon },
  { id: "mail", icon: MailIcon },
  { id: "calendar", icon: CalendarDaysIcon },
  { id: "checklist", icon: ClipboardListIcon },
  { id: "tasks", icon: ListTodoIcon },
  { id: "charts", icon: ChartColumnIcon },
  { id: "reports", icon: ChartPieIcon },
  { id: "team", icon: UsersIcon },
  { id: "business", icon: BriefcaseBusinessIcon },
  { id: "notes", icon: NotebookPenIcon },
  { id: "contacts", icon: ContactRoundIcon },
  { id: "messages", icon: MessageCircleIcon },
  { id: "folders", icon: FolderOpenIcon },
  { id: "print", icon: PrinterIcon },
  { id: "sign", icon: SignatureIcon },
  { id: "receipts", icon: ReceiptTextIcon },
  { id: "calculate", icon: CalculatorIcon },
  { id: "collaboration", icon: HandshakeIcon },
];

/** Fixed positions keep the composition art-directed while each visual
 * parameter is shuffled independently, so no slot implies a depth or size. */
// Offset rows keep the composition loose while balancing eight icons on each
// side and leaving the central copy and bottom composer clear.
const parallaxSlots: readonly PositionSlot[] = [
  { x: "15%", y: "18%" },
  { x: "34%", y: "15%" },
  { x: "66%", y: "16%" },
  { x: "85%", y: "20%" },
  { x: "10%", y: "39%" },
  { x: "28%", y: "35%" },
  { x: "74%", y: "36%" },
  { x: "90%", y: "42%" },
  { x: "11%", y: "62%" },
  { x: "27%", y: "66%" },
  { x: "73%", y: "65%" },
  { x: "89%", y: "60%" },
  { x: "18%", y: "81%" },
  { x: "38%", y: "79%" },
  { x: "64%", y: "80%" },
  { x: "83%", y: "82%" },
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

const selectedIcons = shuffle(parallaxIconDefinitions).slice(
  0,
  parallaxSlots.length,
);
const shuffledDepths = shuffle(depthValues);
const shuffledScales = shuffle(iconScaleOptions);
const parallaxIcons: readonly ParallaxIcon[] = parallaxSlots.map(
  (slot, index) => {
    const depth = shuffledDepths[index];
    return {
      ...selectedIcons[index],
      ...slot,
      depth,
      opacity: opacityForDepth(depth),
      ...shuffledScales[index],
      fadeDelay: 0,
      exitDelay: 0,
    };
  },
);

const fadeOrder = new Map(
  [...parallaxIcons]
    .sort((first, second) => first.depth - second.depth)
    .map((item, index) => [item.id, index]),
);
const exitOrder = new Map(
  [...parallaxIcons]
    .sort((first, second) => second.depth - first.depth)
    .map((item, index) => [item.id, index]),
);
const parallaxIconsWithFade: readonly ParallaxIcon[] = parallaxIcons.map(
  (item) => ({
    ...item,
    fadeDelay: (fadeOrder.get(item.id) ?? 0) * FADE_STEP_MS,
    exitDelay: (exitOrder.get(item.id) ?? 0) * FADE_STEP_MS,
  }),
);

let fadeTimer: number | undefined;
let revealFrame: number | undefined;
watch(
  () => props.fadeOut,
  (fadeOut) => {
    if (fadeTimer !== undefined) window.clearTimeout(fadeTimer);
    if (!fadeOut) return;

    const reducedMotion = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    fadeTimer = window.setTimeout(
      () => {
        fadeTimer = undefined;
        emit("faded");
      },
      reducedMotion
        ? 0
        : (parallaxIconsWithFade.length - 1) * FADE_STEP_MS +
            EXIT_MOVE_DELAY_MS +
            EXIT_MOVE_DURATION_MS,
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
        :data-parallax-icon="item.id"
        :depth="item.depth"
        :style="{
          left: props.fadeOut || !isRevealed ? inwardPosition(item.x) : item.x,
          top: props.fadeOut || !isRevealed ? inwardPosition(item.y) : item.y,
          opacity: props.fadeOut || !isRevealed ? 0 : item.opacity,
          scale: props.fadeOut ? 0.96 : !isRevealed ? 0.92 : 1,
          filter: `blur(${props.fadeOut || !isRevealed ? ICON_BLUR_PX : 0}px)`,
          transitionDelay: isRevealed
            ? props.fadeOut
              ? exitTransitionDelay(item.exitDelay)
              : `${item.fadeDelay}ms`
            : '0ms',
          transitionDuration: props.fadeOut
            ? `${EXIT_MOVE_DURATION_MS}ms, ${EXIT_MOVE_DURATION_MS}ms, ${EXIT_FADE_DURATION_MS}ms, ${EXIT_MOVE_DURATION_MS}ms, ${EXIT_FADE_DURATION_MS}ms`
            : `${FADE_DURATION_MS}ms`,
          transitionTimingFunction: props.fadeOut
            ? 'var(--ease-out-expo)'
            : 'cubic-bezier(0.25, 0.1, 0.25, 1)',
        }"
        :class="
          cn(
            'flex -translate-x-1/2 -translate-y-1/2 items-center justify-center text-chart-2 transition-[left,top,opacity,scale,filter] motion-reduce:transition-none',
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
