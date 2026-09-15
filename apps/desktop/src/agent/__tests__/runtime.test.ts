import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { Api, AssistantMessage, Model } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  attachedPathsFromSessionEntries,
  authorizationGrantsFromSessionEntries,
  buildGateTurnContext,
  judgeStreamOptions,
  normalizeGeneratedTitle,
  parseJudgeRulings,
  PineAgentRuntime,
  JUDGE_SYSTEM_PROMPT,
  projectSessionDirectory,
  recommendedCompactionReserveTokens,
  titleFromAssistantMessage,
  toolNamesForApprovalMode,
  toolNamesForComputerUseState,
} from "../runtime";
import { serializeAttachmentMessage } from "../../shared/attachments";
import { ACTIVATE_COMPUTER_USE_TOOL_NAME } from "../computer-use/tools";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("attachedPathsFromSessionEntries", () => {
  it("restores only attachment blocks from user messages", () => {
    const attachment = {
      extension: "txt",
      kind: "file" as const,
      modifiedAt: "2026-09-02T12:00:00.000Z",
      name: "context.txt",
      path: "/tmp/context.txt",
      size: 12,
    };
    const block = serializeAttachmentMessage([attachment], "Read it.");

    expect(
      attachedPathsFromSessionEntries([
        { type: "message", message: { role: "user", content: block } },
        { type: "message", message: { role: "assistant", content: block } },
        {
          type: "message",
          message: { role: "user", content: [{ type: "text", text: block }] },
        },
      ]),
    ).toEqual(["/tmp/context.txt"]);
  });
});

describe("approval context", () => {
  it("keeps user authority and causal events without exposing raw thinking", () => {
    const entries = [
      {
        type: "message",
        id: "user-root",
        message: { role: "user", content: "Refactor the approval flow." },
      },
      {
        type: "message",
        id: "assistant-1",
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "private chain of thought" },
            { type: "text", text: "I will inspect the gate." },
            {
              type: "toolCall",
              id: "tool-1",
              name: "bash",
              arguments: { command: "bun test" },
            },
          ],
        },
      },
      {
        type: "message",
        id: "tool-result-1",
        message: {
          role: "toolResult",
          toolCallId: "tool-1",
          toolName: "bash",
          content: [{ type: "text", text: "permission denied" }],
          isError: true,
        },
      },
      {
        type: "message",
        id: "user-latest",
        message: { role: "user", content: "Proceed with steps one to four." },
      },
    ] as never[];

    const context = buildGateTurnContext(entries, []);

    expect(context.rootGoal).toEqual({
      id: "user-root",
      text: "Refactor the approval flow.",
    });
    expect(context.recentUserStatements).toEqual([
      { id: "user-latest", text: "Proceed with steps one to four." },
    ]);
    expect(JSON.stringify(context)).toContain("I will inspect the gate");
    expect(JSON.stringify(context)).toContain("permission denied");
    expect(JSON.stringify(context)).not.toContain("private chain of thought");
  });

  it("restores only validated authorization grant entries", () => {
    const grant = {
      id: "grant-1",
      source: "user" as const,
      scope: "once" as const,
      toolName: "privileged_bash",
      subject: "open -a Finder",
      actionDigest: "abc123",
      createdAt: "2026-09-11T00:00:00.000Z",
    };
    expect(
      authorizationGrantsFromSessionEntries([
        {
          type: "custom",
          customType: "pine.authorization-grant",
          data: grant,
        },
        {
          type: "custom",
          customType: "pine.authorization-grant",
          data: { subject: "incomplete" },
        },
      ]),
    ).toEqual([grant]);
  });

  it("keeps older events that match the reviewed subject", () => {
    const entries = [
      {
        type: "message",
        id: "root",
        message: { role: "user", content: "Diagnose the build." },
      },
      {
        type: "message",
        id: "relevant-old-event",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "The failing target is packages/compiler." },
          ],
        },
      },
      ...Array.from({ length: 9 }, (_, index) => ({
        type: "message",
        id: `recent-${index}`,
        message: {
          role: "assistant",
          content: [{ type: "text", text: `Unrelated event ${index}` }],
        },
      })),
    ] as never[];

    const context = buildGateTurnContext(entries, [], undefined, [
      "rm -rf packages/compiler",
    ]);

    expect(context.recentEvents.map((event) => event.id)).toContain(
      "relevant-old-event",
    );
  });
});

