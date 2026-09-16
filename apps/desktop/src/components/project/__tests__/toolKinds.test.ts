import {
  BookOpenIcon,
  EyeIcon,
  MonitorCogIcon,
  PanelTopIcon,
  PlusIcon,
  SquarePenIcon,
  Trash2Icon,
  WandSparklesIcon,
} from "@lucide/vue";
import { describe, expect, it } from "vitest";
import {
  SKILL_OPERATION_ICON,
  TOOL_KIND_ICON,
  toolIconForName,
  toolKind,
} from "../toolKinds";

describe("Computer Use tool kinds", () => {
  it("uses dedicated desktop and browser kinds", () => {
    expect(toolKind("activate_computer_use")).toBe("computer");
    expect(toolKind("get_app_state")).toBe("computer");
    expect(toolKind("browser_snapshot")).toBe("browser");
    expect(TOOL_KIND_ICON.computer).toBe(MonitorCogIcon);
    expect(TOOL_KIND_ICON.browser).toBe(PanelTopIcon);
  });

  it("uses a dedicated kind for presented files", () => {
    expect(toolKind("ui_present_file")).toBe("presentFile");
    expect(TOOL_KIND_ICON.presentFile).toBe(EyeIcon);
  });

  it("uses dedicated kinds and icons for Skill operations", () => {
    expect(toolKind("activate_skill_authoring")).toBe("skill");
    expect(toolKind("invoke_skill")).toBe("skill");
    expect(toolKind("create_skill")).toBe("skill");
    expect(toolKind("edit_skill")).toBe("skill");
    expect(toolKind("remove_skill")).toBe("skill");
    expect(TOOL_KIND_ICON.skill).toBe(WandSparklesIcon);
    expect(SKILL_OPERATION_ICON.activateAuthoring).toBe(WandSparklesIcon);
    expect(SKILL_OPERATION_ICON.invoke).toBe(BookOpenIcon);
    expect(SKILL_OPERATION_ICON.create).toBe(PlusIcon);
    expect(SKILL_OPERATION_ICON.edit).toBe(SquarePenIcon);
    expect(SKILL_OPERATION_ICON.remove).toBe(Trash2Icon);
    expect(toolIconForName("invoke_skill")).toBe(BookOpenIcon);
  });
});
