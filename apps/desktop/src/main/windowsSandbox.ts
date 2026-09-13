import type { WindowsSandboxStatus } from "../shared/windowsSandbox";

async function runtime() {
  return import("@anthropic-ai/sandbox-runtime");
}

async function resolvedSrtWin() {
  const { resolveSrtWin, VENDORED_SRT_WIN_EXE } = await runtime();
  return resolveSrtWin({ path: VENDORED_SRT_WIN_EXE });
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
