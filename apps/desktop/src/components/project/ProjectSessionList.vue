<script setup lang="ts">
import {
  ChevronRight,
  FolderOpen,
  FolderPlus,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "@lucide/vue";
import { useEventListener } from "@vueuse/core";
import { storeToRefs } from "pinia";
import { computed, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { handleError } from "@/app/errors/errorHandler";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import type { PineSessionGroup } from "@/shared/projects";
import type { PineSessionSummary } from "@/shared/sessions";
import { useContentTabsStore } from "@/stores/contentTabs";
import { useProjectStore } from "@/stores/project";
import { useSessionStore } from "@/stores/session";
import SessionGroupDeleteDialog from "@/components/sessions/SessionGroupDeleteDialog.vue";
import SessionGroupDialog from "@/components/sessions/SessionGroupDialog.vue";
import SessionContextMenu from "@/components/sessions/SessionContextMenu.vue";
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
const groupDialogMode = ref<"create" | "rename">("create");
const groupPendingRename = ref<PineSessionGroup | null>(null);
const isGroupDialogOpen = ref(false);
const isSavingGroup = ref(false);
const groupPendingDelete = ref<PineSessionGroup | null>(null);
const isGroupDeleteDialogOpen = ref(false);
const isDeletingGroup = ref(false);
const openGroupId = ref<string | null>(null);
let groupCloseTimer: ReturnType<typeof setTimeout> | undefined;

watch(isDeleteDialogOpen, (open) => {
  if (!open) sessionPendingDelete.value = null;
});
watch(isRenameDialogOpen, (open) => {
  if (!open) sessionPendingRename.value = null;
});
watch(isGroupDialogOpen, (open) => {
  if (!open) groupPendingRename.value = null;
});
watch(isGroupDeleteDialogOpen, (open) => {
  if (!open) groupPendingDelete.value = null;
});
onUnmounted(() => {
  if (groupCloseTimer) clearTimeout(groupCloseTimer);
});

const conversationGroups = computed(
  () => activeProject.value?.sessionGroups ?? [],
);

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

const dateSessionGroups = computed(() =>
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
  openGroupId.value = null;
  tabNavigation.openSession(session);
}

function sessionsForGroup(group: PineSessionGroup): PineSessionSummary[] {
  const sessionIds = new Set(group.sessionIds);
  return recentSessions.value.filter((session) => sessionIds.has(session.id));
}

function clearGroupCloseTimer(): void {
  if (groupCloseTimer) {
    clearTimeout(groupCloseTimer);
    groupCloseTimer = undefined;
  }
}

function openGroupMenu(groupId: string): void {
  clearGroupCloseTimer();
  openGroupId.value = groupId;
}

function scheduleCloseGroupMenu(groupId: string): void {
  clearGroupCloseTimer();
  groupCloseTimer = setTimeout(() => {
    if (openGroupId.value === groupId) openGroupId.value = null;
    groupCloseTimer = undefined;
  }, 120);
}

function updateGroupMenuOpen(groupId: string, open: boolean): void {
  if (open) openGroupMenu(groupId);
  else if (openGroupId.value === groupId) openGroupId.value = null;
}

function requestCreateGroup(): void {
  groupDialogMode.value = "create";
  groupPendingRename.value = null;
  isGroupDialogOpen.value = true;
}

function requestGroupRename(group: PineSessionGroup): void {
  groupDialogMode.value = "rename";
  groupPendingRename.value = group;
  isGroupDialogOpen.value = true;
}

function requestGroupDeletion(group: PineSessionGroup): void {
  groupPendingDelete.value = group;
  isGroupDeleteDialogOpen.value = true;
}

async function saveGroup(name: string): Promise<void> {
  if (isSavingGroup.value) return;

  const currentGroups = conversationGroups.value;
  const groups =
    groupDialogMode.value === "create"
      ? [...currentGroups, { id: crypto.randomUUID(), name, sessionIds: [] }]
      : currentGroups.map((group) =>
          group.id === groupPendingRename.value?.id
            ? { ...group, name }
            : group,
        );

  isSavingGroup.value = true;
  try {
    await projectStore.updateSessionGroups(groups);
    isGroupDialogOpen.value = false;
  } catch (error) {
    handleError(error, {
      id: "sessions.group.save",
      title: t("errors.sessionRename.title"),
      description: t("errors.sessionRename.description"),
    });
  } finally {
    isSavingGroup.value = false;
  }
}

async function deleteGroup(): Promise<void> {
  const group = groupPendingDelete.value;
  if (!group || isDeletingGroup.value) return;

  isDeletingGroup.value = true;
  try {
    await projectStore.updateSessionGroups(
      conversationGroups.value.filter((candidate) => candidate.id !== group.id),
    );
    isGroupDeleteDialogOpen.value = false;
  } catch (error) {
    handleError(error, {
      id: "sessions.group.delete",
      title: t("errors.sessionDelete.title"),
      description: t("errors.sessionDelete.description"),
    });
  } finally {
    isDeletingGroup.value = false;
  }
}

async function moveSessionToGroup(
  session: PineSessionSummary,
  groupId: string | null,
): Promise<void> {
  const groups = conversationGroups.value.map((group) => ({
    ...group,
    sessionIds: group.sessionIds.filter(
      (sessionId) => sessionId !== session.id,
    ),
  }));
  const target = groups.find((group) => group.id === groupId);
  if (target) target.sessionIds = [...target.sessionIds, session.id];

  try {
    await projectStore.updateSessionGroups(groups);
  } catch (error) {
    handleError(error, {
      id: "sessions.group.move",
      title: t("errors.sessionRename.title"),
      description: t("errors.sessionRename.description"),
    });
  }
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
          <SidebarMenuItem v-if="conversationGroups.length === 0">
            <SidebarMenuButton @click="requestCreateGroup">
              <FolderPlus aria-hidden="true" />
              <span>{{ t("sessions.createGroupAction") }}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>

    <Separator v-if="conversationGroups.length > 0" />
    <Separator v-else />

    <template v-if="conversationGroups.length > 0">
      <SidebarGroup class="shrink-0">
        <SidebarGroupLabel>{{ t("sessions.groupTitle") }}</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem
              v-for="group in conversationGroups"
              :key="group.id"
              :data-session-group-id="group.id"
              @mouseenter="openGroupMenu(group.id)"
              @mouseleave="scheduleCloseGroupMenu(group.id)"
            >
              <ContextMenu>
                <ContextMenuTrigger as-child>
                  <div class="w-full">
                    <DropdownMenu
                      :open="openGroupId === group.id"
                      @update:open="updateGroupMenuOpen(group.id, $event)"
                    >
                      <DropdownMenuTrigger as-child>
                        <SidebarMenuButton class="min-w-0" variant="default">
                          <FolderOpen aria-hidden="true" />
                          <span class="min-w-0 flex-1 truncate text-left">
                            {{ group.name }}
                          </span>
                          <ChevronRight aria-hidden="true" />
                        </SidebarMenuButton>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        side="right"
                        align="start"
                        class="w-64"
                        @mouseenter="clearGroupCloseTimer"
                        @mouseleave="scheduleCloseGroupMenu(group.id)"
                      >
                        <DropdownMenuGroup>
                          <SessionContextMenu
                            v-for="session in sessionsForGroup(group)"
                            :key="session.id"
                            :groups="conversationGroups"
                            :session="session"
                            @rename="requestSessionRename(session)"
                            @export="exportSession(session.id)"
                            @move="moveSessionToGroup(session, $event)"
                            @delete="requestSessionDeletion(session)"
                          >
                            <DropdownMenuItem @select="openSession(session)">
                              <span class="min-w-0 truncate">
                                {{ sessionTitle(session) }}
                              </span>
                            </DropdownMenuItem>
                          </SessionContextMenu>
                          <DropdownMenuItem
                            v-if="sessionsForGroup(group).length === 0"
                            disabled
                          >
                            {{ t("sessions.emptyGroup") }}
                          </DropdownMenuItem>
                        </DropdownMenuGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuGroup>
                    <ContextMenuItem @select="requestGroupRename(group)">
                      <Pencil aria-hidden="true" />
                      {{ t("sessions.renameGroupAction") }}
                    </ContextMenuItem>
                    <ContextMenuItem
                      variant="destructive"
                      @select="requestGroupDeletion(group)"
                    >
                      <Trash2 aria-hidden="true" />
                      {{ t("sessions.deleteGroupAction") }}
                    </ContextMenuItem>
                  </ContextMenuGroup>
                </ContextMenuContent>
              </ContextMenu>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton @click="requestCreateGroup">
                <FolderPlus aria-hidden="true" />
                <span>{{ t("sessions.createGroupAction") }}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
      <Separator />
    </template>
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
        <SidebarGroup v-for="group in dateSessionGroups" :key="group.key">
          <SidebarGroupLabel>{{ group.label }}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem
                v-for="session in group.sessions"
                :key="session.id"
              >
                <SessionContextMenu
                  :groups="conversationGroups"
                  :session="session"
                  @rename="requestSessionRename(session)"
                  @export="exportSession(session.id)"
                  @move="moveSessionToGroup(session, $event)"
                  @delete="requestSessionDeletion(session)"
                >
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
                </SessionContextMenu>
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

    <SessionGroupDialog
      v-model:open="isGroupDialogOpen"
      :group="groupPendingRename"
      :mode="groupDialogMode"
      :is-saving="isSavingGroup"
      @submit="saveGroup"
    />

    <SessionGroupDeleteDialog
      v-model:open="isGroupDeleteDialogOpen"
      :group="groupPendingDelete"
      :is-deleting="isDeletingGroup"
      @confirm="deleteGroup"
    />
  </div>
</template>
