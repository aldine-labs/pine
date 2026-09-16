<script setup lang="ts">
import { computed, nextTick } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import {
  useMessageScroller,
  useMessageScrollerVisibility,
} from "@/components/ui/message-scroller";
import { cn } from "@/lib/utils";
import type { PineTranscriptMessage } from "@/stores/session";

type EnsureMessageLoaded = (messageId: string) => Promise<void> | void;

const props = defineProps<{
  ensureMessageLoaded?: EnsureMessageLoaded;
  turns: PineTranscriptMessage[];
}>();

const minimumTurnCount = 3;
const maximumMarkerCount = 9;
const { t } = useI18n();
const { scrollToMessage } = useMessageScroller();
const visibility = useMessageScrollerVisibility();
const markerCount = computed(() =>
  Math.min(props.turns.length, maximumMarkerCount),
);
const activeTurnIndex = computed(() =>
  props.turns.findIndex(
    (message) => message.id === visibility.value.currentAnchorId,
  ),
);
const activeMarkerIndex = computed(() => {
  if (activeTurnIndex.value < 0 || markerCount.value <= 1) {
    return activeTurnIndex.value;
  }

  return Math.round(
    (activeTurnIndex.value / (props.turns.length - 1)) *
      (markerCount.value - 1),
  );
});

function excerpt(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function messageExcerpt(message: PineTranscriptMessage): string {
  return excerpt(
    message.blocks
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("\n"),
  );
}

async function scrollToTurn(messageId: string): Promise<void> {
  await props.ensureMessageLoaded?.(messageId);
  await nextTick();
  scrollToMessage(messageId, { align: "start", behavior: "smooth" });
}
</script>

<template>
  <div
    v-if="props.turns.length >= minimumTurnCount"
    class="absolute right-0 top-1/2 z-10 hidden -translate-y-1/2 sm:block"
  >
    <HoverCard :open-delay="120" :close-delay="120">
      <HoverCardTrigger as-child>
        <Button
          variant="ghost"
          size="icon-sm"
          class="h-auto min-h-12 flex-col gap-1 rounded-l-md rounded-r-none px-2 py-3"
          :aria-label="t('project.transcript.outline')"
        >
          <span
            v-for="markerIndex in markerCount"
            :key="markerIndex"
            :class="
              cn(
                'h-0.5 w-3 rounded-full bg-muted-foreground/35',
                markerIndex - 1 === activeMarkerIndex && 'bg-foreground',
              )
            "
          />
        </Button>
      </HoverCardTrigger>

      <HoverCardContent
        side="left"
        align="center"
        :side-offset="8"
        class="p-1.5"
      >
        <nav
          data-slot="project-transcript-outline-menu"
          class="scroll-fade no-scrollbar flex max-h-80 flex-col gap-0.5 overflow-y-auto"
          :aria-label="t('project.transcript.outline')"
        >
          <Button
            v-for="message in props.turns"
            :key="message.id"
            class="w-full min-w-0 justify-start"
            :variant="
              visibility.currentAnchorId === message.id ? 'secondary' : 'ghost'
            "
            size="sm"
            :aria-current="
              visibility.currentAnchorId === message.id ? 'location' : undefined
            "
            @click="scrollToTurn(message.id)"
          >
            <span class="min-w-0 truncate">
              {{ messageExcerpt(message) }}
            </span>
          </Button>
        </nav>
      </HoverCardContent>
    </HoverCard>
  </div>
</template>
