import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import type { SandboxRuntimeConfig } from "@anthropic-ai/sandbox-runtime";
import hostSource from "./host.mjs?raw";

export function quoteShell(
  value: string,
  shell: "powershell" | "zsh" = "zsh",
): string {
  return shell === "powershell"
    ? `'${value.replaceAll("'", "''")}'`
    : `'${value.replaceAll("'", "'\\''")}'`;
}

export interface SandboxRequest {
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  config: SandboxRuntimeConfig;
  shell?: string;
  stdin?: string;
}

export class SandboxSetupError extends Error {}

/** A fresh host process per invocation prevents global SRT policy/proxy races. */
export async function runSandbox(
  request: SandboxRequest,
  options: {
    onData: (data: Buffer) => void;
    onStderr?: (data: Buffer) => void;
    signal?: AbortSignal;
    timeout?: number;
  },
): Promise<{ exitCode: number }> {
  if (process.platform !== "darwin" && process.platform !== "win32") {
    throw new SandboxSetupError(
      "The sandbox backend has not been validated on this platform. Native execution requires explicit approval.",
    );
  }
  if (options.signal?.aborted) throw new Error("aborted");
  if (
    options.timeout !== undefined &&
    (!Number.isFinite(options.timeout) || options.timeout <= 0)
  ) {
    throw new Error("Invalid timeout: must be a positive number");
  }
  const runtimeEntry = createRequire(import.meta.url).resolve(
    "@anthropic-ai/sandbox-runtime",
  );
  const runtimeUrl = pathToFileURL(runtimeEntry).href;
  let dependencyRoot = path.dirname(runtimeEntry);
  while (path.basename(dependencyRoot) !== "node_modules") {
    const parent = path.dirname(dependencyRoot);
    if (parent === dependencyRoot)
      throw new SandboxSetupError(
        "Cannot locate the trusted sandbox runtime dependency tree.",
      );
    dependencyRoot = parent;
  }
  const config = structuredClone(request.config);
  // A project can contain Pine's development dependency tree. Sandboxed code
  // must never rewrite the supervisor's next import into an unsandboxed host.
  config.filesystem.denyWrite.push(dependencyRoot, process.execPath);
  const child = spawn(
    process.execPath,
    ["--input-type=module", "-e", hostSource],
    {
      cwd: request.cwd,
      env: {
        ...request.env,
        ELECTRON_RUN_AS_NODE: "1",
        // SRT's own temp override is scoped to this supervisor, never global.
        CLAUDE_CODE_TMPDIR: request.env.TMPDIR,
      },
      detached: true,
      stdio: ["pipe", "pipe", "pipe", "pipe"],
    },
  );
  child.stdin.on("error", () => undefined);
  child.stdin.end(
    JSON.stringify({ ...request, config, runtimeUrl, id: randomUUID() }),
  );
  let status = "";
  child.stdio[3]!.on("data", (chunk: Buffer) => {
    status = (status + chunk.toString()).slice(-65_536);
  });
  child.stdout.on("data", options.onData);
  child.stderr.on("data", options.onStderr ?? options.onData);
  let timedOut = false;
  let killTimer: NodeJS.Timeout | undefined;
  let drainTimer: NodeJS.Timeout | undefined;
  const abort = () => {
    child.kill("SIGTERM");
    killTimer ??= setTimeout(() => child.kill("SIGKILL"), 2_000);
  };
  const timer =
    options.timeout === undefined
      ? undefined
      : setTimeout(
          () => {
            timedOut = true;
            abort();
          },
          Math.min(options.timeout * 1_000, 2_147_483_647),
        );
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  child.once("exit", () => {
    drainTimer = setTimeout(() => {
      child.stdout.destroy();
      child.stderr.destroy();
      child.stdio[3]!.destroy();
    }, 1_000);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", () => resolve());
    });
    if (options.signal?.aborted) throw new Error("aborted");
    if (timedOut) throw new Error(`timeout:${options.timeout}`);
    let result: {
      kind?: string;
      message?: string;
      exitCode?: number | null;
      signal?: string;
    };
    try {
      result = JSON.parse(status) as typeof result;
    } catch {
      throw new SandboxSetupError(
        "Sandbox supervisor exited without a result. The command was not retried natively.",
      );
    }
    if (result.kind !== "exit")
      throw new SandboxSetupError(
        `Sandbox setup failed: ${result.message ?? "unknown error"}`,
      );
    if (typeof result.exitCode !== "number")
      throw new Error(
        `Shell terminated by signal ${result.signal ?? "unknown"}.`,
      );
    return { exitCode: result.exitCode };
  } finally {
    if (timer) clearTimeout(timer);
    if (killTimer) clearTimeout(killTimer);
    if (drainTimer) clearTimeout(drainTimer);
    options.signal?.removeEventListener("abort", abort);
  }
}
