import { describe, expect, it } from "vitest";
import { getWindowsSandboxStatus } from "../windowsSandbox";

describe("Windows sandbox setup", () => {
  it("does not offer Windows provisioning on other platforms", async () => {
    await expect(getWindowsSandboxStatus("darwin")).resolves.toEqual({
      state: "unsupported",
    });
  });
});
