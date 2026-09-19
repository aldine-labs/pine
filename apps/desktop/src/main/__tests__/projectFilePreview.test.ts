// @vitest-environment node
import { mkdtemp, rm, writeFile, truncate, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MAX_TEXT_PREVIEW_BYTES,
  projectMediaUrl,
  readProjectFilePreview,
  serveProjectMedia,
} from "../projectFilePreview";
import { resolveProjectPath } from "../projectFiles";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "pine-preview-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("file preview", () => {
  it("mints owner-scoped media URLs and flags presented files", () => {
    const projectUrl = new URL(
      projectMediaUrl(7, {
        folderId: "folder-1",
        projectId: "project-1",
        relativePath: "assets/hero.png",
      }),
    );
    expect(projectUrl.protocol).toBe("pine-project-media:");
    expect(projectUrl.hostname).toBe("preview");
    expect(Object.fromEntries(projectUrl.searchParams)).toEqual({
      folderId: "folder-1",
      owner: "7",
      projectId: "project-1",
      relativePath: "assets/hero.png",
    });

    const presentedUrl = new URL(
      projectMediaUrl(7, { path: "/tmp/generated.png" }, { presented: true }),
    );
    expect(Object.fromEntries(presentedUrl.searchParams)).toEqual({
      owner: "7",
      path: "/tmp/generated.png",
      presented: "1",
    });
  });

  it("reads text without executing HTML and preserves whitespace and UTF-16", async () => {
    const text = "<script>alert(1)</script>\n  你好\n\n";
    for (const [name, contents] of [
      ["source.html", Buffer.from(text)],
      [
        "notes.txt",
        Buffer.concat([
          Buffer.from([0xff, 0xfe]),
          Buffer.from(text, "utf16le"),
        ]),
      ],
      ["empty", Buffer.alloc(0)],
    ] as const) {
      const file = path.join(root, name);
      await writeFile(file, contents);
      expect(await readProjectFilePreview(file, "unused")).toMatchObject({
        kind: "text",
        text: contents.length ? text : "",
      });
    }
  });

  it("rejects binary, oversized text, directories and missing files", async () => {
    const file = path.join(root, "data.bin");
    await writeFile(file, Buffer.from([0, 255, 1]));
    expect(await readProjectFilePreview(file, "unused")).toMatchObject({
      kind: "unsupported",
      reason: "binary",
    });
    await truncate(file, MAX_TEXT_PREVIEW_BYTES + 1);
    expect(await readProjectFilePreview(file, "unused")).toMatchObject({
      kind: "unsupported",
      reason: "too-large",
    });
    await expect(readProjectFilePreview(root, "unused")).rejects.toThrow(
      "regular file",
    );
    await expect(
      readProjectFilePreview(path.join(root, "missing"), "unused"),
    ).rejects.toThrow();
  });

  it("reuses project path confinement for traversal and escaping symlinks", async () => {
    const folder = {
      id: "f1",
      path: root,
      access: "read-only" as const,
      name: "project",
      isAvailable: true,
    };
    await symlink(os.tmpdir(), path.join(root, "escape"));
    await expect(resolveProjectPath(folder, "../outside")).rejects.toThrow(
      "outside",
    );
    await expect(resolveProjectPath(folder, "escape")).rejects.toThrow(
      "outside",
    );
  });

  it.each([
    ["image.PNG", "image"],
    ["clip.mp4", "video"],
    ["document.PDF", "pdf"],
  ])(
    "returns a media URL for %s without reading the whole file",
    async (name, kind) => {
      const file = path.join(root, name);
      await writeFile(file, "");
      await truncate(file, MAX_TEXT_PREVIEW_BYTES * 10);
      expect(
        await readProjectFilePreview(
          file,
          "pine-project-media://preview/?test",
        ),
      ).toMatchObject({ kind, url: "pine-project-media://preview/?test" });
    },
  );

  it.each([
    ["report.DOCX", "docx"],
    ["legacy.XLS", "xls"],
    ["budget.XLSX", "xlsx"],
    ["slides.PPTX", "pptx"],
  ])("returns an Office preview for %s", async (name, format) => {
    const file = path.join(root, name);
    await writeFile(file, "");
    await truncate(file, MAX_TEXT_PREVIEW_BYTES * 10);
    expect(
      await readProjectFilePreview(
        file,
        "pine-project-media://preview/?office",
      ),
    ).toMatchObject({
      kind: "office",
      format,
      url: "pine-project-media://preview/?office",
    });
  });
});

describe("media streaming", () => {
  it.each([
    [null, 200, "0123456789", null],
    ["bytes=2-5", 206, "2345", "bytes 2-5/10"],
    ["bytes=7-", 206, "789", "bytes 7-9/10"],
    ["bytes=-3", 206, "789", "bytes 7-9/10"],
    ["bytes=8-100", 206, "89", "bytes 8-9/10"],
  ])("streams %s", async (range, status, body, contentRange) => {
    const file = path.join(root, "clip.mp4");
    await writeFile(file, "0123456789");
    const response = await serveProjectMedia(
      new Request("https://preview.test", {
        headers: range ? { Range: range } : {},
      }),
      file,
    );
    expect(response.status).toBe(status);
    expect(response.headers.get("Content-Range")).toBe(contentRange);
    expect(response.headers.get("Content-Length")).toBe(String(body.length));
    expect(response.headers.get("Content-Type")).toBe("video/mp4");
    expect(await response.text()).toBe(body);
  });

  it.each(["bytes=20-", "bytes=4-2", "bytes=-0", "bytes=0-1,4-5", "bytes=-"])(
    "rejects invalid range %s",
    async (range) => {
      const file = path.join(root, "clip.webm");
      await writeFile(file, "0123456789");
      const response = await serveProjectMedia(
        new Request("https://preview.test", { headers: { Range: range } }),
        file,
      );
      expect(response.status).toBe(416);
      expect(response.headers.get("Content-Range")).toBe("bytes */10");
    },
  );

  it("supports HEAD and never serves text through the media protocol", async () => {
    const file = path.join(root, "image.svg");
    await writeFile(file, "<svg />");
    const response = await serveProjectMedia(
      new Request("https://preview.test", { method: "HEAD" }),
      file,
    );
    expect(response.headers.get("Content-Length")).toBe("7");
    expect(response.headers.get("Content-Security-Policy")).toContain(
      "sandbox",
    );
    expect(await response.text()).toBe("");
    expect(
      (
        await serveProjectMedia(
          new Request("https://preview.test"),
          path.join(root, "index.html"),
        )
      ).status,
    ).toBe(415);
  });

  it("serves PDF documents with their standard MIME type", async () => {
    const file = path.join(root, "document.pdf");
    await writeFile(file, "%PDF-1.7");
    const response = await serveProjectMedia(
      new Request("https://preview.test", {
        headers: { Origin: "http://localhost:5173" },
      }),
      file,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      "http://localhost:5173",
    );
    expect(await response.text()).toBe("%PDF-1.7");
  });

  it.each([
    [
      "report.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
    [
      "budget.xlsx",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ],
    ["legacy.xls", "application/vnd.ms-excel"],
    [
      "slides.pptx",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ],
  ])("serves %s with its standard MIME type", async (name, mime) => {
    const file = path.join(root, name);
    await writeFile(file, "office");
    const response = await serveProjectMedia(
      new Request("https://preview.test"),
      file,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(mime);
    expect(await response.text()).toBe("office");
  });
});
