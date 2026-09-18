<script setup lang="ts">
import { computed, onUnmounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  Download,
  FolderOpen,
  FolderPlus,
  FolderX,
  Pencil,
  Trash2,
} from "@lucide/vue";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import type { PineSessionGroup } from "@/shared/projects";
import type { PineSessionSummary } from "@/shared/sessions";

const props = defineProps<{
  groups: PineSessionGroup[];
  session: PineSessionSummary;
}>();

const emit = defineEmits<{
  rename: [];
  export: [];
  move: [groupId: string | null];
  delete: [];
}>();

const { t } = useI18n();
const groupedSessionIds = computed(
  () => new Set(props.groups.flatMap((group) => group.sessionIds)),
);
const isGroupSubmenuOpen = ref(false);
let groupSubmenuCloseTimer: ReturnType<typeof setTimeout> | undefined;

function clearGroupSubmenuCloseTimer(): void {
  if (groupSubmenuCloseTimer) {
    clearTimeout(groupSubmenuCloseTimer);
    groupSubmenuCloseTimer = undefined;
  }
}

function openGroupSubmenu(): void {
  clearGroupSubmenuCloseTimer();
  isGroupSubmenuOpen.value = true;
}

function scheduleCloseGroupSubmenu(): void {
  clearGroupSubmenuCloseTimer();
  groupSubmenuCloseTimer = setTimeout(() => {
    isGroupSubmenuOpen.value = false;
    groupSubmenuCloseTimer = undefined;
  }, 300);
}

function updateGroupSubmenuOpen(open: boolean): void {
  if (open) openGroupSubmenu();
  else scheduleCloseGroupSubmenu();
}

onUnmounted(clearGroupSubmenuCloseTimer);
</script>

<template>
  <ContextMenu>
    <ContextMenuTrigger as-child>
      <slot />
    </ContextMenuTrigger>
    <ContextMenuContent>
      <ContextMenuGroup>
        <ContextMenuItem @select="emit('rename')">
          <Pencil aria-hidden="true" />
          {{ t("sessions.renameAction") }}
        </ContextMenuItem>
        <ContextMenuItem @select="emit('export')">
          <Download aria-hidden="true" />
          {{ t("sessions.exportAction") }}
        </ContextMenuItem>
        <ContextMenuSub
          v-if="props.groups.length > 0"
          v-model:open="isGroupSubmenuOpen"
          @update:open="updateGroupSubmenuOpen"
        >
          <ContextMenuSubTrigger
            @pointerenter="openGroupSubmenu"
            @pointerleave="scheduleCloseGroupSubmenu"
          >
            <FolderPlus aria-hidden="true" />
            {{ t("sessions.moveToGroupAction") }}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent
            @pointerenter="openGroupSubmenu"
            @pointerleave="scheduleCloseGroupSubmenu"
          >
            <ContextMenuGroup>
              <ContextMenuItem
                v-for="group in props.groups"
                :key="group.id"
                @select="emit('move', group.id)"
              >
                <FolderOpen aria-hidden="true" />
                {{ group.name }}
              </ContextMenuItem>
              <ContextMenuItem
                v-if="groupedSessionIds.has(props.session.id)"
                @select="emit('move', null)"
              >
                <FolderX aria-hidden="true" />
                {{ t("sessions.removeFromGroupAction") }}
              </ContextMenuItem>
            </ContextMenuGroup>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuItem variant="destructive" @select="emit('delete')">
          <Trash2 aria-hidden="true" />
          {{ t("sessions.deleteAction") }}
        </ContextMenuItem>
      </ContextMenuGroup>
    </ContextMenuContent>
  </ContextMenu>
</template>
