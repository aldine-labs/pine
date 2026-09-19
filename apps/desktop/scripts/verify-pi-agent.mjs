#!/usr/bin/env node
/**
 * Boots a real agent session against a local mock provider and asserts that the
 * outgoing request still carries the system prompt and the tool definitions.
 *
 * This exists because the Pi packages share contracts that no type error
 * protects: overlaying only `pi-ai` from upstream `main` kept every import
 * working while the agent silently sent requests with no tools and no system
 * prompt. `sync:pi` runs this after installing an overlay, so that class of
 * breakage fails the sync instead of reaching the app.
 *
 * Usage: bun run verify:pi   (also run automatically by sync:pi)
 */
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const REQUEST_TIMEOUT_MS = 30_000;

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address === "string" || address === null) {
        reject(new Error("The mock provider did not bind a TCP port."));
        return;
      }
      resolve(address.port);
    });
  });
}

/** Minimal OpenAI-compatible streaming response, enough for one text turn. */
function replyWithText(response, text) {
  response.writeHead(200, {
    "cache-control": "no-cache",
    "content-type": "text/event-stream",
  });
  for (const chunk of [
    { delta: { content: text, role: "assistant" }, finish_reason: null },
    { delta: {}, finish_reason: "stop" },
  ]) {
    response.write(
      `data: ${JSON.stringify({
        choices: [{ ...chunk, index: 0 }],
        created: 0,
        id: "mock",
        model: "mock",
        object: "chat.completion.chunk",
      })}\n\n`,
    );
  }
  response.write("data: [DONE]\n\n");
  response.end();
}

async function createAgentDirectory(port) {
  const agentDir = await mkdtemp(path.join(os.tmpdir(), "pine-verify-agent-"));
  const provider = {
    api: "openai-completions",
    apiKey: "verify-key",
    baseUrl: `http://127.0.0.1:${port}/v1`,
    models: [
      {
        contextWindow: 128_000,
        id: "verify-model",
        input: ["text"],
        maxTokens: 8_192,
        name: "Verify Model",
      },
    ],
    name: "Verify Provider",
  };
  await writeFile(
    path.join(agentDir, "models.json"),
    `${JSON.stringify({ providers: { verify: provider } }, null, 2)}\n`,
  );
  await writeFile(
    path.join(agentDir, "settings.json"),
    `${JSON.stringify(
      { defaultModel: "verify-model", defaultProvider: "verify" },
      null,
      2,
    )}\n`,
  );
  await mkdir(path.join(agentDir, "sessions"), { recursive: true });
  return agentDir;
}

async function main() {
  const {
    createAgentSession,
    DefaultResourceLoader,
    ModelRuntime,
    SessionManager,
    SettingsManager,
    defineTool,
  } = await import("@earendil-works/pi-coding-agent");
  const { Type } = await import("typebox");

  let captured;
  const server = http.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      try {
        const payload = JSON.parse(body);
        captured = {
          messageCount: Array.isArray(payload.messages)
            ? payload.messages.length
            : 0,
          systemPrompt: Array.isArray(payload.messages)
            ? (payload.messages.find((message) => message?.role === "system")
                ?.content ?? null)
            : null,
          toolNames: Array.isArray(payload.tools)
            ? payload.tools.map((tool) => tool?.function?.name).filter(Boolean)
            : [],
        };
      } catch (error) {
        captured = { error: String(error) };
      }
      replyWithText(response, "ok");
    });
  });

  const port = await listen(server);
  const agentDir = await createAgentDirectory(port);
  const cwd = await mkdtemp(path.join(os.tmpdir(), "pine-verify-project-"));

  try {
    const modelRuntime = await ModelRuntime.create({
      allowModelNetwork: false,
      authPath: path.join(agentDir, "auth.json"),
      modelsPath: path.join(agentDir, "models.json"),
      modelsStorePath: path.join(agentDir, "models-store.json"),
    });
    const settingsManager = SettingsManager.create(cwd, agentDir, {
      projectTrusted: false,
    });
    const resourceLoader = new DefaultResourceLoader({
      agentDir,
      cwd,
      noExtensions: true,
      noSkills: true,
      noThemes: true,
      settingsManager,
    });
    await resourceLoader.reload();
    const sessionManager = SessionManager.create(
      cwd,
      path.join(agentDir, "sessions"),
    );
    const probe = defineTool({
      description: "Tool used by the Pi sync verification.",
      execute: () => ({
        content: [{ text: "ok", type: "text" }],
        details: {},
      }),
      label: "Verify Probe",
      name: "verify_probe",
      parameters: Type.Object({ value: Type.Optional(Type.String()) }),
    });

    const { session } = await createAgentSession({
      agentDir,
      cwd,
      customTools: [probe],
      modelRuntime,
      resourceLoader,
      sessionManager,
      settingsManager,
    });

    const active = session.getActiveToolNames();
    if (!active.includes("verify_probe")) {
      throw new Error(
        `The agent registered no custom tools (active: ${JSON.stringify(active)}).`,
      );
    }

    const done = new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("The mock provider saw no request.")),
        REQUEST_TIMEOUT_MS,
      );
      const unsubscribe = session.subscribe((event) => {
        if (event.type === "agent_settled" || event.type === "agent_end") {
          clearTimeout(timer);
          unsubscribe();
          resolve(undefined);
        }
      });
      session.prompt("ping").then(() => {}, reject);
    });
    await done;

    if (!captured || captured.error) {
      throw new Error(
        `The request body could not be inspected: ${JSON.stringify(captured)}`,
      );
    }
    if (captured.toolNames.length === 0) {
      throw new Error(
        "The agent sent a request without tools; upstream changed the stream contract.",
      );
    }
    if (!captured.systemPrompt) {
      throw new Error(
        "The agent sent a request without a system prompt; upstream changed the stream contract.",
      );
    }
    process.stdout.write(
      `[pi-verify] ok: ${captured.toolNames.length} tools, system prompt ${captured.systemPrompt.length} chars\n`,
    );
  } finally {
    server.close();
  }
}

try {
  await main();
} catch (error) {
  process.stderr.write(
    `[pi-verify] failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
}
