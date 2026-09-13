import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { resolveSpawnableResourcePath } from "../sandbox/runtime-path";

describe("spawnable packaged resource paths", () => {
  it("uses the unpacked twin of an executable stored beside app.asar", () => {
    const candidate = path.join(
      path.sep,
      "Pine",
      "resources",
      "app.asar",
      "node_modules",
      "sandbox-runtime",
      "srt-win.exe",
    );
    const exists = vi.fn((filePath: string) =>
      filePath.includes(`app.asar.unpacked${path.sep}`),
    );

    expect(resolveSpawnableResourcePath(candidate, exists)).toContain(
      `app.asar.unpacked${path.sep}`,
    );
  });

  it("keeps development and missing unpacked paths unchanged", () => {
    const development = path.join(path.sep, "project", "srt-win.exe");
    const archived = path.join(
      path.sep,
      "Pine",
      "resources",
      "app.asar",
      "srt-win.exe",
    );

    expect(resolveSpawnableResourcePath(development, vi.fn())).toBe(
      development,
    );
    expect(resolveSpawnableResourcePath(archived, () => false)).toBe(archived);
  });
});
