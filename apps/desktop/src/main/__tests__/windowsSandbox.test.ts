import { describe, expect, it } from "vitest";
import {
  ensureWindowsSandboxReady,
  getWindowsSandboxStatus,
} from "../windowsSandbox";

describe("Windows sandbox setup", () => {
  it("does not offer Windows provisioning on other platforms", async () => {
    await expect(getWindowsSandboxStatus("darwin")).resolves.toEqual({
      state: "unsupported",
    });
  });

  it("retries setup after a cancelled UAC request", async () => {
    const statuses = [
      { state: "not-installed" as const },
      { state: "ready" as const },
    ];
    const getStatus = () =>
      Promise.resolve(statuses.shift() ?? { state: "ready" as const });
    const install = () =>
      Promise.resolve({
        state: "not-installed" as const,
        cancelled: true as const,
      });
    const prompt = () => Promise.resolve("retry" as const);

    const setup = ensureWindowsSandboxReady({
      getStatus,
      install,
      platform: "win32",
      prompt,
    });

    await expect(setup).resolves.toBe(true);
  });

  it("does not enter the app when the user exits setup", async () => {
    const install = () =>
      Promise.resolve({
        state: "not-installed" as const,
        cancelled: true as const,
      });
    const prompt = () => Promise.resolve("exit" as const);

    await expect(
      ensureWindowsSandboxReady({
        getStatus: () => Promise.resolve({ state: "not-installed" as const }),
        install,
        platform: "win32",
        prompt,
      }),
    ).resolves.toBe(false);
  });
});
