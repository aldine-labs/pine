import { acceptHMRUpdate, defineStore } from "pinia";
import { ref, shallowRef } from "vue";
import type {
  CreateProjectRequest,
  OpenProjectResult,
  PineProject,
  UpdateProjectRequest,
} from "@/shared/projects";
import { useContentTabsStore } from "./contentTabs";
import { useSessionStore } from "./session";

export const useProjectStore = defineStore("project", () => {
  const contentTabsStore = useContentTabsStore();
  const sessionStore = useSessionStore();
  const projects = shallowRef<PineProject[]>([]);
  const activeProject = shallowRef<PineProject | null>(null);
  const isLoadingProjects = ref(false);
  const isOpeningProject = ref(false);
  const isSavingProject = ref(false);

  function upsertProject(project: PineProject): void {
    projects.value = [
      project,
      ...projects.value.filter((candidate) => candidate.id !== project.id),
    ].sort((left, right) => {
      const leftTime = Date.parse(left.lastOpenedAt ?? left.updatedAt);
      const rightTime = Date.parse(right.lastOpenedAt ?? right.updatedAt);
      return rightTime - leftTime;
    });
  }

  async function loadProjects(): Promise<void> {
    if (isLoadingProjects.value) return;
    isLoadingProjects.value = true;
    try {
      projects.value = (await window.pine.listProjects()).projects;
    } finally {
      isLoadingProjects.value = false;
    }
  }

  async function createProject(
    request: CreateProjectRequest,
  ): Promise<PineProject> {
    isSavingProject.value = true;
    try {
      const project = (await window.pine.createProject(request)).project;
      upsertProject(project);
      return project;
    } finally {
      isSavingProject.value = false;
    }
  }

  async function openProject(id: string): Promise<OpenProjectResult> {
    if (isOpeningProject.value) {
      throw new Error("Another project is already opening.");
    }
    isOpeningProject.value = true;
    try {
      const result = await window.pine.openProject({ id });
      if (!result.opened) return result;

      const { project } = result;
      sessionStore.reset();
      contentTabsStore.restore(project.id);
      activeProject.value = project;
      upsertProject(project);
      return result;
    } finally {
      isOpeningProject.value = false;
    }
  }

  async function updateProject(
    request: UpdateProjectRequest,
  ): Promise<PineProject> {
    isSavingProject.value = true;
    try {
      const project = (await window.pine.updateProject(request)).project;
      upsertProject(project);
      if (activeProject.value?.id === project.id) {
        activeProject.value = project;
        sessionStore.reset();
        contentTabsStore.restore(project.id);
      }
      return project;
    } finally {
      isSavingProject.value = false;
    }
  }

  async function deleteProject(id: string): Promise<void> {
    isSavingProject.value = true;
    try {
      await window.pine.deleteProject({ id });
      projects.value = projects.value.filter((project) => project.id !== id);
      if (activeProject.value?.id === id) {
        activeProject.value = null;
        sessionStore.reset();
        contentTabsStore.reset();
      }
    } finally {
      isSavingProject.value = false;
    }
  }

  async function closeProject(): Promise<void> {
    await window.pine.closeProject();
    activeProject.value = null;
    sessionStore.reset();
    contentTabsStore.reset();
  }

  return {
    activeProject,
    closeProject,
    createProject,
    deleteProject,
    isLoadingProjects,
    isOpeningProject,
    isSavingProject,
    loadProjects,
    openProject,
    projects,
    updateProject,
  };
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useProjectStore, import.meta.hot));
}
