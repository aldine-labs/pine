import { describe, expect, it, vi } from "vitest";
import { MAX_IMAGE_INPUT_BYTES, resolveImageReference } from "../image-input";

const png = Buffer.from("89504e470d0a1a0a", "hex");

describe("resolveImageReference", () => {
  it("resolves a base64 data URL", async () => {
    await expect(
      resolveImageReference(`data:image/png;base64,${png.toString("base64")}`, {
        cwd: "/tmp",
      }),
    ).resolves.toEqual({
      data: png.toString("base64"),
      mimeType: "image/png",
      type: "image",
    });
  });

  it("resolves a local image through the caller's read policy", async () => {
    const readFile = vi.fn(() => Promise.resolve(png));

    await expect(
      resolveImageReference("assets/reference.png", {
        cwd: "/tmp/project",
        readFile,
      }),
    ).resolves.toMatchObject({
      data: png.toString("base64"),
      mimeType: "image/png",
    });
    expect(readFile).toHaveBeenCalledWith("/tmp/project/assets/reference.png");
  });

  it("downloads HTTP(S) references and keeps their MIME type", async () => {
    const fetch = vi.fn(() =>
      Promise.resolve({
        arrayBuffer: () =>
          Promise.resolve(
            png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength),
          ),
        headers: new Headers({ "content-type": "image/png" }),
        ok: true,
        status: 200,
      } as Response),
    );

    await expect(
      resolveImageReference("https://example.com/reference.png", {
        cwd: "/tmp",
        fetch,
      }),
    ).resolves.toMatchObject({
      data: png.toString("base64"),
      mimeType: "image/png",
    });
    expect(fetch).toHaveBeenCalledWith("https://example.com/reference.png", {});
  });

  it("rejects an input over the attachment size limit", async () => {
    const oversized = new Uint8Array(MAX_IMAGE_INPUT_BYTES + 1);

    await expect(
      resolveImageReference(
        `data:image/png;base64,${Buffer.from(oversized).toString("base64")}`,
        { cwd: "/tmp" },
      ),
    ).rejects.toThrow("too large");
  });
});
