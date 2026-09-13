<script setup lang="ts">
import {
  AlertCircleIcon,
  CheckIcon,
  CircleHelpIcon,
  ShieldBanIcon,
} from "@lucide/vue";
import { computed, ref, type Component, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import type { PineToolCall } from "@/shared/sessions";
import ProjectToolCallDialog from "./ProjectToolCallDialog.vue";
import {
  isDeniedTool,
  isRunningTool,
  TOOL_KIND_ICON,
  toolKind,
} from "./toolKinds";

const props = defineProps<{
  toolCall: PineToolCall;
  /** Nested rows repeat the folded header's kind icons, so they fall back
   * to a plain check once the call succeeds. */
  nested?: boolean;
  /** The call is being held by the auto-reviewer (auto-approve). */
  reviewing?: boolean;
  /** The call is waiting for the user's decision (Let Me Review mode). */
  awaitingApproval?: boolean;
}>();
const { t } = useI18n();
const MAX_WEB_PAGE_TITLE_LENGTH = 24;

function normalizedToolName(name: string): string {
  return name.toLowerCase().split(/[.:/]/).at(-1) ?? name;
}

function isAskUserQuestionTool(name: string): boolean {
  return ["ask_user_question", "ask_user_questions"].includes(
    normalizedToolName(name),
  );
}

const kindIcon: Component = isAskUserQuestionTool(props.toolCall.name)
  ? CircleHelpIcon
  : TOOL_KIND_ICON[toolKind(props.toolCall.name)];

const isRunning = computed(() => isRunningTool(props.toolCall));
const isDenied = computed(() => isDeniedTool(props.toolCall));

function inputRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function firstString(
  record: Record<string, unknown>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function compactInline(value: string, maxLength = 80): string {
  const normalized = value.replaceAll(/\s+/g, " ").trim();
  const characters = Array.from(normalized);
  return characters.length > maxLength
    ? `${characters.slice(0, maxLength - 1).join("")}…`
    : normalized;
}

function filename(value: string): string {
  return value.split(/[\\/]/).filter(Boolean).at(-1) ?? value;
}

function nonEmptyLineCount(value: unknown): number {
  if (typeof value !== "string" || !value.trim()) return 0;
  return value.split("\n").filter((line) => line.trim()).length;
}

function firstKey(record: Record<string, unknown>, keys: readonly string[]) {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

function stringArray(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function webUrlLabel(value: string): string {
  try {
    const url = new URL(value);
    const path = url.pathname === "/" ? "" : url.pathname;
    return compactInline(`${url.protocol}//${url.host}${path}`, 72);
  } catch {
    return t("project.transcript.toolParams.invalidUrl");
  }
}

function toolOutputText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const text = value
      .map((part) => toolOutputText(part))
      .filter((part): part is string => part !== undefined)
      .join("\n");
    return text || undefined;
  }
  const record = inputRecord(value);
  if (typeof record.text === "string") return record.text;
  if (record.content !== undefined) return toolOutputText(record.content);
  return undefined;
}

function questionnaireAnswerCount(output: unknown): number {
  const answers = inputRecord(inputRecord(output).details).answers;
  return Array.isArray(answers) ? answers.length : 0;
}

function tinyFishResponseFromOutput(output: unknown): Record<string, unknown> {
  const direct = inputRecord(output);
  if (Array.isArray(direct.results)) return direct;

  const text = toolOutputText(output);
  if (!text) return {};
  const startTag = "<tinyfish_web_data>";
  const endTag = "</tinyfish_web_data>";
  const start = text.indexOf(startTag);
  const jsonStart = start >= 0 ? start + startTag.length : 0;
  const end = text.indexOf(endTag, jsonStart);
  const serialized = text.slice(jsonStart, end >= 0 ? end : undefined).trim();
  try {
    return inputRecord(JSON.parse(serialized));
  } catch {
    return {};
  }
}

function pageTitleFromTinyFishText(output: unknown): string | undefined {
  const text = toolOutputText(output);
  if (!text) return undefined;
  const titleMatch = text.match(/"title"\s*:\s*"((?:\\.|[^"\\])*)"/u);
  if (!titleMatch) return undefined;
  try {
    const title = JSON.parse(`"${titleMatch[1]}"`) as unknown;
    return typeof title === "string" && title.trim()
      ? compactInline(title, MAX_WEB_PAGE_TITLE_LENGTH)
      : undefined;
  } catch {
    return undefined;
  }
}