describe("Computer Use judge guidance", () => {
  it("teaches the automatic reviewer how native UI calls differ from sandboxed shell work", () => {
    expect(JUDGE_SYSTEM_PROMPT).toContain(
      "Computer Use calls need a separate review lens",
    );
    expect(JUDGE_SYSTEM_PROMPT).toContain(
      "observation-only Computer Use calls",
    );
    expect(JUDGE_SYSTEM_PROMPT).toContain(
      "Activation only loads the capability",
    );
    expect(JUDGE_SYSTEM_PROMPT).toContain("browser_use_tab");
  });
});

describe("judgeStreamOptions", () => {
  const signal = new AbortController().signal;
  const modelWithApi = (api: Api) => ({ api }) as unknown as Model<Api>;

  it("disables reasoning wherever the API exposes a switch", () => {
    expect(
      judgeStreamOptions(modelWithApi("anthropic-messages"), signal),
    ).toEqual({ signal, thinkingEnabled: false });
    expect(
      judgeStreamOptions(modelWithApi("openai-responses"), signal),
    ).toEqual({ signal, reasoningEffort: "minimal" });
    // Omitting options is the off state for completions-family formats;
    // passing an effort would enable thinking.
    expect(
      judgeStreamOptions(modelWithApi("openai-completions"), signal),
    ).toEqual({ signal });
  });
});

describe("normalizeGeneratedTitle", () => {
  it("keeps only a bounded, unquoted first line", () => {
    expect(normalizeGeneratedTitle('  "初始会话标题。"\n额外解释')).toBe(
      "初始会话标题",
    );
    expect(normalizeGeneratedTitle(" ")).toBeUndefined();
    expect([...normalizeGeneratedTitle("a".repeat(80))!]).toHaveLength(60);
  });

  it("preserves complete Chinese, English, and mixed-language titles", () => {
    for (const title of [
      "编码任务与操作任务的区别",
      "循环变换器与 GPT-6 新模型对比",
      "Improve TinyFish web search support for Pine",
    ]) {
      expect(normalizeGeneratedTitle(title)).toBe(title);
    }
  });
});

describe("recommendedCompactionReserveTokens", () => {
  it("triggers at 80% for ordinary context windows", () => {
    expect(recommendedCompactionReserveTokens(128_000)).toBe(25_600);
    expect(recommendedCompactionReserveTokens(400_000)).toBe(80_000);
  });

  it("caps the trigger threshold at 400K tokens", () => {
    expect(recommendedCompactionReserveTokens(1_000_000)).toBe(600_000);
  });
});

describe("titleFromAssistantMessage", () => {
  it("accepts only the structured submit_title tool result", () => {
    const message = {
      role: "assistant",
      content: [
        {
          type: "toolCall",
          id: "title-call",
          name: "submit_title",
          arguments: { title: "Dedicated Utility Model" },
        },
      ],
    } as unknown as AssistantMessage;

    expect(titleFromAssistantMessage(message)).toBe("Dedicated Utility Model");
    expect(
      titleFromAssistantMessage({
        ...message,
        content: [{ type: "text", text: "Unexpected prose" }],
      }),
    ).toBeUndefined();
    expect(
      titleFromAssistantMessage({
        ...message,
        content: [
          {
            type: "toolCall",
            id: "title-call",
            name: "submit_title",
            arguments: { title: "Title", explanation: "Unexpected" },
          },
        ],
      } as unknown as AssistantMessage),
    ).toBeUndefined();
  });
});

describe("toolNamesForApprovalMode", () => {
  const tools = ["read", "bash", "edit", "write", "privileged_bash"];

  it("removes ordinary bash in yolo mode", () => {
    expect(toolNamesForApprovalMode(tools, "YOLO")).toEqual([
      "read",
      "edit",
      "write",
      "privileged_bash",
    ]);
  });

  it("restores ordinary bash before privileged bash", () => {
    expect(
      toolNamesForApprovalMode(
        ["read", "edit", "write", "privileged_bash"],
        "auto-approve",
      ),
    ).toEqual(tools);
  });

  it("only exposes TinyFish tools when a credential is configured", () => {
    const activeTools = [
      "read",
      "bash",
      "edit",
      "write",
      "web_search",
      "web_fetch",
    ];
    expect(
      toolNamesForApprovalMode(activeTools, "auto-approve", false),
    ).toEqual(["read", "bash", "edit", "write"]);
    expect(toolNamesForApprovalMode(activeTools, "auto-approve", true)).toEqual(
      [...activeTools],
    );
  });
});

