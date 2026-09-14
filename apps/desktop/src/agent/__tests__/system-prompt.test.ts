import { describe, expect, it } from "vitest";
import {
  PINE_YOLO_SYSTEM_PROMPT,
  PINE_SYSTEM_PROMPT,
  systemPromptWithUserProfile,
  systemPromptWithCurrentMonth,
  systemPromptForApprovalMode,
  systemPromptForPlatform,
} from "../system-prompt";
import {
  createDefaultPineUserProfile,
  type PineUserProfile,
} from "../../shared/userProfile";

describe("systemPromptWithCurrentMonth", () => {
  it("appends the current year and month after the stable prompt prefix", () => {
    const prompt = systemPromptWithCurrentMonth(
      `${PINE_SYSTEM_PROMPT}\n\n<project_context>stable context</project_context>`,
      new Date("2026-09-06T12:00:00"),
    );

    expect(
      prompt.startsWith(
        `${PINE_SYSTEM_PROMPT}\n\n<project_context>stable context</project_context>`,
      ),
    ).toBe(true);
    expect(prompt).toContain("The current year and month are 2026-09.");
    expect(prompt).not.toContain("2026-09-06");
  });
});

describe("PINE_SYSTEM_PROMPT local tool guidance", () => {
  it("selects privileged bash before calling ordinary bash for known external access", () => {
    expect(PINE_SYSTEM_PROMPT).toContain(
      "do not use ordinary bash to probe a capability",
    );
    expect(PINE_SYSTEM_PROMPT).toContain(
      "If the required path or capability is already known to be external, call privileged_bash first",
    );
    expect(PINE_SYSTEM_PROMPT).toContain(
      "These rules apply to read-only commands too, including ls, find, and cat",
    );
  });

  it("plans implicit resources and cross-backend handoffs", () => {
    expect(PINE_SYSTEM_PROMPT).toContain(
      "account for both explicit and implicit resources",
    );
    expect(PINE_SYSTEM_PROMPT).toContain(
      "Their temporary-directory variables are not interchangeable handoff locations",
    );
    expect(PINE_SYSTEM_PROMPT).toContain(
      "use an explicit absolute path inside a shared project folder",
    );
    expect(PINE_SYSTEM_PROMPT).toContain(
      "For network-backed work such as cloning or downloading, use privileged_bash from the start",
    );
    expect(PINE_SYSTEM_PROMPT).toContain("Git may read a global config file");
    expect(PINE_SYSTEM_PROMPT).toContain(
      "A shell parse error, missing command, or failed helper command is not evidence of a sandbox denial",
    );
    expect(PINE_SYSTEM_PROMPT).toContain(
      "Never switch backends and replay a failed command verbatim",
    );
  });

  it("uses the native Windows shell and permission vocabulary", () => {
    const prompt = systemPromptForPlatform(PINE_SYSTEM_PROMPT, "win32");

    expect(prompt).toContain("ordinary PowerShell");
    expect(prompt).toContain("privileged_powershell");
    expect(prompt).toContain("Windows application or GUI control");
    expect(prompt).toContain("Windows ACLs, UAC");
    expect(prompt).toContain("Use $env:PINE_TMPDIR");
    expect(prompt).toContain("dedicated sandbox account");
    expect(prompt).toContain("Windows PowerShell 5.1");
    expect(prompt).toContain("does not establish a sandbox escape");
    expect(prompt).not.toContain("privileged_bash");
  });

  it("distinguishes sandbox evidence, OS errors, and approval rejection", () => {
    expect(PINE_SYSTEM_PROMPT).toContain(
      "an explicit Pine sandbox-denial marker means the sandbox blocked the call",
    );
    expect(PINE_SYSTEM_PROMPT).toContain(
      'EPERM, EACCES, "permission denied," or "operation not permitted" is only a diagnostic hint',
    );
    expect(PINE_SYSTEM_PROMPT).toContain(
      "an approval rejection means the privileged command never ran",
    );
    expect(PINE_SYSTEM_PROMPT).toContain("it is not root or sudo");
  });
});

