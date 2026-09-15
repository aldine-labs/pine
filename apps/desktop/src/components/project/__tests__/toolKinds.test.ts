import { MonitorCogIcon, PanelTopIcon } from "@lucide/vue";
import { describe, expect, it } from "vitest";
import { TOOL_KIND_ICON, toolKind } from "../toolKinds";

describe("Computer Use tool kinds", () => {
  it("uses dedicated desktop and browser kinds", () => {
    expect(toolKind("activate_computer_use")).toBe("computer");
    expect(toolKind("get_app_state")).toBe("computer");
    expect(toolKind("browser_snapshot")).toBe("browser");
    expect(TOOL_KIND_ICON.computer).toBe(MonitorCogIcon);
    expect(TOOL_KIND_ICON.browser).toBe(PanelTopIcon);
  });
});
