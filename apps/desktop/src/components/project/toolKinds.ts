import {
  FilePlusIcon,
  FileTextIcon,
  GlobeIcon,
  MonitorCogIcon,
  PanelTopIcon,
  SearchIcon,
  SquarePenIcon,
  TerminalIcon,
  WrenchIcon,
} from "@lucide/vue";
import type { Component } from "vue";
import type { PineToolCall } from "@/shared/sessions";

export type ToolKind =
  | "bash"
  | "browser"
  | "computer"
  | "edit"
  | "fetch"
  | "generic"
  | "read"
  | "search"
  | "write";

/** Icon shown for each tool call, keyed by its kind. */
export const TOOL_KIND_ICON: Record<ToolKind, Component> = {
  bash: TerminalIcon,
  browser: PanelTopIcon,
  computer: MonitorCogIcon,
  edit: SquarePenIcon,
  fetch: GlobeIcon,
  generic: WrenchIcon,
  read: FileTextIcon,
  search: SearchIcon,
  write: FilePlusIcon,
};

/** Order used to render a tool run's summary, matching the user's example
 * ("read 3 files, edited 2, ran 5 commands"). */
export const TOOL_KIND_ORDER: readonly ToolKind[] = [
  "read",
  "edit",
  "write",
  "search",
  "fetch",
  "computer",
  "browser",
  "bash",
  "generic",
];

export function toolKind(name: string): ToolKind {
  const normalized = name.toLowerCase().split(/[.:/]/).at(-1) ?? name;
  if (normalized.startsWith("browser_")) return "browser";
  if (
    [
      "activate_computer_use",
      "request_computer_use_permissions",
      "install_pine_browser_extension",
      "list_apps",
      "get_app_state",
      "click",
      "right_click",
      "hover",
      "drag",
      "scroll",
      "type_text",
      "set_value",
      "select_text",
      "press_key",
      "activate_app",
      "screenshot",
      "zoom",
      "list_displays",
      "wait",
    ].includes(normalized)
  ) {
    return "computer";
  }
  if (
    [
      "bash",
      "powershell",
      "privileged_bash",
      "privileged_powershell",
      "exec",
      "execute",
      "shell",
    ].includes(normalized)
  ) {
    return "bash";
  }
  if (["edit", "apply_patch", "patch"].includes(normalized)) return "edit";
  if (["web_fetch", "fetch"].includes(normalized)) return "fetch";
  if (["read", "read_file", "view"].includes(normalized)) return "read";
  if (["find", "grep", "search", "web_search"].includes(normalized)) {
    return "search";
  }
  if (["write", "write_file", "create_file"].includes(normalized)) {
    return "write";
  }
  return "generic";
}

export function isRunningTool(toolCall: PineToolCall): boolean {
  return (
    !isDeniedTool(toolCall) &&
    (toolCall.status === "pending" || toolCall.status === "running")
  );
}

export function isDeniedTool(toolCall: PineToolCall): boolean {
  return toolCall.approval?.state === "denied";
}

/** Count tool calls grouped by kind, preserving only kinds that appear. */
export function countToolKinds(
  toolCalls: readonly PineToolCall[],
): Map<ToolKind, number> {
  const counts = new Map<ToolKind, number>();
  for (const toolCall of toolCalls) {
    const kind = toolKind(toolCall.name);
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return counts;
}