function webFetchPageTitle(output: unknown): string | undefined {
  const details = inputRecord(inputRecord(output).details);
  const detailTitle = firstString(details, ["pageTitle"]);
  if (detailTitle) {
    return compactInline(detailTitle, MAX_WEB_PAGE_TITLE_LENGTH);
  }

  const response = tinyFishResponseFromOutput(output);
  const firstResult = Array.isArray(response.results)
    ? response.results.find(
        (result): result is Record<string, unknown> =>
          typeof result === "object" &&
          result !== null &&
          !Array.isArray(result),
      )
    : undefined;
  const title = firstResult && firstString(firstResult, ["title"]);
  return title
    ? compactInline(title, MAX_WEB_PAGE_TITLE_LENGTH)
    : pageTitleFromTinyFishText(output);
}

function webFetchFaviconDataUrl(output: unknown): string | undefined {
  const details = inputRecord(inputRecord(output).details);
  const faviconDataUrl = firstString(details, ["faviconDataUrl"]);
  return faviconDataUrl &&
    faviconDataUrl.length <= 64 * 1024 &&
    /^data:image\/(?:gif|jpeg|png|webp|x-icon|vnd\.microsoft\.icon);base64,[\w+/]*={0,2}$/u.test(
      faviconDataUrl,
    )
    ? faviconDataUrl
    : undefined;
}

function formatRecency(minutes: number): string {
  const totalMinutes = Number.isFinite(minutes)
    ? Math.max(0, Math.round(minutes))
    : 0;
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const remainingMinutes = totalMinutes % 60;
  const parts: string[] = [];

  if (days > 0) {
    parts.push(
      t("project.transcript.toolParams.searchRecencyUnits.days", {
        count: days,
      }),
    );
  }
  if (hours > 0) {
    parts.push(
      t("project.transcript.toolParams.searchRecencyUnits.hours", {
        count: hours,
      }),
    );
  }
  if (remainingMinutes > 0 || parts.length === 0) {
    parts.push(
      t("project.transcript.toolParams.searchRecencyUnits.minutes", {
        count: remainingMinutes,
      }),
    );
  }

  return t("project.transcript.toolParams.searchRecency", {
    value: parts.join(" "),
  });
}

function searchDomainTypeLabel(value: string): string {
  const key = {
    web: "web",
    news: "news",
    research_paper: "researchPaper",
  }[value];
  return key ? t(`project.transcript.toolParams.searchTypes.${key}`) : value;
}

function webSearchTarget(input: Record<string, unknown>): string | undefined {
  const query = firstString(input, ["query"]);
  if (!query) return undefined;

  const mainParts: string[] = [];
  if (typeof input.recency_minutes === "number") {
    mainParts.push(formatRecency(input.recency_minutes));
  }
  mainParts.push(query);

  const qualifiers: string[] = [];
  const domainType = firstString(input, ["domain_type"]);
  if (domainType) {
    mainParts.push(
      t("project.transcript.toolParams.searchDomainTypeSuffix", {
        value: searchDomainTypeLabel(domainType),
      }),
    );
  }
  const includedDomains = stringArray(input, "include_domains");
  if (includedDomains.length > 0) {
    qualifiers.push(
      t("project.transcript.toolParams.searchIncludedDomain", {
        value: includedDomains[0],
      }),
    );
    if (includedDomains.length > 1) {
      qualifiers.push(
        t("project.transcript.toolParams.searchMoreSites", {
          count: includedDomains.length - 1,
        }),
      );
    }
  }
  if (typeof input.page === "number" && input.page > 0) {
    qualifiers.push(
      t("project.transcript.toolParams.searchPage", {
        value: Math.round(input.page),
      }),
    );
  }
  return compactInline([mainParts.join(" "), ...qualifiers].join(" · "), 120);
}

function webFetchTarget(
  input: Record<string, unknown>,
  output: unknown,
): string | undefined {
  const urls = stringArray(input, "urls");
  if (urls.length === 0) return undefined;

  const firstUrl = webFetchPageTitle(output) ?? webUrlLabel(urls[0]);
  const target =
    urls.length > 1
      ? `${firstUrl} ${t("project.transcript.toolParams.fetchMoreUrls", {
          count: urls.length - 1,
        })}`
      : firstUrl;
  const qualifiers: string[] = [];
  const highlights = input.highlights;
  if (typeof highlights === "object" && highlights !== null) {
    const highlightQuery = firstString(highlights as Record<string, unknown>, [
      "query",
    ]);
    if (highlightQuery) {
      qualifiers.push(
        t("project.transcript.toolParams.fetchHighlights", {
          value: compactInline(highlightQuery, 48),
        }),
      );
    }
  }
  return compactInline(
    qualifiers.length > 0 ? `${target} · ${qualifiers.join(" · ")}` : target,
    120,
  );
}