describe("toolNamesForComputerUseState", () => {
  const tools = [
    "read",
    "activate_computer_use",
    "request_computer_use_permissions",
    "list_apps",
    "browser_open_tab",
  ];

  it("keeps only the activator visible before Computer Use is activated", () => {
    expect(toolNamesForComputerUseState(tools, false)).toEqual([
      "read",
      "activate_computer_use",
    ]);
  });

  it("restores every registered Computer Use tool after activation", () => {
    expect(toolNamesForComputerUseState(tools, true)).toEqual(tools);
  });
});

describe("parseJudgeRulings", () => {
  it("parses one ordered ruling for every expected tool call", () => {
    expect(
      parseJudgeRulings(
        {
          rulings: [
            {
              toolCallId: "p2",
              verdict: "deny",
              reason: " unsafe ",
            },
            {
              toolCallId: "p1",
              verdict: "needs_user",
              reason: " expected ",
              scope: "once",
            },
          ],
        },
        ["p1", "p2"],
      ),
    ).toEqual([
      { toolCallId: "p2", verdict: "deny", reason: "unsafe" },
      {
        toolCallId: "p1",
        verdict: "needs_user",
        reason: "expected",
        scope: "once",
      },
    ]);
  });

  it("rejects omitted, duplicate, and unknown tool call IDs", () => {
    expect(() =>
      parseJudgeRulings({ rulings: [{ toolCallId: "p1", verdict: "allow" }] }, [
        "p1",
        "p2",
      ]),
    ).toThrow("one ruling per tool call");
    expect(() =>
      parseJudgeRulings(
        {
          rulings: [
            { toolCallId: "p1", verdict: "allow" },
            { toolCallId: "p1", verdict: "deny" },
          ],
        },
        ["p1", "p2"],
      ),
    ).toThrow("malformed");
    expect(() =>
      parseJudgeRulings(
        { rulings: [{ toolCallId: "unknown", verdict: "allow" }] },
        ["p1"],
      ),
    ).toThrow("malformed");
  });
});

