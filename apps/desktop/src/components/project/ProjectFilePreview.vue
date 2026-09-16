<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  onBeforeUnmount,
  ref,
  useId,
  useTemplateRef,
  watch,
} from "vue";
import { useI18n } from "vue-i18n";
import { useElementSize, useEventListener } from "@vueuse/core";
import { getMarkdown, parseMarkdownToStructure } from "markstream-vue";
import {
  ExternalLink,
  FileQuestion,
  FileWarning,
  Plus,
  Send,
  SquareTerminal,
} from "@lucide/vue";
import { handleError } from "@/app/errors/errorHandler";
import CodeBlock from "@/components/markdown/CodeBlock.vue";
import MarkdownContent from "@/components/markdown/MarkdownContent.vue";
import ProjectHtmlPreview from "./ProjectHtmlPreview.vue";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useContentTabsStore } from "@/stores/contentTabs";
import { useAppearanceStore } from "@/stores/appearance";
import { useFileToSession } from "@/composables/useFileToSession";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { fileLanguage } from "@/lib/fileLanguage";
import {
  fileName as pathBaseName,
  fileTargetPath,
} from "@/lib/filePreviewTarget";
import { filePreviewSelection } from "@/lib/filePreviewSelection";
import type { AttachmentSelection } from "@/shared/attachments";
import type { ProjectFilePreview } from "@/shared/projectFiles";
import type { FileContentTab } from "@/stores/contentTabs";

const ProjectPdfPreview = defineAsyncComponent(
  () => import("./ProjectPdfPreview.vue"),
);
const ProjectOfficePreview = defineAsyncComponent(
  () => import("./ProjectOfficePreview.vue"),
);

const props = withDefaults(
  defineProps<{ file: FileContentTab; active?: boolean }>(),
  { active: true },
);
const { t, locale } = useI18n();
// Presented files live outside the project, so the project-entry actions
// (open with the default app, reveal, send to a session) are not available.
const projectTarget = computed(() =>
  props.file.source === "project" ? props.file : null,
);
const filePath = computed(() => fileTargetPath(props.file));
const preview = ref<ProjectFilePreview>();
const viewMode = ref<"code" | "rendered">("rendered");
const renderSwitchId = useId();
const invertSwitchId = useId();
const isMarkdown = computed(
  () =>
    preview.value?.kind === "text" &&
    fileLanguage(filePath.value) === "markdown",
);
const isHtml = computed(
  () =>
    preview.value?.kind === "text" && fileLanguage(filePath.value) === "html",
);
const canRenderText = computed(() => isMarkdown.value || isHtml.value);
const rendered = computed(
  () => canRenderText.value && viewMode.value === "rendered",
);
const renderedHtml = computed(
  () => isHtml.value && viewMode.value === "rendered",
);
const markdownNodes = computed(() =>
  isMarkdown.value && rendered.value && preview.value?.kind === "text"
    ? parseMarkdownToStructure(
        preview.value.text,
        getMarkdown("pine-preview"),
        {
          final: true,
          includeSourceMap: true,
        },
      )
    : undefined,
);
const content = useTemplateRef<HTMLDivElement>("content");
const selectedRange = ref<AttachmentSelection>();
const menuOpen = ref(false);
const menuSelection = ref<AttachmentSelection>();

function updateSelection(): void {
  if (preview.value?.kind !== "text") return;
  if (menuOpen.value) return;
  selectedRange.value =
    props.active && content.value
      ? filePreviewSelection(
          content.value,
          preview.value.text,
          markdownNodes.value,
        )
      : undefined;
}

function updateMenu(open: boolean): void {
  if (open) {
    updateSelection();
    menuSelection.value = selectedRange.value;
  }
  menuOpen.value = open;
  if (!open) updateSelection();
}

useEventListener(document, "selectionchange", updateSelection);
watch(viewMode, () => {
  selectedRange.value = undefined;
  menuSelection.value = undefined;
});
const tabsStore = useContentTabsStore();
const appearanceStore = useAppearanceStore();
const sessionTabs = computed(() =>
  tabsStore.tabs.filter((tab) => tab.kind === "session"),
);
const { isSending, sendFile, sendFileToNewSession } = useFileToSession();
const failed = ref(false);
const revision = ref(0);
const video = useTemplateRef<HTMLVideoElement>("video");
const fileName = computed(() => pathBaseName(filePath.value));
const mediaDetails = ref<{
  width: number;
  height: number;
  duration?: number;
}>();
const imageViewport = useTemplateRef<HTMLDivElement>("imageViewport");
const { width: imageViewportWidth, height: imageViewportHeight } =
  useElementSize(imageViewport);
