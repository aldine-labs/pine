import type { Pinia } from "pinia";
import {
  createRouter,
  createWebHashHistory,
  type RouteRecordRaw,
  type Router,
  type RouterHistory,
} from "vue-router";
import { useProjectStore } from "@/stores/project";
import { ROUTE_NAMES } from "./routes";

declare module "vue-router" {
  interface RouteMeta {
    requiresProject?: boolean;
  }
}

const routes: RouteRecordRaw[] = [
  {
    path: "/",
    redirect: { name: ROUTE_NAMES.projects },
  },
  {
    path: "/projects",
    name: ROUTE_NAMES.projects,
    component: () => import("@/views/ProjectsView.vue"),
  },
  {
    path: "/projects/:projectId",
    name: ROUTE_NAMES.project,
    component: () => import("@/views/ProjectView.vue"),
    meta: { requiresProject: true },
  },
  {
    path: "/:pathMatch(.*)*",
    redirect: { name: ROUTE_NAMES.projects },
  },
];

export function createAppRouter(
  pinia: Pinia,
  history: RouterHistory = createWebHashHistory(),
): Router {
  const router = createRouter({
    history,
    routes,
  });

  router.beforeEach((to) => {
    if (!to.meta.requiresProject) return true;

    const projectId = to.params.projectId;
    if (typeof projectId !== "string") {
      return { name: ROUTE_NAMES.projects };
    }

    const projectStore = useProjectStore(pinia);
    if (projectStore.activeProject?.id === projectId) return true;

    return projectStore
      .openProject(projectId)
      .then((result) => (result.opened ? true : { name: ROUTE_NAMES.projects }))
      .catch(() => ({ name: ROUTE_NAMES.projects }));
  });

  return router;
}
