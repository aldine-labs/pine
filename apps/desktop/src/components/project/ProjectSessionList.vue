<script setup lang="ts">
import { Download, Pencil, Plus, Search, Trash2 } from "@lucide/vue";
import { useEventListener } from "@vueuse/core";
import { storeToRefs } from "pinia";
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { handleError } from "@/app/errors/errorHandler";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
} from "@/components/ui/sidebar";
import { useContentTabNavigation } from "@/composables/useContentTabNavigation";
import { useFileToSession } from "@/composables/useFileToSession";
import { useSessionExport } from "@/composables/useSessionExport";
import { FILE_TAB_DRAG_TYPE, hasFileTabDrag } from "@/lib/contentTabDrag";
import { writeSessionDrag } from "@/lib/sessionDrag";
import type { PineSessionSummary } from "@/shared/sessions";
import { useContentTabsStore } from "@/stores/contentTabs";
import { useProjectStore } from "@/stores/project";
import { useSessionStore } from "@/stores/session";
import SessionDeleteDialog from "@/components/sessions/SessionDeleteDialog.vue";
import SessionRenameDialog from "@/components/sessions/SessionRenameDialog.vue";

const DAY_MS = 24 * 60 * 60 * 1000;

type SessionGroupKey = "pastThreeDays" | "pastWeek" | "pastMonth" | "older";

const SESSION_GROUP_WINDOWS: readonly {
  key: SessionGroupKey;
  labelKey: string;
  maxAgeMs: number;
}[] = [
  {
    key: "pastThreeDays",
    labelKey: "sessions.groupPastThreeDays",
    maxAgeMs: 3 * DAY_MS,
  },
  {
    key: "pastWeek",
    labelKey: "sessions.groupPastWeek",
    maxAgeMs: 7 * DAY_MS,
  },
  {
    key: "pastMonth",
    labelKey: "sessions.groupPastMonth",
    maxAgeMs: 30 * DAY_MS,
  },
  {
    key: "older",
    labelKey: "sessions.groupOlder",
    maxAgeMs: Number.POSITIVE_INFINITY,
  },
];

const { t } = useI18n();
const emit = defineEmits<{
  search: [];
}>();
const tabNavigation = useContentTabNavigation();
const projectStore = useProjectStore();
const sessionStore = useSessionStore();
const contentTabsStore = useContentTabsStore();
const { sendFile } = useFileToSession();
const { exportSession } = useSessionExport();
const dropSessionId = ref<string | null>(null);
useEventListener(window, "dragend", () => {
  dropSessionId.value = null;
});

function dragOverSession(event: DragEvent, session: PineSessionSummary): void {
  if (!hasFileTabDrag(event.dataTransfer)) return;
  event.preventDefault();
  event.stopPropagation();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  dropSessionId.value = session.id;
}

function leaveSession(event: DragEvent): void {
  if (
    event.relatedTarget instanceof Node &&
    (event.currentTarget as HTMLElement).contains(event.relatedTarget)
  )
    return;
  dropSessionId.value = null;
}

function dropOnSession(event: DragEvent, session: PineSessionSummary): void {
  if (!hasFileTabDrag(event.dataTransfer)) return;
  event.preventDefault();
  event.stopPropagation();
  dropSessionId.value = null;
  const tabId = event.dataTransfer?.getData(FILE_TAB_DRAG_TYPE);
  const file = contentTabsStore.tabs.find(
    (tab) => tab.id === tabId && tab.kind === "file",
  );
  // Only project files carry a drag payload, so a presented tab never lands
  // here; the guard also keeps the file reference project-shaped.
  if (file?.kind === "file" && file.source === "project") {
    void sendFile(file, session);
  }
}
const { activeSessionTab } = tabNavigation;
const { activeProject } = storeToRefs(projectStore);
const { isLoadingRecent, recentSessions } = storeToRefs(sessionStore);
const sessionPendingDelete = ref<PineSessionSummary | null>(null);
const isDeleteDialogOpen = ref(false);
const sessionPendingRename = ref<PineSessionSummary | null>(null);
const isRenameDialogOpen = ref(false);

watch(isDeleteDialogOpen, (open) => {
  if (!open) sessionPendingDelete.value = null;
});
watch(isRenameDialogOpen, (open) => {
  if (!open) sessionPendingRename.value = null;
});

// Sessions arrive sorted by `updatedAt` descending, so filtering keeps the
// original order inside every group. Boundaries use rolling windows from the
// last reload rather than calendar days.
const nowMs = ref(Date.now());

function sessionGroupKeyFor(session: PineSessionSummary): SessionGroupKey {
  const age = nowMs.value - new Date(session.updatedAt).getTime();
  return (
    SESSION_GROUP_WINDOWS.find((window) => age <= window.maxAgeMs)?.key ??
    "older"
  );
}

