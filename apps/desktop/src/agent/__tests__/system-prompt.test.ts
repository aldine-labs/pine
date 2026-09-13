import { describe, expect, it } from "vitest";
import {
  PINE_YOLO_SYSTEM_PROMPT,
  PINE_SYSTEM_PROMPT,
  systemPromptWithUserProfile,
  systemPromptWithCurrentMonth,
  systemPromptForApprovalMode,
  systemPromptForPlatform,
} from "../system-prompt";
import { createDefaultPineUserProfile } from "../../shared/userProfile";

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

  it("uses the native Windows shell and permission vocabulary", () => {
    const prompt = systemPromptForPlatform(PINE_SYSTEM_PROMPT, "win32");

    expect(prompt).toContain("ordinary PowerShell");
    expect(prompt).toContain("privileged_powershell");
    expect(prompt).toContain("Windows application or GUI control");
    expect(prompt).toContain("Windows ACLs, UAC");
    expect(prompt).toContain("Use $env:PINE_TMPDIR");
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
    expect(prompt).toContain("technically sophisticated solutions");
    expect(prompt).toContain("system-level personalization preferences");
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
