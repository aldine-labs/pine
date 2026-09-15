import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PineProject } from "@/shared/projects";
import { createAppRouter } from "../index";
import { ROUTE_NAMES } from "../routes";

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

describe("project navigation", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("opens a project when its URL is loaded directly", async () => {
    Object.defineProperty(window, "pine", {
      configurable: true,
      value: {
        openProject: vi.fn().mockResolvedValue({ opened: true, project }),
      },
    });
    const pinia = createPinia();
    const router = createAppRouter(pinia, createMemoryHistory());

    await router.push({
      name: ROUTE_NAMES.project,
      params: { projectId: project.id },
    });

    expect(router.currentRoute.value.name).toBe(ROUTE_NAMES.project);
  });

  it("returns to the Project Library when opening fails", async () => {
    Object.defineProperty(window, "pine", {
      configurable: true,
      value: { openProject: vi.fn().mockRejectedValue(new Error("missing")) },
    });
    const pinia = createPinia();
    const router = createAppRouter(pinia, createMemoryHistory());

    await router.push({
      name: ROUTE_NAMES.project,
      params: { projectId: project.id },
    });

    expect(router.currentRoute.value.name).toBe(ROUTE_NAMES.projects);
  });

  it("returns to the Project Library when another window owns the project", async () => {
    Object.defineProperty(window, "pine", {
      configurable: true,
      value: {
        openProject: vi.fn().mockResolvedValue({ opened: false, project }),
      },
    });
    const pinia = createPinia();
    const router = createAppRouter(pinia, createMemoryHistory());

    await router.push({
      name: ROUTE_NAMES.project,
      params: { projectId: project.id },
    });

    expect(router.currentRoute.value.name).toBe(ROUTE_NAMES.projects);
  });
});
