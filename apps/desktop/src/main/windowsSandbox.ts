import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import {
  grantWindowsAcl,
  restoreWindowsAcl,
  revokeWindowsAcl,
  stampWindowsAcl,
  type SrtWinSpawn,
} from "@anthropic-ai/sandbox-runtime";
import type { WindowsSandboxStatus } from "../shared/windowsSandbox";
import { resolveSpawnableResourcePath } from "../agent/sandbox/runtime-path";

export type WindowsSandboxSetupChoice = "retry" | "exit";

export interface EnsureWindowsSandboxReadyOptions {
  getStatus?: () => Promise<WindowsSandboxStatus>;
  install?: () => Promise<WindowsSandboxStatus>;
  platform?: NodeJS.Platform;
  prompt: (status: WindowsSandboxStatus) => Promise<WindowsSandboxSetupChoice>;
}

const execFileAsync = promisify(execFile);
let startupRuntimeAccess:
  { sandboxUserSid: string; srtWin: SrtWinSpawn } | undefined;

async function querySecondaryLogonService(): Promise<string> {
  const { stdout } = await execFileAsync("sc.exe", ["query", "seclogon"], {
    windowsHide: true,
  });
  return stdout;
}

/** Ensure CreateProcessWithLogonW can reach the Secondary Logon service. */
export async function ensureWindowsSecondaryLogonService(
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  if (platform !== "win32") return;

  let serviceStatus = await querySecondaryLogonService();
  if (!/STATE\s*:\s*4\b/i.test(serviceStatus)) {
    await execFileAsync("sc.exe", ["start", "seclogon"], { windowsHide: true });
  }

  for (let attempt = 0; attempt < 20; attempt += 1) {
    serviceStatus = await querySecondaryLogonService();
    if (/STATE\s*:\s*4\b/i.test(serviceStatus)) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }

  throw new Error("Secondary Logon service (seclogon) is not running.");
}

async function runtime() {
  return import("@anthropic-ai/sandbox-runtime");
}

async function resolvedSrtWin() {
  const { resolveSrtWin, VENDORED_SRT_WIN_EXE } = await runtime();
  return resolveSrtWin({
    path: resolveSpawnableResourcePath(VENDORED_SRT_WIN_EXE),
  });
}

async function ensureWindowsSandboxRuntimeAccess(
  srtWin: SrtWinSpawn,
): Promise<void> {
  const { getWindowsSandboxUserStatusAsync } = await runtime();
  const user = await getWindowsSandboxUserStatusAsync({ srtWin });
  if (!user.provisioned || !user.credPresent || !user.sid) {
    throw new Error(
      "The Windows sandbox user is not provisioned with a usable SID.",
    );
  }

  if (
    startupRuntimeAccess?.sandboxUserSid === user.sid &&
    startupRuntimeAccess.srtWin.exe === srtWin.exe
  ) {
    return;
  }

  grantWindowsAcl({
    sandboxUserSid: user.sid,
    read: [srtWin.exe],
    write: [],
    srtWin,
  });
  try {
    stampWindowsAcl({
      sandboxUserSid: user.sid,
      denyRead: [],
      // Bun may hardlink the vendored executable into node_modules. SRT
      // intentionally refuses path-keyed deny ACEs on multiply-linked files,
      // so protect the unique architecture directory that contains it.
      denyWrite: [path.dirname(srtWin.exe)],
      srtWin,
    });
  } catch (error) {
    revokeWindowsAcl({ sandboxUserSid: user.sid, srtWin });
    restoreWindowsAcl({ sandboxUserSid: user.sid, srtWin });
    throw error;
  }
  startupRuntimeAccess = { sandboxUserSid: user.sid, srtWin };
}

/** Release the startup-only ACL that lets the sandbox broker launch itself. */
export function releaseWindowsSandboxRuntimeAccess(
  platform: NodeJS.Platform = process.platform,
): void {
  if (platform !== "win32" || !startupRuntimeAccess) return;
  const access = startupRuntimeAccess;
  startupRuntimeAccess = undefined;
  revokeWindowsAcl({
    sandboxUserSid: access.sandboxUserSid,
    srtWin: access.srtWin,
  });
  restoreWindowsAcl({
    sandboxUserSid: access.sandboxUserSid,
    srtWin: access.srtWin,
  });
}

export async function getWindowsSandboxStatus(
  platform: NodeJS.Platform = process.platform,
): Promise<WindowsSandboxStatus> {
  if (platform !== "win32") return { state: "unsupported" };
  try {
    const { checkWindowsDependenciesAsync, verifyWindowsWfpEgress } =
      await runtime();
    await ensureWindowsSecondaryLogonService(platform);
    const srtWin = await resolvedSrtWin();
    const result = await checkWindowsDependenciesAsync({
      srtWin,
    });
    if (result.errors.length > 0) {
      return { state: "not-installed", message: result.errors.join("\n") };
    }
    await ensureWindowsSandboxRuntimeAccess(srtWin);
    await verifyWindowsWfpEgress({ srtWin });
    return { state: "ready" };
  } catch (error) {
    return { state: "not-installed", message: String(error) };
  }
}

export async function installWindowsSandbox(): Promise<WindowsSandboxStatus> {
  if (process.platform !== "win32") return { state: "unsupported" };
  const { installWindowsSandboxAsync } = await runtime();
  const result = await installWindowsSandboxAsync({
    srtWin: await resolvedSrtWin(),
  });
  if (result.cancelled) return { state: "not-installed", cancelled: true };
  return getWindowsSandboxStatus();
}

/**
 * Keep the main window gated until the Windows sandbox has been provisioned.
 * The install command owns the UAC prompt; the caller owns the retry/exit
 * dialog so this flow can be exercised without creating a renderer window.
 */
export async function ensureWindowsSandboxReady({
  getStatus,
  install,
  platform = process.platform,
  prompt,
}: EnsureWindowsSandboxReadyOptions): Promise<boolean> {
  if (platform !== "win32") return true;

  const readStatus = getStatus ?? (() => getWindowsSandboxStatus(platform));
  const runInstall = install ?? (() => installWindowsSandbox());

  while (true) {
    let status: WindowsSandboxStatus;
    try {
      status = await readStatus();
    } catch (error) {
      status = { state: "not-installed", message: String(error) };
    }

    if (status.state === "ready") return true;

    try {
      status = await runInstall();
    } catch (error) {
      console.error("[Windows sandbox] setup failed", error);
      status = { state: "not-installed", message: String(error) };
    }

    if (status.state === "ready") return true;
    if ((await prompt(status)) === "exit") return false;
  }
}
