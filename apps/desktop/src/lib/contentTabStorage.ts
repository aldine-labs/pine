import { z } from "zod";
import { fileTargetKey } from "@/lib/filePreviewTarget";
import type { ProjectContentTab } from "@/stores/contentTabs";

export const CONTENT_TABS_STORAGE_PREFIX = "pine.content-tabs.v1:";
const id = z.string().min(1);
const stateSchema = z.object({
  activeTabId: z.string().nullable(),
  tabs: z.array(
    z.union([
      z.object({
        id,
        kind: z.literal("file"),
        source: z.literal("project"),
        label: z.string(),
        projectId: id,
        folderId: id,
        relativePath: id,
      }),
      // Accepted so a single presented tab cannot invalidate the whole saved
      // state; the restore pass below drops it deliberately.
      z.object({
        id,
        kind: z.literal("file"),
        source: z.literal("presented"),
        label: z.string(),
        path: z.string().min(1),
      }),
      z.object({
        id,
        kind: z.literal("session"),
        state: z.literal("bound"),
        sessionId: id,
        label: z.string().optional(),
      }),
      z.object({
        id,
        kind: z.literal("session"),
        state: z.enum(["draft", "creating"]),
      }),
    ]),
  ),
});

export interface ContentTabState {
  tabs: ProjectContentTab[];
  activeTabId: string | null;
}

export function readContentTabs(projectId: string): ContentTabState | null {
  try {
    const parsed = stateSchema.safeParse(
      JSON.parse(
        window.localStorage.getItem(CONTENT_TABS_STORAGE_PREFIX + projectId) ??
          "null",
      ),
    );
    if (!parsed.success) return null;
    const ids = new Set<string>();
    const entries = new Set<string>();
    const tabs: ProjectContentTab[] = [];
    for (const saved of parsed.data.tabs) {
      // A presented file's access grant only covers the run that presented it,
      // so a restart cannot resume that tab without widening what this window
      // may read. Drop it instead of restoring a tab that could never load.
      if (saved.kind === "file" && saved.source === "presented") continue;
      if (
        ids.has(saved.id) ||
        (saved.kind === "file" && saved.projectId !== projectId)
      )
        continue;
      // A process restart cannot continue an unbound in-flight prompt.
      const tab: ProjectContentTab =
        saved.kind === "session" && saved.state !== "bound"
          ? { id: saved.id, kind: "session", state: "draft" }
          : saved;
      const identity =
        tab.kind === "file"
          ? fileTargetKey(tab)
          : tab.state === "bound"
            ? `session:${tab.sessionId}`
            : `draft:${tab.id}`;
      if (entries.has(identity)) continue;
      ids.add(tab.id);
      entries.add(identity);
      tabs.push(tab);
    }
    if (parsed.data.tabs.length && !tabs.length) return null;
    return {
      tabs,
      activeTabId: tabs.some((tab) => tab.id === parsed.data.activeTabId)
        ? parsed.data.activeTabId
        : (tabs[0]?.id ?? null),
    };
  } catch {
    return null;
  }
}

export function writeContentTabs(
  projectId: string,
  state: ContentTabState,
): void {
  try {
    window.localStorage.setItem(
      CONTENT_TABS_STORAGE_PREFIX + projectId,
      JSON.stringify(state),
    );
  } catch {
    // Storage failures must not interrupt tab navigation.
  }
}
