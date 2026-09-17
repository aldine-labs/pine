<script setup lang="ts">
import { computed } from "vue";
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
        <ContextMenuSub v-if="props.groups.length > 0">
          <ContextMenuSubTrigger>
            <FolderPlus aria-hidden="true" />
            {{ t("sessions.moveToGroupAction") }}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
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
