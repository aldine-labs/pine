// @vitest-environment node
import {
  BACKGROUND_CONTEXT,
  branchTip,
  insertEntry,
  JsonlSessionRepo,
  setValue,
  type AgentMessage,
  type JsonlSessionMetadata,
  type Session,
} from "@earendil-works/pi-agent-core";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";
import {
  fauxAssistantMessage,
  fauxThinking,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  PINE_APPROVAL_MODE_ENTRY,
  type PineTextMessage,
} from "../../shared/sessions";
import { ProjectSessionService } from "../sessions";

const temporaryDirectories: string[] = [];

async function createTemporaryProjectData(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pine-sessions-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function serviceOptions(rootPath: string) {
  return {
    cacheRoot: path.join(rootPath, "cache"),
    cwd: path.join(rootPath, "source"),
    sessionsRoot: path.join(rootPath, "sessions"),
  };
}

function textOf(message: Pick<PineTextMessage, "blocks">): string {
  return message.blocks
    .map((block) => (block.type === "text" ? (block.text ?? "") : ""))
    .join("");
}

function createRepository(
  environment: NodeExecutionEnv,
  sessionsRoot: string,
): JsonlSessionRepo {
  return new JsonlSessionRepo({ fileSystem: environment, sessionsRoot });
}

async function createSession(
  repository: JsonlSessionRepo,
  cwd: string,
): Promise<Session<JsonlSessionMetadata>> {
  const session = await repository.create({ cwd }, BACKGROUND_CONTEXT);
  await session.createBranch("main", null, BACKGROUND_CONTEXT);
  return session;
}

async function mainBranch(
  session: Session<JsonlSessionMetadata>,
): Promise<NonNullable<Awaited<ReturnType<typeof session.branch>>>> {
  const branch = await session.branch("main", BACKGROUND_CONTEXT);
  if (!branch) throw new Error("Expected a main session branch.");
  return branch;
}

async function appendMessage(
  session: Session<JsonlSessionMetadata>,
  message: AgentMessage,
): Promise<void> {
  await (await mainBranch(session)).appendMessage(message, BACKGROUND_CONTEXT);
}

async function appendCustomEntry(
  session: Session<JsonlSessionMetadata>,
  customType: string,
  data: Record<string, string>,
): Promise<void> {
  await (
    await mainBranch(session)
  ).appendCustomEntry(customType, data, BACKGROUND_CONTEXT);
}

async function appendCompaction(
  session: Session<JsonlSessionMetadata>,
  summary: string,
  tokensBefore: number,
): Promise<void> {
  const branch = await mainBranch(session);
  const parentId = await branch.getTipId(BACKGROUND_CONTEXT);
  const id = session.idGenerator.next();
  await session.mutate(async (mutator) => {
    await mutator.commit(
      [
        insertEntry({
          id,
          parentId,
          type: "compaction",
          summary,
          retainedTail: [],
          tokensBefore,
          fromHook: false,
        }),
        setValue(branchTip("main"), id),
      ],
      BACKGROUND_CONTEXT,
    );
  }, BACKGROUND_CONTEXT);
}

describe("ProjectSessionService", () => {
  it("creates a new persistent Pi session", async () => {
    const rootPath = await createTemporaryProjectData();
    const options = serviceOptions(rootPath);
    await mkdir(options.cwd, { recursive: true });
    const service = await ProjectSessionService.create(options);

    try {
      const { session, summary } = await service.createSession();

      expect(session.metadata.id).toBe(summary.id);
      expect(summary.messageCount).toBe(0);
      await expect(service.search("")).resolves.toEqual([]);
    } finally {
      await service.dispose();
    }
  });

  it("searches session names and message content in English and Chinese", async () => {
    const rootPath = await createTemporaryProjectData();
    const options = serviceOptions(rootPath);
    await mkdir(options.cwd, { recursive: true });
    const environment = new NodeExecutionEnv({ cwd: options.cwd });
    const repository = createRepository(environment, options.sessionsRoot);
    await createSession(repository, path.join(rootPath, "other-source"));
    const session = await createSession(repository, options.cwd);
    await session.setName("Search architecture", BACKGROUND_CONTEXT);
    await appendMessage(session, {
      role: "user",
      content: "Investigate SQLite 全文搜索 for previous sessions",
      timestamp: Date.now(),
    });
    const metadata = session.metadata;
    const service = await ProjectSessionService.create(options);

    try {
      await expect(service.search("")).resolves.toEqual([
        expect.objectContaining({ id: metadata.id }),
      ]);
      await expect(
        repository.list(undefined, BACKGROUND_CONTEXT),
      ).resolves.toEqual([expect.objectContaining({ id: metadata.id })]);
      await expect(service.search("SQLite")).resolves.toEqual([
        expect.objectContaining({
          id: metadata.id,
          name: "Search architecture",
        }),
      ]);
      await expect(service.search("全文搜索")).resolves.toEqual([
        expect.objectContaining({ id: metadata.id }),
      ]);
      await expect(service.search("全")).resolves.toEqual([
        expect.objectContaining({ id: metadata.id }),
      ]);

      const resumed = await service.resumeSession(metadata.id);
      expect(resumed.session.metadata.path).toBe(metadata.path);
    } finally {
      await service.dispose();
      await environment.cleanup(BACKGROUND_CONTEXT);
    }
  });

  it("keeps sessions visible after the project's default folder changes", async () => {
    const rootPath = await createTemporaryProjectData();
    const previousCwd = path.join(rootPath, "previous-source");
    const nextCwd = path.join(rootPath, "next-source");
    const sessionsRoot = path.join(rootPath, "sessions");
    await Promise.all([
      mkdir(previousCwd, { recursive: true }),
      mkdir(nextCwd, { recursive: true }),
    ]);
    const environment = new NodeExecutionEnv({ cwd: previousCwd });
    const repository = createRepository(environment, sessionsRoot);
    const previousSession = await createSession(repository, previousCwd);
    await appendMessage(previousSession, {
      role: "user",
      content: "Conversation from the previous default folder",
      timestamp: Date.now(),
    });
    const metadata = previousSession.metadata;
    const service = await ProjectSessionService.create({
      cacheRoot: path.join(rootPath, "cache"),
      cwd: nextCwd,
      sessionsRoot,
    });

    try {
      await expect(service.search("")).resolves.toEqual([
        expect.objectContaining({ id: metadata.id }),
      ]);
      await expect(service.loadMessages(metadata.id)).resolves.toEqual(
        expect.objectContaining({
          messages: [
            expect.objectContaining({
              blocks: [
                {
                  type: "text",
                  text: "Conversation from the previous default folder",
                },
              ],
            }),
          ],
        }),
      );
    } finally {
      await service.dispose();
      await environment.cleanup(BACKGROUND_CONTEXT);
    }
  });

  it("resolves a session JSONL document as a regular file attachment", async () => {
    const rootPath = await createTemporaryProjectData();
    const options = serviceOptions(rootPath);
    await mkdir(options.cwd, { recursive: true });
    const environment = new NodeExecutionEnv({ cwd: options.cwd });
    const repository = createRepository(environment, options.sessionsRoot);
    const session = await createSession(repository, options.cwd);
    await session.setName("Architecture review", BACKGROUND_CONTEXT);
    await appendMessage(session, {
      role: "user",
      content: "Review the event flow",
      timestamp: Date.now(),
    });
    const metadata = session.metadata;
    const service = await ProjectSessionService.create(options);

    try {
      await expect(service.attachmentForSession(metadata.id)).resolves.toEqual(
        expect.objectContaining({
          extension: "jsonl",
          kind: "file",
          name: "Architecture review.jsonl",
          path: metadata.path,
          size: expect.any(Number),
        }),
      );
    } finally {
      await service.dispose();
      await environment.cleanup(BACKGROUND_CONTEXT);
    }
  });

  it("loads text messages backwards with a stable cursor", async () => {
    const rootPath = await createTemporaryProjectData();
    const options = serviceOptions(rootPath);
    await mkdir(options.cwd, { recursive: true });
    const environment = new NodeExecutionEnv({ cwd: options.cwd });
    const repository = createRepository(environment, options.sessionsRoot);
    const session = await createSession(repository, options.cwd);
    for (const content of ["one", "two", "three", "four"]) {
      await appendMessage(session, {
        role: "user",
        content,
        timestamp: Date.now(),
      });
    }
    const metadata = session.metadata;
    const service = await ProjectSessionService.create(options);

    try {
      const newest = await service.loadMessages(metadata.id, undefined, 2);
      expect(newest.messages.map((message) => textOf(message))).toEqual([
        "three",
        "four",
      ]);
      expect(newest.hasMore).toBe(true);

      const earlier = await service.loadMessages(
        metadata.id,
        newest.nextBefore,
        2,
      );
      expect(earlier.messages.map((message) => textOf(message))).toEqual([
        "one",
        "two",
      ]);
      expect(earlier.hasMore).toBe(false);
    } finally {
      await service.dispose();
      await environment.cleanup(BACKGROUND_CONTEXT);
    }
  });

  it("keeps history cursors stable when a legacy session is reopened", async () => {
    const rootPath = await createTemporaryProjectData();
    const options = serviceOptions(rootPath);
    const sessionId = "019cfe51-7166-79b9-a5b9-c652fcca9eab";
    const sessionDirectory = path.join(
      options.sessionsRoot,
      `--${options.cwd.replace(/^[/\\]/u, "").replace(/[/\\:]/gu, "-")}--`,
    );
    await Promise.all([
      mkdir(options.cwd, { recursive: true }),
      mkdir(sessionDirectory, { recursive: true }),
    ]);
    const records = [
      {
        type: "session",
        version: 3,
        id: sessionId,
        timestamp: "2026-01-01T00:00:00.000Z",
        cwd: options.cwd,
      },
      ...["one", "two", "three", "four"].map((content, index) => ({
        type: "message",
        id: `legacy0${index + 1}`,
        parentId: index === 0 ? null : `legacy0${index}`,
        timestamp: `2026-01-01T00:00:0${index + 1}.000Z`,
        message: {
          role: "user",
          content,
          timestamp: Date.UTC(2026, 0, 1, 0, 0, index + 1),
        },
      })),
    ];
    await writeFile(
      path.join(sessionDirectory, `legacy_${sessionId}.jsonl`),
      `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
      "utf8",
    );
    const service = await ProjectSessionService.create(options);

    try {
      const newest = await service.loadMessages(sessionId, undefined, 2);
      expect(newest.messages.map((message) => textOf(message))).toEqual([
        "three",
        "four",
      ]);
      expect(newest.nextBefore).toBe("seq:3");

      // loadMessages intentionally reopens closed sessions. Legacy imports
      // remint entry IDs on every open, but their sequence numbers are stable.
      const earlier = await service.loadMessages(
        sessionId,
        newest.nextBefore,
        2,
      );
      expect(earlier.messages.map((message) => textOf(message))).toEqual([
        "one",
        "two",
      ]);
      expect(earlier.hasMore).toBe(false);
    } finally {
      await service.dispose();
    }
  });

  it("restores thinking duration and completed tool calls", async () => {
    const rootPath = await createTemporaryProjectData();
    const options = serviceOptions(rootPath);
    await mkdir(options.cwd, { recursive: true });
    const environment = new NodeExecutionEnv({ cwd: options.cwd });
    const repository = createRepository(environment, options.sessionsRoot);
    const session = await createSession(repository, options.cwd);
    const toolCallId = "call-read-main";
    await appendMessage(
      session,
      fauxAssistantMessage(
        [
          fauxThinking("Find the relevant file."),
          fauxToolCall(
            "read",
            { path: "/project/src/main.ts" },
            {
              id: toolCallId,
            },
          ),
        ],
        { stopReason: "toolUse", timestamp: Date.now() - 1_500 },
      ),
    );
    await appendMessage(session, {
      role: "toolResult",
      toolCallId,
      toolName: "read",
      content: [{ type: "text", text: "export {}" }],
      isError: false,
      timestamp: Date.now(),
    });
    const metadata = session.metadata;
    const service = await ProjectSessionService.create(options);

    try {
      const result = await service.loadMessages(metadata.id);

      expect(result.messages).toEqual([
        expect.objectContaining({
          thinkingDurationMs: expect.any(Number),
          blocks: [
            { type: "thinking", thinking: "Find the relevant file." },
            {
              type: "toolCall",
              toolCall: expect.objectContaining({
                id: toolCallId,
                name: "read",
                status: "complete",
              }),
            },
          ],
        }),
      ]);
    } finally {
      await service.dispose();
      await environment.cleanup(BACKGROUND_CONTEXT);
    }
  });

  it("exports the complete conversation with persisted settings", async () => {
    const rootPath = await createTemporaryProjectData();
    const options = serviceOptions(rootPath);
    await mkdir(options.cwd, { recursive: true });
    const environment = new NodeExecutionEnv({ cwd: options.cwd });
    const repository = createRepository(environment, options.sessionsRoot);
    const session = await createSession(repository, options.cwd);
    await session.setName("Export me", BACKGROUND_CONTEXT);
    await appendCustomEntry(session, PINE_APPROVAL_MODE_ENTRY, {
      approvalMode: "YOLO",
    });
    await appendMessage(session, {
      role: "user",
      content: "Inspect the project",
      timestamp: Date.now(),
    });
    await appendMessage(session, {
      ...fauxAssistantMessage([{ type: "text", text: "Done." }]),
      provider: "openai",
      model: "gpt-test",
    });
    const metadata = session.metadata;
    const service = await ProjectSessionService.create(options);

    try {
      const result = await service.exportSession(metadata.id, "auto-approve");

      expect(result.fileName).toBe("Export me.md");
      expect(result.markdown).toContain("- Approval mode: YOLO");
      expect(result.markdown).toContain("- Models used:\n  - openai/gpt-test");
      expect(result.markdown).toContain("Inspect the project");
      expect(result.markdown).toContain("Done.");
    } finally {
      await service.dispose();
      await environment.cleanup(BACKGROUND_CONTEXT);
    }
  });

  it("restores assistant request errors from session history", async () => {
    const rootPath = await createTemporaryProjectData();
    const options = serviceOptions(rootPath);
    await mkdir(options.cwd, { recursive: true });
    const environment = new NodeExecutionEnv({ cwd: options.cwd });
    const repository = createRepository(environment, options.sessionsRoot);
    const session = await createSession(repository, options.cwd);
    await appendMessage(
      session,
      fauxAssistantMessage([], {
        stopReason: "error",
        errorMessage: "Provider request failed",
      }),
    );
    const metadata = session.metadata;
    const service = await ProjectSessionService.create(options);

    try {
      await expect(service.loadMessages(metadata.id)).resolves.toEqual({
        hasMore: false,
        messages: [
          expect.objectContaining({
            blocks: [
              {
                type: "error",
                error: { message: "Provider request failed" },
              },
            ],
          }),
        ],
      });
    } finally {
      await service.dispose();
      await environment.cleanup(BACKGROUND_CONTEXT);
    }
  });

  it("restores completed compaction markers from session history", async () => {
    const rootPath = await createTemporaryProjectData();
    const options = serviceOptions(rootPath);
    await mkdir(options.cwd, { recursive: true });
    const environment = new NodeExecutionEnv({ cwd: options.cwd });
    const repository = createRepository(environment, options.sessionsRoot);
    const session = await createSession(repository, options.cwd);
    await appendMessage(session, {
      role: "user",
      content: "A long conversation",
      timestamp: Date.now(),
    });
    await appendCompaction(
      session,
      "The earlier conversation was summarized.",
      25_000,
    );
    const metadata = session.metadata;
    const service = await ProjectSessionService.create(options);

    try {
      const result = await service.loadMessages(metadata.id);

      expect(result.messages).toEqual([
        expect.objectContaining({
          blocks: [{ type: "text", text: "A long conversation" }],
        }),
        expect.objectContaining({
          id: expect.stringMatching(/^compaction-/),
          blocks: [
            {
              type: "compaction",
              compaction: {
                id: expect.any(String),
                status: "complete",
              },
            },
          ],
        }),
      ]);
    } finally {
      await service.dispose();
      await environment.cleanup(BACKGROUND_CONTEXT);
    }
  });

  it("deletes a session and removes it from search", async () => {
    const rootPath = await createTemporaryProjectData();
    const options = serviceOptions(rootPath);
    await mkdir(options.cwd, { recursive: true });
    const environment = new NodeExecutionEnv({ cwd: options.cwd });
    const repository = createRepository(environment, options.sessionsRoot);
    const session = await createSession(repository, options.cwd);
    await appendMessage(session, {
      role: "user",
      content: "Delete this conversation",
      timestamp: Date.now(),
    });
    const metadata = session.metadata;
    const service = await ProjectSessionService.create(options);

    try {
      await expect(service.search("")).resolves.toHaveLength(1);
      await expect(service.deleteSession(metadata.id)).resolves.toBe(true);
      await expect(service.search("")).resolves.toEqual([]);
      await expect(service.deleteSession(metadata.id)).resolves.toBe(false);
    } finally {
      await service.dispose();
      await environment.cleanup(BACKGROUND_CONTEXT);
    }
  });

  it("persists a renamed session and refreshes its search title", async () => {
    const rootPath = await createTemporaryProjectData();
    const options = serviceOptions(rootPath);
    await mkdir(options.cwd, { recursive: true });
    const environment = new NodeExecutionEnv({ cwd: options.cwd });
    const repository = createRepository(environment, options.sessionsRoot);
    const session = await createSession(repository, options.cwd);
    await appendMessage(session, {
      role: "user",
      content: "Original first message",
      timestamp: Date.now(),
    });
    const metadata = session.metadata;
    const service = await ProjectSessionService.create(options);

    try {
      const renamed = await service.renameSession(
        metadata.id,
        "Renamed conversation",
      );

      expect(renamed.name).toBe("Renamed conversation");
      await expect(service.search("Renamed conversation")).resolves.toEqual([
        expect.objectContaining({
          id: metadata.id,
          name: "Renamed conversation",
          preview: "Original first message",
        }),
      ]);
    } finally {
      await service.dispose();
      await environment.cleanup(BACKGROUND_CONTEXT);
    }
  });
});
