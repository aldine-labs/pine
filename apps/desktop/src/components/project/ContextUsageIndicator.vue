<script setup lang="ts">
import { storeToRefs } from "pinia";
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { handleError } from "@/app/errors/errorHandler";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { formatTokenCount } from "@/lib/format-token-count";
import { useSessionStore } from "@/stores/session";

const { t } = useI18n();
const sessionStore = useSessionStore();
const { activeSession, contextUsage: usage } = storeToRefs(sessionStore);
const isCompacting = ref(false);

const RING_RADIUS = 8;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/** Integer percentage shown next to the ring; ? while unknown. */
const usagePercentText = computed(() =>
  usage.value?.percent == null ? "0" : usage.value.percent.toFixed(0),
);

/** 0–1 clamped ring fill fraction. */
const usageFraction = computed(() => {
  const percent = usage.value?.percent;
  if (percent == null) return 0;
  return Math.min(1, Math.max(0, percent / 100));
});

const ringDashOffset = computed(
  () => RING_CIRCUMFERENCE * (1 - usageFraction.value),
);

const usageToneClass = computed(() => {
  const percent = usage.value?.percent;
  return percent != null && percent >= 80
    ? "text-destructive"
    : "text-muted-foreground";
});

const usedTokensText = computed(() =>
  usage.value?.tokens == null
    ? t("project.composer.contextUsage.unknown")
    : usage.value.tokens.toLocaleString("en-US"),
);

const contextWindowText = computed(() =>
  usage.value
    ? formatTokenCount(usage.value.contextWindow)
    : t("project.composer.contextUsage.unknown"),
);

const precisePercentText = computed(() =>
  usage.value?.percent == null
    ? t("project.composer.contextUsage.unknown")
    : `${usage.value.percent.toFixed(2)}%`,
);

const costText = computed(() =>
  usage.value
    ? `$${usage.value.cost.toFixed(4)}`
    : t("project.composer.contextUsage.unknown"),
);

const cacheHitRateText = computed(() =>
  usage.value?.cacheHitRate == null
    ? t("project.composer.contextUsage.unknown")
    : `${usage.value.cacheHitRate.toFixed(1)}%`,
);

async function compactContext(): Promise<void> {
  if (!activeSession.value || isCompacting.value) return;
  isCompacting.value = true;
  try {
    await sessionStore.compactContext();
  } catch (error) {
    handleError(error, {
      id: "context-compaction-manual",
      title: t("errors.contextCompaction.title"),
      description: t("errors.contextCompaction.description"),
    });
  } finally {
    isCompacting.value = false;
  }
}
</script>

<template>
  <Popover>
    <PopoverTrigger as-child>
      <Button
        data-slot="context-usage-trigger"
        type="button"
        variant="ghost"
        size="sm"
        :class="usageToneClass"
        :aria-label="t('project.composer.contextUsage.label')"
      >
        <svg
          data-icon="inline-start"
          viewBox="0 0 20 20"
          fill="none"
          :class="usageToneClass"
          aria-hidden="true"
        >
          <circle
            class="stroke-current opacity-25"
            cx="10"
            cy="10"
            :r="RING_RADIUS"
            stroke-width="2"
          />
          <circle
            v-if="usageFraction > 0"
            class="stroke-current transition-[stroke-dashoffset] duration-500"
            cx="10"
            cy="10"
            :r="RING_RADIUS"
            stroke-width="2"
            stroke-linecap="round"
            :stroke-dasharray="RING_CIRCUMFERENCE"
            :stroke-dashoffset="ringDashOffset"
            transform="rotate(-90 10 10)"
          />
        </svg>
        <span class="tabular-nums">{{ usagePercentText }}%</span>
      </Button>
    </PopoverTrigger>

    <PopoverContent side="top" align="start" class="w-64 gap-2">
      <span class="text-sm font-medium">
        {{ t("project.composer.contextUsage.label") }}
      </span>
      <dl class="flex flex-col gap-1.5 text-sm">
        <div
          v-for="row in [
            {
              label: t('project.composer.contextUsage.usedTokens'),
              value: usedTokensText,
            },
            {
              label: t('project.composer.contextUsage.contextWindow'),
              value: contextWindowText,
            },
            {
              label: t('project.composer.contextUsage.utilization'),
              value: precisePercentText,
            },
            {
              label: t('project.composer.contextUsage.cost'),
              value: costText,
            },
          ]"
          :key="row.label"
          class="flex items-baseline justify-between gap-4"
        >
          <dt class="text-muted-foreground">{{ row.label }}</dt>
          <dd class="font-medium tabular-nums">{{ row.value }}</dd>
        </div>
        <div
          v-if="usage?.cacheHitRate != null"
          class="flex items-baseline justify-between gap-4"
        >
          <dt class="text-muted-foreground">
            {{ t("project.composer.contextUsage.cacheHitRate") }}
          </dt>
          <dd class="font-medium tabular-nums">{{ cacheHitRateText }}</dd>
        </div>
      </dl>
      <Separator />
      <Button
        data-testid="compact-context-button"
        type="button"
        variant="outline"
        size="sm"
        :disabled="!activeSession || isCompacting"
        @click="compactContext"
      >
        <Spinner v-if="isCompacting" data-icon="inline-start" />
        {{
          isCompacting
            ? t("project.composer.contextUsage.compacting")
            : t("project.composer.contextUsage.compactNow")
        }}
      </Button>
    </PopoverContent>
  </Popover>
</template>