/**
 * Mirrors read's line-window semantics: offset-only means "from this line
 * onward", while a supplied limit makes the inclusive end line knowable.
 */
function readRangeSuffix(input: Record<string, unknown>): string {
  const offset = input.offset;
  const limit = input.limit;
  if (typeof offset !== "number" && typeof limit !== "number") return "";
  const start =
    typeof offset === "number" ? Math.max(1, Math.round(offset)) : 1;
  const end =
    typeof limit === "number" && limit > 0
      ? start + Math.round(limit) - 1
      : undefined;
  return end === undefined ? `:${start}` : `:${start}-${end}`;
}

/** Per-hunk tally of touched lines (streaming-safe). */
function editDiff(
  input: Record<string, unknown>,
): { added: number; removed: number } | undefined {
  const edits = input.edits;
  if (!Array.isArray(edits)) return undefined;
  let added = 0;
  let removed = 0;
  for (const edit of edits) {
    if (typeof edit !== "object" || edit === null) continue;
    const record = edit as Record<string, unknown>;
    added += nonEmptyLineCount(
      firstKey(record, ["newText", "newStr", "new_string"]),
    );
    removed += nonEmptyLineCount(
      firstKey(record, ["oldText", "oldStr", "old_string"]),
    );
  }
  return added || removed ? { added, removed } : undefined;
}

const editDiffCount = computed(() =>
  toolKind(props.toolCall.name) === "edit"
    ? editDiff(inputRecord(props.toolCall.input))
    : undefined,
);

// The write tool streams its `content` argument as the model generates it, so
// counting the newlines already in the argument shows a live "lines written"
// progress count that climbs as the file is composed.
const writeLineCount = computed(() => {
  if (toolKind(props.toolCall.name) !== "write") return undefined;
  const content = inputRecord(props.toolCall.input).content;
  return typeof content === "string" && content
    ? content.split("\n").length
    : undefined;
});

const presentation = computed(() => {
  const kind = toolKind(props.toolCall.name);
  const input = inputRecord(props.toolCall.input);
  const description = firstString(input, ["description", "summary"]);
  const path = firstString(input, ["path", "filePath", "file_path"]);
  const command = firstString(input, ["command", "cmd"]);
  const query = firstString(input, ["pattern", "query", "search"]);
  const purpose =
    kind === "search" || kind === "fetch"
      ? firstString(input, ["purpose"])
      : undefined;
  const compactPurpose = purpose ? compactInline(purpose, 96) : undefined;
  const faviconDataUrl =
    kind === "fetch"
      ? webFetchFaviconDataUrl(props.toolCall.output)
      : undefined;
  const suffix = kind === "read" ? readRangeSuffix(input) : "";
  const target =
    kind === "bash" && command
      ? compactInline(command)
      : kind === "search" && query
        ? (webSearchTarget(input) ?? compactInline(query))
        : kind === "fetch"
          ? (webFetchTarget(input, props.toolCall.output) ??
            props.toolCall.name)
          : path
            ? `${filename(path)}${suffix}`
            : props.toolCall.name;
  // Review holds replace the tense label entirely: the reader must see that
  // the call is gated, not that it is running.
  const state = isDenied.value
    ? "denied"
    : props.reviewing
      ? "reviewing"
      : props.awaitingApproval
        ? "awaiting"
        : isRunning.value
          ? "running"
          : props.toolCall.status === "error"
            ? "error"
            : "complete";
  if (isAskUserQuestionTool(props.toolCall.name)) {
    const summary =
      state === "complete"
        ? t("project.transcript.tools.questionnaire.complete", {
            count: questionnaireAnswerCount(props.toolCall.output),
          })
        : state === "error" || state === "denied"
          ? t("project.transcript.tools.questionnaire.error")
          : t("project.transcript.tools.questionnaire.running");
    return {
      before: summary,
      operation: undefined,
      separator: "",
      target: "",
      purpose: undefined,
      faviconDataUrl: undefined,
      after: "",
    };
  }
  if (state === "reviewing" || state === "awaiting" || state === "denied") {
    // The state name differs from its i18n key ("awaiting" →
    // "awaitingApproval"), so map it explicitly.
    const stateKey = state === "awaiting" ? "awaitingApproval" : state;
    return {
      // The gate label carries its own trailing separator so the target
      // reads as one sentence, e.g. "正在审核 读取文档目录：ls ~/Documents".
      before: t(`project.transcript.tools.${stateKey}`, {
        tool:
          kind === "bash" && description
            ? compactInline(description)
            : t(`project.transcript.toolKinds.${kind}`),
      }),
      operation: undefined,
      separator: "",
      target,
      purpose: compactPurpose,
      faviconDataUrl,
      after: "",
    };
  }
  const key = `project.transcript.tools.${kind}.${state}`;
  return {
    before: t(`${key}.before`),
    // A bash call shows an imperative operation summary before the command
    // when the agent supplied one, e.g. "Ran {description}: {command}".
    operation:
      kind === "bash" && description && command ? `${description}` : undefined,
    separator: t("project.transcript.tools.operationSeparator"),
    target,
    purpose: compactPurpose,
    faviconDataUrl,
    after: t(`${key}.after`),
  };
});

