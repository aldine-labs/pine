import { AsyncLocalStorage } from "node:async_hooks";
import { constants } from "node:fs";
import path from "node:path";
import type { PineToolAccessPolicy } from "../tool-access-policy";
import { createBashEnvironment, sandboxShell } from "../bash-env";
import { createSandboxConfig } from "./policy";
import { quoteShell, runSandbox } from "./backend";
import fileSource from "./file-worker.mjs?raw";

interface FileExecutionContext {
  signal?: AbortSignal;
  reads: Map<string, { mode: number; value: Promise<Buffer> }>;
  pendingDirectories: Set<string>;
}

type FileWorkerInvoke = (
  operation: string,
  targetPath: string,
  extra?: Record<string, unknown>,
) => Promise<Buffer>;

const execution = new AsyncLocalStorage<FileExecutionContext>();

export function fileWorkerRuntimePaths(
  runtimeFiles: readonly string[],
  executable: string = process.execPath,
  platform: NodeJS.Platform = process.platform,
): string[] {
  return [
    ...runtimeFiles,
    executable,
    // Electron's Windows Node mode loads icudtl.dat and other runtime data
    // beside the executable. Grant the installation directory read-only;
    // createSandboxConfig still deny-protects it if a project write grant
    // happens to contain the runtime during development.
    ...(platform === "win32" ? [path.win32.dirname(executable)] : []),
  ];
}

export function withFileExecutionSignal<T>(
  signal: AbortSignal | undefined,
  operation: () => Promise<T>,
): Promise<T> {
  return execution.run(
    { signal, reads: new Map(), pendingDirectories: new Set() },
    operation,
  );
}

/** Coalesce the low-level calls made by one read/edit/write tool execution. */
export function createCoalescedFileIO(invoke: FileWorkerInvoke) {
  const readOnce = (targetPath: string, mode = constants.R_OK) => {
    const context = execution.getStore();
    if (!context) return invoke("read", targetPath, { mode });
    const cached = context.reads.get(targetPath);
    if (cached && (cached.mode & mode) === mode) return cached.value;
    const value = invoke("read", targetPath, { mode });
    context.reads.set(targetPath, { mode, value });
    return value;
  };

  return {
    access: (targetPath: string, mode: number) => {
      if (!execution.getStore())
        return invoke("access", targetPath, { mode }).then(() => undefined);
      return readOnce(targetPath, mode).then(() => undefined);
    },
    readFile: (targetPath: string) => readOnce(targetPath),
    readHeader: (targetPath: string) => {
      if (!execution.getStore()) return invoke("header", targetPath);
      return readOnce(targetPath).then((content) => content.subarray(0, 12));
    },
    writeFile: async (targetPath: string, content: string) => {
      const context = execution.getStore();
      const createParent =
        context?.pendingDirectories.delete(path.dirname(targetPath)) ?? false;
      await invoke("write", targetPath, { content, createParent });
      context?.reads.set(targetPath, {
        mode: constants.R_OK | constants.W_OK,
        value: Promise.resolve(Buffer.from(content, "utf8")),
      });
    },
    mkdir: (targetPath: string) => {
      const context = execution.getStore();
      if (!context) return invoke("mkdir", targetPath).then(() => undefined);
      context.pendingDirectories.add(targetPath);
      return Promise.resolve();
    },
  };
}

export function createSandboxFileIO(
  policy: PineToolAccessPolicy,
  temporaryDirectory: string,
  loginPath: string,
  runtimeFiles: string[],
) {
  const invoke = async (
    operation: string,
    targetPath: string,
    extra: Record<string, unknown> = {},
  ): Promise<Buffer> => {
    const shell = sandboxShell();
    const executable = quoteShell(process.execPath, shell.kind);
    const source = quoteShell(fileSource, shell.kind);
    const command =
      shell.kind === "powershell"
        ? fileSource
        : `exec /usr/bin/env ELECTRON_RUN_AS_NODE=1 ${executable} --input-type=module -e ${source}`;
    let output = "";
    let overflow = false;
    const result = await runSandbox(
      {
        command,
        cwd: policy.cwd,
        env: createBashEnvironment(
          undefined,
          temporaryDirectory,
          loginPath,
          policy.cwd,
        ),
        config: createSandboxConfig(
          policy,
          fileWorkerRuntimePaths(runtimeFiles),
        ),
        shell: shell.executable,
        stdin: JSON.stringify({ operation, path: targetPath, ...extra }),
        windowsDirect:
          shell.kind === "powershell"
            ? {
                executable: process.execPath,
                args: ["--input-type=module", "-e"],
                env: { ELECTRON_RUN_AS_NODE: "1" },
                stdinFileEnvironment: "PINE_FILE_REQUEST",
              }
            : undefined,
      },
      {
        timeout: 30,
        signal: execution.getStore()?.signal,
        onData: (chunk) => {
          if (output.length + chunk.length > 96 * 1024 * 1024) overflow = true;
          else if (!overflow) output += chunk.toString("utf8");
        },
        onStderr: () => undefined,
      },
    );
    if (overflow) throw new Error("File response exceeds the limit.");
    if (result.exitCode !== 0)
      throw new Error(
        `Sandboxed file worker exited ${result.exitCode}: ${output.slice(-4_096)}`,
      );
    const response = JSON.parse(output) as {
      ok: boolean;
      data?: string;
      message?: string;
      code?: string;
    };
    if (!response.ok)
      throw new Error(
        `Sandboxed file operation failed: ${response.message ?? response.code ?? "unknown error"}`,
      );
    return Buffer.from(response.data ?? "", "base64");
  };
  return createCoalescedFileIO(invoke);
}