describe("PineAgentRuntime", () => {
  it("registers hidden Computer Use tools without exposing them initially", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pine-agent-runtime-"));
    temporaryDirectories.push(root);
    const location = {
      agentDir: path.join(root, "agent"),
      cwd: path.join(root, "source"),
      folders: [
        {
          access: "read-write" as const,
          path: path.join(root, "source"),
        },
      ],
      sessionsRoot: path.join(root, "sessions"),
    };
    await mkdir(location.cwd, { recursive: true });
    const runtime = new PineAgentRuntime({ emit: () => undefined });

    try {
      const created = await runtime.createSession(location);
      const liveSessions = (
        runtime as unknown as {
          liveSessions: Map<string, { session: AgentSession }>;
        }
      ).liveSessions;
      const agentSession = liveSessions.get(created.session.id)?.session;

      expect(agentSession?.getAllTools().map((tool) => tool.name)).toContain(
        "list_apps",
      );
      expect(agentSession?.getActiveToolNames()).toContain(
        ACTIVATE_COMPUTER_USE_TOOL_NAME,
      );
      expect(agentSession?.getActiveToolNames()).not.toContain("list_apps");
    } finally {
      await runtime.dispose();
    }
  });

  it("returns the session as soon as prompt preflight succeeds", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pine-agent-runtime-"));
    temporaryDirectories.push(root);
    const location = {
      agentDir: path.join(root, "agent"),
      cwd: path.join(root, "source"),
      folders: [
        {
          access: "read-write" as const,
          path: path.join(root, "source"),
        },
      ],
      sessionsRoot: path.join(root, "sessions"),
    };
    await mkdir(location.cwd, { recursive: true });
    const runtime = new PineAgentRuntime({ emit: () => undefined });

    try {
      const created = await runtime.createSession(location);
      const liveSessions = (
        runtime as unknown as {
          liveSessions: Map<string, { session: AgentSession }>;
        }
      ).liveSessions;
      const agentSession = liveSessions.get(created.session.id)?.session;
      expect(agentSession).toBeDefined();
      let finishRun: (() => void) | undefined;
      const running = new Promise<void>((resolve) => {
        finishRun = resolve;
      });
      vi.spyOn(agentSession!, "prompt").mockImplementation(
        async (_message, options) => {
          options?.preflightResult?.(true);
          await running;
        },
      );

      await expect(
        runtime.prompt(created.session.id, "Start"),
      ).resolves.toEqual(
        expect.objectContaining({
          accepted: true,
          session: expect.objectContaining({ id: created.session.id }),
        }),
      );
      finishRun?.();
    } finally {
      await runtime.dispose();
    }
  });

  it("dequeues one steering message while preserving the rest of both queues", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pine-agent-runtime-"));
    temporaryDirectories.push(root);
    const location = {
      agentDir: path.join(root, "agent"),
      cwd: path.join(root, "source"),
      folders: [
        {
          access: "read-write" as const,
          path: path.join(root, "source"),
        },
      ],
      sessionsRoot: path.join(root, "sessions"),
    };
    await mkdir(location.cwd, { recursive: true });
    const runtime = new PineAgentRuntime({ emit: () => undefined });

    try {
      const created = await runtime.createSession(location);
      const liveSessions = (
        runtime as unknown as {
          liveSessions: Map<string, { session: AgentSession }>;
        }
      ).liveSessions;
      const agentSession = liveSessions.get(created.session.id)?.session;
      expect(agentSession).toBeDefined();
      await agentSession?.steer("Keep this steering");
      await agentSession?.steer("Restore this steering");
      await agentSession?.followUp("Keep this follow-up");

      await expect(
        runtime.dequeueSteering(created.session.id, "Restore this steering"),
      ).resolves.toEqual({
        message: "Restore this steering",
        removed: true,
      });
      expect(agentSession?.getSteeringMessages()).toEqual([
        "Keep this steering",
      ]);
      expect(agentSession?.getFollowUpMessages()).toEqual([
        "Keep this follow-up",
      ]);
    } finally {
      await runtime.dispose();
    }
  });

  it("creates persistent SDK sessions in the project session directory", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pine-agent-runtime-"));
    temporaryDirectories.push(root);
    const location = {
      agentDir: path.join(root, "agent"),
      cwd: path.join(root, "source"),
      folders: [
        {
          access: "read-write" as const,
          path: path.join(root, "source"),
        },
      ],
      sessionsRoot: path.join(root, "sessions"),
    };
    await mkdir(location.cwd, { recursive: true });
    const runtime = new PineAgentRuntime({ emit: () => undefined });

    try {
      const result = await runtime.createSession(location);
      const liveSessions = (
        runtime as unknown as {
          liveSessions: Map<string, { session: AgentSession }>;
        }
      ).liveSessions;

      expect(result.session.messageCount).toBe(0);
      expect(liveSessions.get(result.session.id)?.session.steeringMode).toBe(
        "all",
      );
      expect(result.sessionFile).toContain(
        projectSessionDirectory(location.sessionsRoot, location.cwd),
      );
      expect(result.sessionFile).toMatch(/\.jsonl$/);
    } finally {
      await runtime.dispose();
    }
  });

  it("renames a live session through its session manager", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pine-agent-runtime-"));
    temporaryDirectories.push(root);
    const location = {
      agentDir: path.join(root, "agent"),
      cwd: path.join(root, "source"),
      folders: [
        {
          access: "read-write" as const,
          path: path.join(root, "source"),
        },
      ],
      sessionsRoot: path.join(root, "sessions"),
    };
    await mkdir(location.cwd, { recursive: true });
    const runtime = new PineAgentRuntime({ emit: () => undefined });

    try {
      const created = await runtime.createSession(location);
      const renamed = runtime.renameSession(
        created.session.id,
        "Renamed session",
      );

      expect(renamed.session.name).toBe("Renamed session");
    } finally {
      await runtime.dispose();
    }
  });
});
