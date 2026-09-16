import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PineProject } from "@/shared/projects";
import { useProjectStore } from "../project";
import { useContentTabsStore } from "../contentTabs";

const project: PineProject = {
  createdAt: "2026-08-19T12:00:00.000Z",
  defaultFolderId: "cde9a86c-7632-43ac-96d6-c41ddeddce0e",
  folders: [
    {
      access: "read-write",
      id: "cde9a86c-7632-43ac-96d6-c41ddeddce0e",
      isAvailable: true,
      name: "pine",
      path: "/projects/pine",
    },
  ],
  id: "9ab0b15f-331f-4aa6-8056-cd2be3bf7414",
  name: "pine",
  schemaVersion: 1,
  updatedAt: "2026-08-19T12:00:00.000Z",
};

describe("project store", () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  it.each([false, true])(
    "preserves an empty workspace when reopening (fresh stores: %s)",
    async (freshStores) => {
      Object.defineProperty(window, "pine", {
        configurable: true,
        value: {
          openProject: vi.fn().mockResolvedValue({ opened: true, project }),
          closeProject: vi.fn().mockResolvedValue(undefined),
        },
      });
      const store = useProjectStore();
      await store.openProject(project.id);
      const tabs = useContentTabsStore();
      // A project without saved state starts with a new session.
      expect(tabs.tabs).toEqual([
        { id: "session-1", kind: "session", state: "draft" },
      ]);
      tabs.close("session-1", "session-1");
      await store.closeProject();

      if (freshStores) setActivePinia(createPinia());
      await useProjectStore().openProject(project.id);
      expect(useContentTabsStore().tabs).toEqual([]);
      expect(useContentTabsStore().fallbackActiveTabId).toBeNull();
    },
  );

  it("restores tabs when reopening and updating a project without overwriting them on close", async () => {
    Object.defineProperty(window, "pine", {
      configurable: true,
      value: {
        openProject: vi.fn().mockResolvedValue({ opened: true, project }),
        closeProject: vi.fn().mockResolvedValue(undefined),
        updateProject: vi
          .fn()
          .mockResolvedValue({ project: { ...project, name: "renamed" } }),
      },
    });
    const store = useProjectStore();
    await store.openProject(project.id);
    const tabs = useContentTabsStore();
    const file = tabs.openFile({
      projectId: project.id,
      folderId: project.defaultFolderId,
      relativePath: "README.md",
    });
    tabs.setActiveTab(file.id);
    await store.closeProject();
    await store.openProject(project.id);
    expect(tabs.tabs.map((tab) => tab.id)).toEqual(["session-1", file.id]);
    expect(tabs.fallbackActiveTabId).toBe(file.id);
    await store.updateProject({ ...project, name: "renamed" });
    expect(tabs.tabs.map((tab) => tab.id)).toEqual(["session-1", file.id]);
    expect(tabs.fallbackActiveTabId).toBe(file.id);
  });

  it("loads the Project Library", async () => {
    Object.defineProperty(window, "pine", {
      configurable: true,
      value: {
        listProjects: vi.fn().mockResolvedValue({ projects: [project] }),
      },
    });
    const store = useProjectStore();

    await store.loadProjects();
    expect(store.projects).toEqual([project]);
    expect(store.isLoadingProjects).toBe(false);
  });

  it("opens a project and stores it as active", async () => {
    const openProject = vi.fn().mockResolvedValue({ opened: true, project });
    Object.defineProperty(window, "pine", {
      configurable: true,
      value: { openProject },
    });
    const store = useProjectStore();

    await expect(store.openProject(project.id)).resolves.toEqual({
      opened: true,
      project,
    });
    expect(openProject).toHaveBeenCalledWith({ id: project.id });
    expect(store.activeProject).toEqual(project);
    expect(store.isOpeningProject).toBe(false);
  });

  it("does not reorder the loaded project library while opening a project", async () => {
    const olderProject = {
      ...project,
      id: "1ab0b15f-331f-4aa6-8056-cd2be3bf7414",
      name: "older",
      lastOpenedAt: "2026-08-19T12:00:00.000Z",
    } satisfies PineProject;
    const openedProject = {
      ...project,
      lastOpenedAt: "2026-08-20T12:00:00.000Z",
    } satisfies PineProject;
    const openProject = vi
      .fn()
      .mockResolvedValue({ opened: true, project: openedProject });
    Object.defineProperty(window, "pine", {
      configurable: true,
      value: {
        listProjects: vi
          .fn()
          .mockResolvedValue({ projects: [olderProject, project] }),
        openProject,
      },
    });
    const store = useProjectStore();

    await store.loadProjects();
    await store.openProject(project.id);

    expect(store.projects.map(({ id }) => id)).toEqual([
      olderProject.id,
      project.id,
    ]);
    expect(store.activeProject?.lastOpenedAt).toBe(openedProject.lastOpenedAt);
  });

  it("clears its opening state when opening fails", async () => {
    Object.defineProperty(window, "pine", {
      configurable: true,
      value: { openProject: vi.fn().mockRejectedValue(new Error("failed")) },
    });
    const store = useProjectStore();

    await expect(store.openProject(project.id)).rejects.toThrow("failed");
    expect(store.activeProject).toBeNull();
    expect(store.isOpeningProject).toBe(false);
  });

  it("deletes a project through the desktop API and removes it from state", async () => {
    const deleteProject = vi.fn().mockResolvedValue({ deleted: true });
    Object.defineProperty(window, "pine", {
      configurable: true,
      value: {
        deleteProject,
        listProjects: vi.fn().mockResolvedValue({ projects: [project] }),
      },
    });
    const store = useProjectStore();
    await store.loadProjects();

    await store.deleteProject(project.id);

    expect(deleteProject).toHaveBeenCalledWith({ id: project.id });
    expect(store.projects).toEqual([]);
    expect(store.isSavingProject).toBe(false);
  });
});
