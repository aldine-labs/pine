<script setup lang="ts">
import { House } from "@lucide/vue";
import { onKeyStroke } from "@vueuse/core";
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { handleError } from "@/app/errors/errorHandler";
import PinePreferencesDialog from "@/components/preferences/PinePreferencesDialog.vue";
import SessionSearchOverlay from "@/components/sessions/SessionSearchOverlay.vue";
import ProjectContentTabs from "@/components/project/ProjectContentTabs.vue";
import ProjectDialog from "@/components/project/ProjectDialog.vue";
import ProjectSidebar from "@/components/project/ProjectSidebar.vue";
import PineUpdateDialog from "@/components/updates/PineUpdateDialog.vue";
import WindowTitleBar from "@/components/window/WindowTitleBar.vue";
import { Button } from "@/components/ui/button";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { ROUTE_NAMES } from "@/router/routes";
import { useProjectStore } from "@/stores/project";

const { t } = useI18n();
const router = useRouter();
const isSessionSearchOpen = ref(false);
const isProjectSettingsOpen = ref(false);
const isUpdateOpen = ref(false);
const projectStore = useProjectStore();

async function closeProject(): Promise<void> {
  try {
    await projectStore.closeProject();
  } catch (error) {
    handleError(error, {
      id: "project.close",
      title: t("errors.projectClose.title"),
      description: t("errors.projectClose.description"),
    });
    return;
  }

  await router.push({ name: ROUTE_NAMES.projects });
}

onKeyStroke("k", (event) => {
  if (!(event.metaKey || event.ctrlKey)) return;
  event.preventDefault();
  isSessionSearchOpen.value = true;
});
</script>

<template>
  <SidebarProvider
    class="relative h-full min-h-0 [&_[data-slot=sidebar-container]]:duration-500 [&_[data-slot=sidebar-container]]:ease-out-expo [&_[data-slot=sidebar-gap]]:duration-500 [&_[data-slot=sidebar-gap]]:ease-out-expo"
    :default-open="true"
  >
    <ProjectSidebar
      @edit-project="isProjectSettingsOpen = true"
      @search-sessions="isSessionSearchOpen = true"
      @show-update="isUpdateOpen = true"
    />

    <SidebarInset class="min-h-0 overflow-hidden">
      <ProjectContentTabs />
    </SidebarInset>

    <!-- Electron applies overlapping drag/no-drag regions in DOM order.
         Register window controls after the content titlebar's drag region. -->
    <WindowTitleBar controls-only>
      <template #leading>
        <SidebarTrigger />
        <Button
          variant="ghost"
          size="icon-sm"
          :aria-label="t('project.closeProject')"
          :title="t('project.closeProject')"
          @click="closeProject"
        >
          <House aria-hidden="true" />
        </Button>
      </template>
      <template #trailing>
        <PinePreferencesDialog />
      </template>
    </WindowTitleBar>

    <SessionSearchOverlay v-model:open="isSessionSearchOpen" />
    <PineUpdateDialog v-model:open="isUpdateOpen" />
    <ProjectDialog
      v-if="projectStore.activeProject"
      v-model:open="isProjectSettingsOpen"
      :project="projectStore.activeProject"
    />
  </SidebarProvider>
</template>
