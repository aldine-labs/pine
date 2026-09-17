import type { NativeImage } from "electron";
import { describe, expect, it, vi } from "vitest";
import { startProjectFileDrag } from "../projectFileDrag";

describe("startProjectFileDrag", () => {
  it("uses the host-associated file icon instead of the app icon", async () => {
    const icon = {} as NativeImage;
    const loadIcon = vi.fn(() => Promise.resolve(icon));
    const startDrag = vi.fn();
    const sender = {
      isDestroyed: () => false,
      startDrag,
    };

    await startProjectFileDrag(sender, "/project/notes.md", loadIcon);

    expect(loadIcon).toHaveBeenCalledWith("/project/notes.md", {
      size: "normal",
    });
    expect(startDrag).toHaveBeenCalledWith({
      file: "/project/notes.md",
      icon,
    });
  });

  it("does not start a drag if the sender is destroyed while loading the icon", async () => {
    const loadIcon = vi.fn(() => Promise.resolve({} as never));
    const startDrag = vi.fn();
    const sender = {
      isDestroyed: vi.fn(() => true),
      startDrag,
    };

    await startProjectFileDrag(sender, "/project/notes.md", loadIcon);

    expect(startDrag).not.toHaveBeenCalled();
  });
});