const pageCount = ref<number>();
const previewInverted = ref(false);
const previewZoom = ref([100]);
const appliedZoom = ref(100);
const renderedZoom = ref(100);
const canInvertPreview = computed(
  () => preview.value?.kind === "pdf" || preview.value?.kind === "office",
);
const canZoomPreview = computed(
  () =>
    canInvertPreview.value ||
    renderedHtml.value ||
    preview.value?.kind === "image",
);
const zoom = computed(() => previewZoom.value[0] ?? 100);
const imageSize = computed(() => {
  const width = mediaDetails.value?.width ?? 0;
  const height = mediaDetails.value?.height ?? 0;
  if (!width || !height) return undefined;
  const fit = Math.min(
    1,
    imageViewportWidth.value > 48 ? (imageViewportWidth.value - 48) / width : 1,
    imageViewportHeight.value > 48
      ? (imageViewportHeight.value - 48) / height
      : 1,
  );
  const scale = (fit * appliedZoom.value) / 100;
  return { width: `${width * scale}px`, height: `${height * scale}px` };
});
let zoomFrame: number | undefined;
let zoomCommitTimer: ReturnType<typeof setTimeout> | undefined;
let pendingZoom = 100;
const fileType = computed(() => {
  const name = fileName.value;
  const extension = name.includes(".") ? name.split(".").at(-1) : undefined;
  return (
    extension?.toUpperCase() ||
    t(`project.preview.${preview.value?.kind === "text" ? "text" : "file"}`)
  );
});
const fileSize = computed(() => {
  const size = preview.value?.size ?? 0;
  const unit =
    size >= 1024 ** 3 ? 3 : size >= 1024 ** 2 ? 2 : size >= 1024 ? 1 : 0;
  return `${new Intl.NumberFormat(locale.value, { maximumFractionDigits: unit ? 1 : 0 }).format(size / 1024 ** unit)} ${["B", "KB", "MB", "GB"][unit]}`;
});
const lineCount = computed(() =>
  preview.value?.kind === "text"
    ? preview.value.text.split(/\r\n|\r|\n/).length
    : 0,
);
const duration = computed(() => {
  const seconds = mediaDetails.value?.duration;
  if (seconds === undefined || !Number.isFinite(seconds)) return "";
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
});

function imageLoaded(event: Event): void {
  const image = event.currentTarget as HTMLImageElement;
  mediaDetails.value = {
    width: image.naturalWidth,
    height: image.naturalHeight,
  };
}

function videoLoaded(): void {
  if (!video.value) return;
  mediaDetails.value = {
    width: video.value.videoWidth,
    height: video.value.videoHeight,
    duration: video.value.duration,
  };
}

function scheduleZoom(value: number): void {
  pendingZoom = value;
  if (zoomFrame !== undefined) return;
  zoomFrame = requestAnimationFrame(() => {
    appliedZoom.value = pendingZoom;
    zoomFrame = undefined;
  });
}

function commitZoom(value: number[]): void {
  if (zoomCommitTimer) clearTimeout(zoomCommitTimer);
  const committed = value[0] ?? 100;
  pendingZoom = committed;
  if (zoomFrame !== undefined) {
    cancelAnimationFrame(zoomFrame);
    zoomFrame = undefined;
  }
  appliedZoom.value = committed;
  renderedZoom.value = committed;
}

function handlePreviewWheel(event: WheelEvent): void {
  if (!canZoomPreview.value || !(event.ctrlKey || event.metaKey)) return;
  event.preventDefault();
  const next = Math.max(50, Math.min(200, zoom.value - event.deltaY * 0.5));
  previewZoom.value = [Math.round(next)];
  scheduleZoom(Math.round(next));
  if (zoomCommitTimer) clearTimeout(zoomCommitTimer);
  zoomCommitTimer = setTimeout(() => commitZoom(previewZoom.value), 180);
}

async function openWithDefaultApplication(): Promise<void> {
  const target = projectTarget.value;
  if (!target) return;
  try {
    await window.pine.operateProjectFile({
      action: "open",
      target: {
        folderId: target.folderId,
        relativePath: target.relativePath,
      },
    });
  } catch (error) {
    handleError(error, {
      id: "project.preview.open-default",
      title: t("project.preview.openDefaultFailed"),
    });
  }
}