const faviconError = ref(false);
watch(
  () => presentation.value.faviconDataUrl,
  () => {
    faviconError.value = false;
  },
);

const isActive = computed(
  () =>
    !isDenied.value &&
    (props.reviewing || props.awaitingApproval || isRunning.value),
);

// Gate calls get distinct shimmer tones: amber while waiting on the user
// ("needs your attention"), blue while the auto-reviewer deliberates — both
// distinct from the neutral running shimmer.
const shimmerClass = computed(() =>
  props.awaitingApproval
    ? "shimmer shimmer-color-warning"
    : props.reviewing
      ? "shimmer shimmer-color-info"
      : "shimmer",
);

const fullText = computed(() => {
  const before = presentation.value.before;
  const operation = presentation.value.operation;
  const separator = presentation.value.separator;
  const target = presentation.value.target;
  const purpose = presentation.value.purpose;
  const after = presentation.value.after;
  return `${before}${operation ?? ""}${operation ? separator : ""}${target}${purpose ? ` ${purpose}` : ""}${after}`;
});
</script>

<template>
  <ProjectToolCallDialog
    v-slot="{ open }"
    :tool-call="toolCall"
    :reviewing="reviewing"
    :awaiting-approval="awaitingApproval"
  >
    <!-- Offset standalone hit-area padding so the transcript's 12px gap is
         measured between content rows. Nested rows already use 4px + 8px. -->
    <Marker
      as="button"
      type="button"
      class="-mx-1.5 w-[calc(100%+0.75rem)] cursor-pointer rounded-md px-1.5 py-1 transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      :class="!nested && '-my-1'"
      :aria-live="isActive ? 'polite' : undefined"
      @click="open"
    >
      <!-- While running (or held by a gate) the label shimmers instead of
         showing a spinner; on success the kind icon matches the folded group
         header, and failures stay recognizable through the destructive alert
         tint. -->
      <MarkerIcon>
        <ShieldBanIcon v-if="isDenied" class="text-warning" />
        <AlertCircleIcon
          v-else-if="toolCall.status === 'error'"
          class="text-destructive"
        />
        <CheckIcon v-else-if="props.nested" />
        <component :is="kindIcon" v-else />
      </MarkerIcon>
      <MarkerContent
        class="truncate"
        :class="
          isDenied
            ? 'text-warning'
            : isActive
              ? shimmerClass
              : toolCall.status === 'error' && 'text-destructive'
        "
        :title="fullText"
      >
        <span v-if="presentation.before">{{ presentation.before }}</span>
        <span v-if="presentation.operation" class="font-medium"
          >{{ presentation.operation }}{{ presentation.separator }}</span
        >
        <img
          v-if="presentation.faviconDataUrl && !faviconError"
          data-tool-favicon
          aria-hidden="true"
          alt=""
          :src="presentation.faviconDataUrl"
          class="mx-0.5 inline-block size-4 shrink-0 rounded-sm object-contain align-[-0.2em]"
          @error="faviconError = true"
        />
        <code
          v-if="presentation.target"
          class="font-mono text-sm font-normal"
          >{{ presentation.target }}</code
        ><span
          v-if="presentation.purpose"
          data-tool-purpose
          class="ml-1 font-semibold"
          >{{ presentation.purpose }}</span
        ><span
          v-if="editDiffCount && !isDenied"
          data-edit-diff
          class="ml-1 inline-flex gap-1"
          ><span
            class="font-mono text-xs font-normal text-emerald-600 dark:text-emerald-400"
            >+{{ editDiffCount.added }}</span
          >
          <span class="font-mono text-xs font-normal text-destructive"
            >-{{ editDiffCount.removed }}</span
          ></span
        ><span
          v-if="writeLineCount && !isDenied"
          data-write-lines
          class="ml-1 font-mono text-sm font-normal text-emerald-600 dark:text-emerald-400"
          >{{
            t("project.transcript.tools.writeLines", { count: writeLineCount })
          }}</span
        ><span v-if="presentation.after">{{ presentation.after }}</span>
      </MarkerContent>
    </Marker>
  </ProjectToolCallDialog>
</template>
