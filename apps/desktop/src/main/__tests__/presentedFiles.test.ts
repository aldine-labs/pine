// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  MAX_PRESENTED_FILES_PER_WINDOW,
  PresentedFileRegistry,
} from "../presentedFiles";

describe("presented file grants", () => {
  it("allows only paths remembered for the same window", () => {
    const registry = new PresentedFileRegistry();
    registry.remember(1, "/tmp/report.pdf");
    expect(registry.allows(1, "/tmp/report.pdf")).toBe(true);
    expect(registry.allows(1, "/tmp/other.pdf")).toBe(false);
    expect(registry.allows(2, "/tmp/report.pdf")).toBe(false);
  });

  it("bounds how many grants one window can accumulate", () => {
    const registry = new PresentedFileRegistry();
    for (let index = 0; index < MAX_PRESENTED_FILES_PER_WINDOW + 2; index++) {
      registry.remember(1, `/tmp/file-${index}.txt`);
    }
    expect(registry.allows(1, "/tmp/file-0.txt")).toBe(false);
    expect(registry.allows(1, "/tmp/file-1.txt")).toBe(false);
    expect(registry.allows(1, "/tmp/file-2.txt")).toBe(true);
    expect(
      registry.allows(1, `/tmp/file-${MAX_PRESENTED_FILES_PER_WINDOW + 1}.txt`),
    ).toBe(true);
  });

  it("keeps a re-presented path alive against eviction", () => {
    const registry = new PresentedFileRegistry();
    for (let index = 0; index < MAX_PRESENTED_FILES_PER_WINDOW; index++) {
      registry.remember(1, `/tmp/file-${index}.txt`);
    }
    // Re-presenting the oldest path makes it the newest, so the next insert
    // evicts the path behind it instead.
    registry.remember(1, "/tmp/file-0.txt");
    registry.remember(1, "/tmp/newest.txt");
    expect(registry.allows(1, "/tmp/file-0.txt")).toBe(true);
    expect(registry.allows(1, "/tmp/file-1.txt")).toBe(false);
  });

  it("forgets every grant when a window goes away", () => {
    const registry = new PresentedFileRegistry();
    registry.remember(1, "/tmp/report.pdf");
    registry.forget(1);
    expect(registry.allows(1, "/tmp/report.pdf")).toBe(false);
  });
});
