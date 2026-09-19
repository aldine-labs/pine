import { open } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import type {
  OfficeDocumentFormat,
  ProjectFilePreview,
} from "../shared/projectFiles";
import { PROJECT_MEDIA_PROTOCOL } from "../shared/projectFiles";

export const MAX_TEXT_PREVIEW_BYTES = 2 * 1024 * 1024;

/**
 * Marks a project-media URL that serves a presented file rather than a project
 * entry, so the protocol re-checks the window's presented-file grants.
 */
export const PRESENTED_MEDIA_PARAM = "presented";

/**
 * Builds the media URL a preview reads its bytes from. Every URL names the
 * window allowed to read the file; presented files add the flag that switches
 * the protocol from project-entry lookup to the presented-file grant check.
 */
export function projectMediaUrl(
  ownerId: number,
  params: Record<string, string>,
  options: { presented?: boolean } = {},
): string {
  const url = URL.parse(`${PROJECT_MEDIA_PROTOCOL}://preview/`);
  if (!url) throw new Error("Failed to construct the project media URL.");
  url.search = new URLSearchParams({
    ...params,
    owner: String(ownerId),
    ...(options.presented ? { [PRESENTED_MEDIA_PARAM]: "1" } : {}),
  }).toString();
  return url.href;
}

const mediaTypes: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".webm": "video/webm",
  ".ogv": "video/ogg",
  ".mov": "video/quicktime",
  ".pdf": "application/pdf",
};
const officeTypes: Record<
  string,
  { format: OfficeDocumentFormat; mime: string }
> = {
  ".docx": {
    format: "docx",
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
  ".xlsx": {
    format: "xlsx",
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
  ".xls": {
    format: "xls",
    mime: "application/vnd.ms-excel",
  },
  ".pptx": {
    format: "pptx",
    mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  },
};

export async function readProjectFilePreview(
  filePath: string,
  mediaUrl: string,
): Promise<ProjectFilePreview> {
  const file = await open(filePath, "r");
  try {
    const metadata = await file.stat();
    if (!metadata.isFile()) throw new Error("Expected a regular file.");
    const info = {
      size: metadata.size,
      modifiedAt: metadata.mtime.toISOString(),
    };
    const extension = path.extname(filePath).toLowerCase();
    const office = officeTypes[extension];
    const mime = mediaTypes[extension] ?? office?.mime;
    if (mime)
      return office
        ? { ...info, kind: "office", format: office.format, url: mediaUrl }
        : {
            ...info,
            kind: mime.startsWith("image/")
              ? "image"
              : mime.startsWith("video/")
                ? "video"
                : "pdf",
            url: mediaUrl,
          };
    if (metadata.size > MAX_TEXT_PREVIEW_BYTES)
      return { ...info, kind: "unsupported", reason: "too-large" };

    // Bound the read even if another process grows the file after stat().
    const bytes = Buffer.alloc(
      Math.min(metadata.size + 1, MAX_TEXT_PREVIEW_BYTES + 1),
    );
    let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await file.read(
        bytes,
        length,
        bytes.length - length,
        length,
      );
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length > metadata.size)
      return { ...info, kind: "unsupported", reason: "too-large" };
    const contents = bytes.subarray(0, length);
    const encoding =
      contents[0] === 0xff && contents[1] === 0xfe
        ? "utf-16le"
        : contents[0] === 0xfe && contents[1] === 0xff
          ? "utf-16be"
          : "utf-8";
    try {
      const text = new TextDecoder(encoding, { fatal: true }).decode(contents);
      if (/[\u0000-\u0008\u000e-\u001f]/u.test(text))
        return { ...info, kind: "unsupported", reason: "binary" };
      return { ...info, kind: "text", text, encoding: encoding.toUpperCase() };
    } catch {
      return { ...info, kind: "unsupported", reason: "binary" };
    }
  } finally {
    await file.close();
  }
}

/** Serves only preview assets, with bounded streaming and byte ranges. */
export async function serveProjectMedia(
  request: Request,
  filePath: string,
): Promise<Response> {
  const extension = path.extname(filePath).toLowerCase();
  const mime = mediaTypes[extension] ?? officeTypes[extension]?.mime;
  if (!mime) return new Response(null, { status: 415 });
  if (request.method !== "GET" && request.method !== "HEAD")
    return new Response(null, { status: 405 });
  const file = await open(filePath, "r");
  let streaming = false;
  try {
    const { size } = await file.stat().then((metadata) => {
      if (!metadata.isFile()) throw new Error("Expected a regular file.");
      return metadata;
    });
    const headers = new Headers({
      "Content-Type": mime,
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    });
    const origin = request.headers.get("origin");
    if (
      origin &&
      (origin === "null" || /^http:\/\/localhost:\d+$/u.test(origin))
    ) {
      headers.set("Access-Control-Allow-Origin", origin);
      headers.set("Vary", "Origin");
    }
    let start = 0;
    let end = size - 1;
    const range = request.headers.get("range");
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (match && (match[1] || match[2])) {
        start = match[1]
          ? Number(match[1])
          : Math.max(0, size - Number(match[2]));
        end =
          match[1] && match[2]
            ? Math.min(Number(match[2]), size - 1)
            : size - 1;
      }
      if (
        !match ||
        !(match[1] || match[2]) ||
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start > end ||
        start >= size
      ) {
        headers.set("Content-Range", `bytes */${size}`);
        return new Response(null, { status: 416, headers });
      }
      headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
    }
    headers.set("Content-Length", String(Math.max(0, end - start + 1)));
    const status = range ? 206 : 200;
    if (request.method === "HEAD" || size === 0)
      return new Response(null, { status, headers });
    const stream = file.createReadStream({ start, end, autoClose: true });
    streaming = true;
    return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
      status,
      headers,
    });
  } finally {
    if (!streaming) await file.close();
  }
}