describe("systemPromptWithUserProfile", () => {
  it("adds the selected style, technical background, and user-authored context", () => {
    const prompt = systemPromptWithUserProfile("base prompt", {
      communicationStyle: "warm-friendly",
      customInstructions: "Always lead with the conclusion.",
      nickname: "小 Pine",
      personalDetails: "正在学习桌面应用开发。",
      technicalBackground: "professional-user",
    });

    expect(prompt).toContain("## User profile");
    expect(prompt).toContain("Preferred name: 小 Pine");
    expect(prompt).toContain("Always lead with the conclusion.");
    expect(prompt).toContain("The user self-defines as a professional user.");
    expect(prompt).toContain("technically sophisticated solutions");
    expect(prompt).toContain("Use ask_user_question eagerly");
    expect(prompt).toContain(
      "let the user decide about architecture, tools, debugging strategy",
    );
    expect(prompt).toContain("system-level personalization preferences");
  });

  it("adjusts question eagerness across technical backgrounds", () => {
    const baseProfile = createDefaultPineUserProfile();
    const promptFor = (
      technicalBackground: PineUserProfile["technicalBackground"],
    ) =>
      systemPromptWithUserProfile("base prompt", {
        ...baseProfile,
        technicalBackground,
      });

    const generalUserPrompt = promptFor("general-user");
    const enthusiastPrompt = promptFor("enthusiast");
    const professionalUserPrompt = promptFor("professional-user");

    expect(generalUserPrompt).toContain(
      "Use ask_user_question sparingly for technical decisions",
    );
    expect(generalUserPrompt).toContain(
      "- Technical background: The user self-defines as a general user.",
    );
    expect(generalUserPrompt).toContain(
      "Still ask before committing the user to important non-technical preferences",
    );
    expect(enthusiastPrompt).toContain(
      "Use ask_user_question with moderate eagerness",
    );
    expect(enthusiastPrompt).toContain(
      "- Technical background: The user self-defines as an enthusiast.",
    );
    expect(enthusiastPrompt).toContain(
      "You may choose sensible defaults for routine details",
    );
    expect(professionalUserPrompt).toContain(
      "Use ask_user_question eagerly for key technical and implementation decisions",
    );
    expect(professionalUserPrompt).toContain(
      "- Technical background: The user self-defines as a professional user.",
    );
    expect(professionalUserPrompt).toContain(
      "let the user decide about architecture, tools, debugging strategy",
    );
  });

  it("uses the product defaults for a new profile", () => {
    const prompt = systemPromptWithUserProfile(
      "base prompt",
      createDefaultPineUserProfile(),
    );

    expect(prompt).toContain("Use concise, direct language");
    expect(prompt).toContain("Act like a textbook when useful");
  });
});

describe("systemPromptForApprovalMode", () => {
  it("adds privileged bash safety guidance in yolo mode", () => {
    const prompt = systemPromptForApprovalMode("base prompt", "YOLO");

    expect(prompt).toBe(`base prompt\n\n${PINE_YOLO_SYSTEM_PROMPT}`);
    expect(prompt).toContain("call privileged_bash directly");
    expect(prompt).toContain("outside Pine's project sandbox");
    expect(prompt).toContain("without approval");
    expect(prompt).toContain("All other tools also run without");
    expect(prompt).toContain(
      "there is no ordinary-shell fallback in this mode",
    );
    expect(prompt).toContain("avoid destructive or irreversible actions");
  });

  it("does not override the system prompt outside yolo mode", () => {
    expect(
      systemPromptForApprovalMode("base prompt", "auto-approve"),
    ).toBeUndefined();
    expect(
      systemPromptForApprovalMode("base prompt", "let-me-review"),
    ).toBeUndefined();
  });
});