const sessionGroups = computed(() =>
  SESSION_GROUP_WINDOWS.map((window) => ({
    key: window.key,
    label: t(window.labelKey),
    sessions: recentSessions.value.filter(
      (session) => sessionGroupKeyFor(session) === window.key,
    ),
  })).filter((group) => group.sessions.length > 0),
);

function sessionTitle(session: PineSessionSummary): string {
  return session.name || session.preview || t("sessions.newSession");
}

async function loadRecentSessions(): Promise<void> {
  try {
    await sessionStore.loadRecent();
    nowMs.value = Date.now();
  } catch (error) {
    handleError(error, {
      id: "sessions.sidebar.load",
      title: t("errors.sessionSearch.title"),
      description: t("errors.sessionSearch.description"),
    });
  }
}

function openSession(session: PineSessionSummary): void {
  tabNavigation.openSession(session);
}

function startSessionDrag(event: DragEvent, session: PineSessionSummary): void {
  if (event.dataTransfer) writeSessionDrag(event.dataTransfer, session);
}

function requestSessionDeletion(session: PineSessionSummary): void {
  sessionPendingDelete.value = session;
  isDeleteDialogOpen.value = true;
}

function requestSessionRename(session: PineSessionSummary): void {
  sessionPendingRename.value = session;
  isRenameDialogOpen.value = true;
}

watch(
  () => {
    const project = activeProject.value;
    return project ? `${project.id}:${project.updatedAt}` : null;
  },
  (projectVersion) => {
    if (projectVersion) void loadRecentSessions();
  },
  { immediate: true },
);
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <SidebarGroup class="shrink-0">
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton @click="emit('search')">
              <Search aria-hidden="true" />
              <span>{{ t("sessions.searchAction") }}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              :is-active="activeSessionTab?.state === 'draft'"
              @click="tabNavigation.createSessionTab"
            >
              <Plus aria-hidden="true" />
              <span>{{ t("sessions.newSession") }}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>

    <Separator />

    <SidebarGroup v-if="isLoadingRecent" class="flex-1">
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem v-for="index in 5" :key="index">
            <SidebarMenuSkeleton />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>

    <SidebarGroup v-else-if="recentSessions.length === 0" class="flex-1">
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton disabled>
              <span>{{ t("sessions.noSessions") }}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>

    <div v-else class="min-h-0 flex-1">
      <ScrollArea
        class="h-full [&_[data-slot=scroll-area-viewport]]:scroll-fade"
      >
        <SidebarGroup v-for="group in sessionGroups" :key="group.key">
          <SidebarGroupLabel>{{ group.label }}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem
                v-for="session in group.sessions"
                :key="session.id"
              >
                <ContextMenu>
                  <ContextMenuTrigger as-child>
                    <SidebarMenuButton
                      class="min-w-0"
                      :data-session-id="session.id"
                      :draggable="true"
                      :class="{
                        'bg-sidebar-accent ring-1 ring-sidebar-ring':
                          dropSessionId === session.id,
                      }"
                      @dragover="dragOverSession($event, session)"
                      @dragleave="leaveSession"
                      @drop="dropOnSession($event, session)"
                      :is-active="
                        activeSessionTab?.state === 'bound' &&
                        session.id === activeSessionTab.sessionId
                      "
                      @click="openSession(session)"
                      @dragstart="startSessionDrag($event, session)"
                    >
                      <span class="min-w-0 flex-1 truncate">
                        {{ sessionTitle(session) }}
                      </span>
                    </SidebarMenuButton>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuGroup>
                      <ContextMenuItem @select="requestSessionRename(session)">
                        <Pencil aria-hidden="true" />
                        {{ t("sessions.renameAction") }}
                      </ContextMenuItem>
                      <ContextMenuItem @select="exportSession(session.id)">
                        <Download aria-hidden="true" />
                        {{ t("sessions.exportAction") }}
                      </ContextMenuItem>
                      <ContextMenuItem
                        variant="destructive"
                        @select="requestSessionDeletion(session)"
                      >
                        <Trash2 aria-hidden="true" />
                        {{ t("sessions.deleteAction") }}
                      </ContextMenuItem>
                    </ContextMenuGroup>
                  </ContextMenuContent>
                </ContextMenu>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </ScrollArea>
    </div>

    <SessionDeleteDialog
      v-model:open="isDeleteDialogOpen"
      :session="sessionPendingDelete"
    />

    <SessionRenameDialog
      v-model:open="isRenameDialogOpen"
      :session="sessionPendingRename"
    />
  </div>
</template>
