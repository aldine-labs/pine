import { AsyncLocalStorage } from "node:async_hooks";
import type { PineToolAccessPolicy } from "../tool-access-policy";
import { createBashEnvironment, sandboxShell } from "../bash-env";
import { createSandboxConfig } from "./policy";
import { quoteShell, runSandbox } from "./backend";
import fileSource from "./file-worker.mjs?raw";

const execution = new AsyncLocalStorage<{ signal?: AbortSignal }>();
export function withFileExecutionSignal<T>(
  signal: AbortSignal | undefined,
  operation: () => Promise<T>,
): Promise<T> {
  return execution.run({ signal }, operation);
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
        ? `$env:ELECTRON_RUN_AS_NODE='1'; & ${executable} --input-type=module -e ${source}`
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
        config: createSandboxConfig(policy, [
          ...runtimeFiles,
          process.execPath,
        ]),
        shell: shell.executable,
        stdin: JSON.stringify({ operation, path: targetPath, ...extra }),
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
  return {
    access: (targetPath: string, mode: number) =>
      invoke("access", targetPath, { mode }).then(() => undefined),
    readFile: (targetPath: string) => invoke("read", targetPath),
    readHeader: (targetPath: string) => invoke("header", targetPath),
    writeFile: (targetPath: string, content: string) =>
      invoke("write", targetPath, { content }).then(() => undefined),
    mkdir: (targetPath: string) =>
      invoke("mkdir", targetPath).then(() => undefined),
  };
}