watch(
  () => [props.file.id, revision.value] as const,
  async (_value, _previous, onCleanup) => {
    let active = true;
    onCleanup(() => {
      active = false;
    });
    preview.value = undefined;
    viewMode.value = "rendered";
    selectedRange.value = undefined;
    menuSelection.value = undefined;
    mediaDetails.value = undefined;
    pageCount.value = undefined;
    previewInverted.value = false;
    previewZoom.value = [100];
    if (zoomCommitTimer) clearTimeout(zoomCommitTimer);
    appliedZoom.value = 100;
    renderedZoom.value = 100;
    pendingZoom = 100;
    failed.value = false;
    try {
      const file = props.file;
      const result =
        file.source === "project"
          ? await window.pine.readProjectFilePreview({
              projectId: file.projectId,
              folderId: file.folderId,
              relativePath: file.relativePath,
            })
          : await window.pine.readPresentedFilePreview({ path: file.path });
      if (active) {
        preview.value = result;
        previewInverted.value =
          (result.kind === "pdf" || result.kind === "office") &&
          appearanceStore.colorScheme === "dark";
      }
    } catch {
      if (active) failed.value = true;
    }
  },
  { immediate: true },
);

watch(
  () => props.active,
  (active) => {
    if (!active) video.value?.pause();
    if (!active) selectedRange.value = undefined;
  },
);
watch(
  () => appearanceStore.colorScheme,
  (colorScheme) => {
    if (canInvertPreview.value) previewInverted.value = colorScheme === "dark";
  },
);
watch(zoom, scheduleZoom);
onBeforeUnmount(() => {
  video.value?.pause();
  if (zoomFrame !== undefined) cancelAnimationFrame(zoomFrame);
  if (zoomCommitTimer) clearTimeout(zoomCommitTimer);
});
</script>

