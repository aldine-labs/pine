// Trusted persistent Windows supervisor. Requests are serialized over stdin;
// SRT policy, WFP verification, proxies, and ACL grants stay alive between
// commands that share the exact same authority snapshot.
import { spawn } from "node:child_process";
import { writeSync } from "node:fs";
import { mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

let manager;
let currentChild;
let controlDirectory;
let initializedKey;
let stopping = false;

const report = (result) => writeSync(3, `${JSON.stringify(result)}\n`);

const stop = () => {
  stopping = true;
  process.stdin.destroy();
  try {
    currentChild?.kill();
  } catch {}
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);

async function initialize(request) {
  const startedAt = performance.now();
  const key = JSON.stringify({
    config: request.config,
    runtimeUrl: request.runtimeUrl,
    cwd: request.cwd,
  });
  if (manager) {
    if (key !== initializedKey)
      throw new Error("Persistent Windows sandbox authority changed.");
    return {
      coldStart: false,
      initializeMs: performance.now() - startedAt,
    };
  }
  controlDirectory = await mkdtemp(path.join(os.tmpdir(), "pine-srt-"));
  const runtime = await import(request.runtimeUrl);
  manager = runtime.SandboxManager;
  const config = runtime.SandboxRuntimeConfigSchema.parse(request.config);
  // New request files inherit this read-only grant. Keeping one directory for
  // the host avoids a fresh ACL round-trip for every file operation.
  config.filesystem.allowRead.push(controlDirectory);
  await manager.initialize(config, undefined, false);
  initializedKey = key;
  return {
    coldStart: true,
    initializeMs: performance.now() - startedAt,
  };
}

async function run(request) {
  const startedAt = performance.now();
  let requestFile;
  try {
    const initialization = await initialize(request);
    const initializedAt = performance.now();
    if (stopping) throw new Error("aborted");
    const direct = request.windowsDirect;
    if (direct?.stdinFileEnvironment) {
      requestFile = path.join(controlDirectory, `${request.id}.json`);
      await writeFile(requestFile, request.stdin ?? "", {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      direct.env = {
        ...direct.env,
        [direct.stdinFileEnvironment]: requestFile,
      };
    }
    const requestFileReadyAt = performance.now();
    const wrapped = await manager.wrapWithSandboxArgv(
      request.command,
      direct
        ? { exe: direct.executable, args: direct.args }
        : (request.shell ?? "powershell"),
      undefined,
      undefined,
      request.cwd,
      { commandId: request.id },
    );
    if (direct?.env) {
      const separator = wrapped.argv.lastIndexOf("--");
      if (separator < 0)
        throw new Error("Windows sandbox command delimiter is missing.");
      const environmentArguments = Object.entries(direct.env).flatMap(
        ([name, value]) => ["--env", `${name}=${value}`],
      );
      wrapped.argv.splice(separator, 0, ...environmentArguments);
    }
    const wrappedAt = performance.now();
    currentChild = spawn(wrapped.argv[0], wrapped.argv.slice(1), {
      cwd: request.cwd,
      env: wrapped.env,
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "inherit", "inherit"],
    });
    currentChild.stdin.on("error", () => undefined);
    currentChild.stdin.end(
      direct?.stdinFileEnvironment ? "" : (request.stdin ?? ""),
    );
    const result = await new Promise((resolve, reject) => {
      currentChild.once("error", reject);
      currentChild.once("close", (exitCode, signal) =>
        resolve({ exitCode, signal }),
      );
    });
    const childClosedAt = performance.now();
    if (stopping) throw new Error("aborted");
    report({
      id: request.id,
      kind: "exit",
      ...result,
      timing: {
        ...initialization,
        requestFileMs: requestFileReadyAt - initializedAt,
        wrapMs: wrappedAt - requestFileReadyAt,
        childMs: childClosedAt - wrappedAt,
        totalMs: childClosedAt - startedAt,
      },
    });
  } catch (error) {
    report({
      id: request.id,
      kind: "setup-error",
      message: String(error?.message ?? error),
    });
  } finally {
    currentChild = undefined;
    if (requestFile) await unlink(requestFile).catch(() => undefined);
  }
}

let input = "";
try {
  for await (const chunk of process.stdin) {
    input += chunk;
    for (;;) {
      const newline = input.indexOf("\n");
      if (newline < 0) break;
      const line = input.slice(0, newline);
      input = input.slice(newline + 1);
      if (line) await run(JSON.parse(line));
      if (stopping) break;
    }
    if (stopping) break;
  }
} finally {
  await manager?.reset();
  if (controlDirectory)
    await rm(controlDirectory, { recursive: true, force: true });
}
