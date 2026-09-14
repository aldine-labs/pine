import type { WindowsSandboxStatus } from "../shared/windowsSandbox";
import { resolveSpawnableResourcePath } from "../agent/sandbox/runtime-path";

export type WindowsSandboxSetupChoice = "retry" | "exit";

export interface EnsureWindowsSandboxReadyOptions {
  getStatus?: () => Promise<WindowsSandboxStatus>;
  install?: () => Promise<WindowsSandboxStatus>;
  platform?: NodeJS.Platform;
  prompt: (status: WindowsSandboxStatus) => Promise<WindowsSandboxSetupChoice>;
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

export async function getWindowsSandboxStatus(
  platform: NodeJS.Platform = process.platform,
): Promise<WindowsSandboxStatus> {
  if (platform !== "win32") return { state: "unsupported" };
  try {
    const { checkWindowsDependenciesAsync } = await runtime();
    const result = await checkWindowsDependenciesAsync({
      srtWin: await resolvedSrtWin(),
    });
    return result.errors.length === 0
      ? { state: "ready" }
      : { state: "not-installed", message: result.errors.join("\n") };
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