<template>
  <section
    class="flex h-full min-h-0 flex-col"
    :aria-label="fileName"
    @wheel.capture="handlePreviewWheel"
  >
    <Empty v-if="failed" class="flex-1" role="alert">
      <EmptyHeader>
        <EmptyMedia variant="icon"><FileWarning /></EmptyMedia>
        <EmptyTitle>{{ t("project.preview.failedTitle") }}</EmptyTitle>
        <EmptyDescription>{{
          t("project.preview.failedDescription")
        }}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent
        ><Button variant="outline" @click="revision += 1">{{
          t("project.preview.retry")
        }}</Button></EmptyContent
      >
    </Empty>
    <div
      v-else-if="!preview"
      class="flex flex-1 flex-col gap-3 p-6"
      role="status"
      :aria-label="t('project.files.loading')"
    >
      <Skeleton class="h-4 w-3/4" /><Skeleton class="h-4 w-1/2" /><Skeleton
        class="h-4 w-2/3"
      />
    </div>
    <Empty v-else-if="preview.kind === 'unsupported'" class="flex-1">
      <EmptyHeader>
        <EmptyMedia variant="icon"><FileQuestion /></EmptyMedia>
        <EmptyTitle>{{ t("project.preview.unsupportedTitle") }}</EmptyTitle>
        <EmptyDescription>{{
          t(
            preview.reason === "too-large"
              ? "project.preview.tooLarge"
              : "project.preview.unsupportedDescription",
          )
        }}</EmptyDescription>
      </EmptyHeader>
    </Empty>
    <ProjectHtmlPreview
      v-else-if="preview.kind === 'text' && renderedHtml"
      class="min-h-0 flex-1"
      :source="preview.text"
      :title="fileName"
      :zoom="appliedZoom"
      @zoom-wheel="handlePreviewWheel"
    />
    <ScrollArea
      v-else-if="preview.kind === 'text'"
      class="min-h-0 min-w-0 flex-1 [&_[data-slot=scroll-area-viewport]]:scroll-fade"
    >
      <div
        ref="content"
        class="min-w-0 px-4 pb-4"
        @pointerup="updateSelection"
        @keyup="updateSelection"
      >
        <MarkdownContent
          v-if="rendered"
          class="mx-auto w-full max-w-[var(--session-content-max-width)] py-4"
          :source="preview.text"
          :nodes="markdownNodes"
          final
        />
        <CodeBlock
          v-else
          layout="preview"
          :node="{
            type: 'code_block',
            code: preview.text,
            language:
              preview.text.length > 200_000 ? 'text' : fileLanguage(filePath),
          }"
        />
      </div>
    </ScrollArea>
    <ProjectPdfPreview
      v-else-if="preview.kind === 'pdf'"
      class="min-h-0 flex-1"
      :source="preview.url"
      :inverted="previewInverted"
      :zoom="appliedZoom"
      :render-zoom="renderedZoom"
      :selection-label="t('project.preview.selectedContent')"
      @loaded="pageCount = $event"
      @failed="failed = true"
      @selection-change="selectedRange = $event"
    />
    <ProjectOfficePreview
      v-else-if="preview.kind === 'office'"
      class="min-h-0 flex-1"
      :format="preview.format"
      :source="preview.url"
      :inverted="previewInverted"
      :zoom="appliedZoom"
      :render-zoom="renderedZoom"
      :selection-label="t('project.preview.selectedContent')"
      @failed="failed = true"
      @selection-change="selectedRange = $event"
    />
    <div
      v-else-if="preview.kind === 'image'"
      ref="imageViewport"
      data-slot="image-preview-viewport"
      class="scroll-fade min-h-0 flex-1 overflow-auto p-6"
    >
      <div class="grid min-h-full min-w-full h-max w-max place-items-center">
        <img
          :src="preview.url"
          :alt="fileName"
          class="block max-w-none shrink-0 object-contain"
          :style="imageSize"
          @load="imageLoaded"
          @error="failed = true"
        />
      </div>
    </div>
    <div
      v-else
      class="scroll-fade flex min-h-0 flex-1 items-center justify-center overflow-auto p-6"
    >
      <video
        ref="video"
        :src="preview.url"
        :aria-label="fileName"
        controls
        preload="metadata"
        class="max-h-full max-w-full rounded-lg"
        @loadedmetadata="videoLoaded"
        @error="failed = true"
      />
    </div>
    <footer
      class="mt-auto flex min-h-12 shrink-0 flex-wrap items-center gap-x-4 gap-y-1 pl-5 pr-2 py-2 text-sm text-muted-foreground"
      :title="filePath"
      :aria-label="t('project.preview.metadata')"
    >
      <template v-if="preview">
        <span>{{ fileType }}</span>
        <span>{{ fileSize }}</span>
        <template v-if="preview.kind === 'text'">
          <span>{{ preview.encoding }}</span>
          <span>{{ t("project.preview.lines", { count: lineCount }) }}</span>
        </template>
        <span v-if="mediaDetails"
          >{{ mediaDetails.width }} × {{ mediaDetails.height }}</span
        >
        <span v-if="duration">{{ duration }}</span>
        <span v-if="pageCount">{{
          t("project.preview.pages", { count: pageCount })
        }}</span>
      </template>
      <Skeleton v-else-if="!failed" class="h-3 w-40" />
      <div v-if="canZoomPreview" class="flex items-center gap-2 pr-2">
        <Slider
          v-model="previewZoom"
          class="w-28"
          :min="50"
          :max="200"
          :step="10"
          :aria-label="t('project.preview.zoom')"
          :title="t('project.preview.zoomValue', { value: zoom })"
          @value-commit="commitZoom"
        />
        <span class="w-10 text-right tabular-nums">{{ zoom }}%</span>
      </div>
      <div v-if="canInvertPreview" class="flex items-center gap-2">
        <Switch
          :id="invertSwitchId"
          size="sm"
          :model-value="previewInverted"
          @update:model-value="previewInverted = $event"
        />
        <Label :for="invertSwitchId">{{
          t("project.preview.invertColors")
        }}</Label>
      </div>
      <div v-if="canRenderText" class="flex items-center gap-2">
        <Switch
          :id="renderSwitchId"
          size="sm"
          :model-value="rendered"
          @update:model-value="viewMode = $event ? 'rendered' : 'code'"
        />
        <Label :for="renderSwitchId">{{ t("project.preview.rendered") }}</Label>
      </div>
      <div v-if="projectTarget" class="ml-auto flex items-center gap-3">
        <Button
          v-if="preview"
          data-action="open-default"
          variant="ghost"
          size="sm"
          @click="openWithDefaultApplication"
        >
          <ExternalLink data-icon="inline-start" />
          {{ t("project.preview.openDefault") }}
        </Button>
        <DropdownMenu :open="menuOpen" @update:open="updateMenu">
          <DropdownMenuTrigger as-child>
            <Button
              variant="outline"
              :disabled="isSending"
              @pointerdown.prevent="updateSelection"
            >
              <Send data-icon="inline-start" />{{
                t(
                  selectedRange
                    ? "project.preview.sendSelectionToTab"
                    : "project.preview.sendToTab",
                )
              }}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="top"
            align="end"
            class="w-64"
            @close-auto-focus.prevent
          >
            <DropdownMenuGroup>
              <DropdownMenuItem
                v-for="tab in sessionTabs"
                :key="tab.id"
                @select="sendFile(projectTarget, tab.id, menuSelection)"
              >
                <SquareTerminal />
                <span class="truncate">{{
                  "label" in tab && tab.label
                    ? tab.label
                    : t("project.contentTabs.newSession")
                }}</span>
              </DropdownMenuItem>
              <DropdownMenuItem v-if="!sessionTabs.length" disabled>{{
                t("project.preview.noSessionTabs")
              }}</DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem
                data-action="new-session"
                @select="sendFileToNewSession(projectTarget, menuSelection)"
              >
                <Plus />{{ t("project.preview.newSession") }}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </footer>
  </section>
</template>
