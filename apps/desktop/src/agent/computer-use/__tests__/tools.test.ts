import { describe, expect, it, vi } from "vitest";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { ToolGate } from "../../gate";
import {
  ACTIVATE_COMPUTER_USE_TOOL_NAME,
  COMPUTER_USE_DYNAMIC_TOOL_NAMES,
  ComputerUseController,
  createComputerUseExtension,
  MUNIM_COMPUTER_USE_TOOL_NAMES,
} from "../tools";

function fakeClient() {
  return {
    start: vi.fn(() => Promise.resolve()),
    callTool: vi.fn(() =>
      Promise.resolve({
        content: [{ type: "text", text: "Safari (pid 42)" }],
        isError: false,
      }),
    ),
    dispose: vi.fn(() => Promise.resolve()),
  };
}

function fakeGate(
  review = vi.fn(() => Promise.resolve({ kind: "allow" as const })),
) {
  return {
    reviewBashCommand: vi.fn(),
    reviewFileCall: vi.fn(),
    reviewDenial: vi.fn(),
    reviewPrivilegedCall: review,
    isApprovedCommand: vi.fn(() => false),
    resetTurn: vi.fn(),
  } satisfies ToolGate;
}

describe("ComputerUseController", () => {
  it("returns the skill and newly activated tools from the activator", async () => {
    const client = fakeClient();
    const controller = new ComputerUseController({
      client,
      executablePath: "/mock/pine-computer-use",
      getApprovalMode: () => "auto-approve",
      getGate: () => fakeGate(),
    });

    const activate = vi.fn();
    const result = await controller.activate(activate);

    expect(client.start).toHaveBeenCalledOnce();
    expect(activate).toHaveBeenCalledOnce();
    expect(result.details.addedToolNames).toBeUndefined();
    expect(result.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("<computer_use_skill>"),
    });
  });

  it("keeps observations silent and reviews native actions", async () => {
    const client = fakeClient();
    const review = vi.fn(() => Promise.resolve({ kind: "allow" as const }));
    const controller = new ComputerUseController({
      client,
      executablePath: "/mock/pine-computer-use",
      getApprovalMode: () => "auto-approve",
      getGate: () => fakeGate(review),
    });

    await controller.call("call-1", "list_apps", {});
    await controller.call("call-2", "click", { element_id: "e12" });

    expect(client.start).toHaveBeenCalledTimes(2);
    expect(review).toHaveBeenCalledOnce();
    expect(review).toHaveBeenCalledWith(
      expect.objectContaining({
        toolCallId: "call-2",
        toolName: "click",
        subject: "click on element e12",
      }),
    );
  });

  it("surfaces MCP tool errors as failed tool calls", async () => {
    const client = fakeClient();
    client.callTool.mockResolvedValueOnce({
      content: [{ type: "text", text: "Accessibility permission is missing" }],
      isError: true,
    });
    const controller = new ComputerUseController({
      client,
      executablePath: "/mock/pine-computer-use",
      getApprovalMode: () => "YOLO",
      getGate: () => null,
    });

    await expect(controller.call("call-1", "click", {})).rejects.toThrow(
      "Accessibility permission is missing",
    );
  });
});

describe("createComputerUseExtension", () => {
  it("registers all tools and activates the hidden tools additively", async () => {
    const registered: Array<{
      name: string;
      execute: (...args: never[]) => Promise<unknown>;
    }> = [];
    const setActiveTools = vi.fn();
    const activated = vi.fn();
    const { extension } = createComputerUseExtension({
      activated,
      client: fakeClient(),
      executablePath: "/mock/pine-computer-use",
      getApprovalMode: () => "YOLO",
      getGate: () => null,
    });
    if (typeof extension === "function")
      throw new Error("Expected named extension");
    await extension.factory({
      getActiveTools: () => ["read", ACTIVATE_COMPUTER_USE_TOOL_NAME],
      registerTool: (tool: ToolDefinition) => registered.push(tool as never),
      setActiveTools,
    } as never);

    expect(registered[0]?.name).toBe(ACTIVATE_COMPUTER_USE_TOOL_NAME);
    expect(registered).toHaveLength(1 + COMPUTER_USE_DYNAMIC_TOOL_NAMES.length);
    expect(registered.map((tool) => tool.name)).toEqual([
      ACTIVATE_COMPUTER_USE_TOOL_NAME,
      ...COMPUTER_USE_DYNAMIC_TOOL_NAMES,
    ]);
    expect(MUNIM_COMPUTER_USE_TOOL_NAMES).toHaveLength(28);

    await registered[0]?.execute();

    expect(setActiveTools).toHaveBeenCalledWith([
      "read",
      ACTIVATE_COMPUTER_USE_TOOL_NAME,
      ...COMPUTER_USE_DYNAMIC_TOOL_NAMES,
    ]);
    expect(activated).toHaveBeenCalledOnce();
  });
});
