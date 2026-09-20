import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ImageContent } from "@earendil-works/pi-ai";

export const MAX_IMAGE_INPUT_BYTES = 25 * 1024 * 1024;

const MIME_TYPES_BY_EXTENSION: Record<string, string> = {
  avif: "image/avif",
  bmp: "image/bmp",
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  webp: "image/webp",
};

export type ImageReferenceInput =
  | string
  | {
      image_url: { url: string };
      type: "image_url";
    };

export interface ResolveImageReferenceOptions {
  cwd: string;
  fetch?: typeof globalThis.fetch;
  readFile?: (targetPath: string) => Promise<Uint8Array>;
  signal?: AbortSignal;
}

/** Resolve the URL value from either Pine's shorthand or OpenRouter's shape. */
export function imageReferenceUrl(reference: ImageReferenceInput): string {
  return typeof reference === "string" ? reference : reference.image_url.url;
}

/**
 * Convert a local path, HTTP(S) URL, or base64 data URL into pi-ai's image
 * content shape. Local files are intentionally read through the caller's
 * callback so the agent's folder policy remains the only filesystem gate.
 */
export async function resolveImageReference(
  reference: string,
  options: ResolveImageReferenceOptions,
): Promise<ImageContent> {
  const normalized = reference.trim();
  if (!normalized) throw new Error("Image references cannot be empty.");

  if (normalized.startsWith("data:")) {
    return imageContentFromDataUrl(normalized);
  }

  if (/^https?:\/\//iu.test(normalized)) {
    return imageContentFromHttpUrl(normalized, options);
  }

  if (!options.readFile) {
    throw new Error(
      `Local image references are unavailable for this request: ${normalized}`,
    );
  }

  const targetPath = normalized.startsWith("file://")
    ? filePathFromUrl(normalized)
    : path.resolve(options.cwd, normalized);
  const bytes = await options.readFile(targetPath);
  return imageContentFromBytes(
    bytes,
    MIME_TYPES_BY_EXTENSION[path.extname(targetPath).slice(1).toLowerCase()],
  );
}

function imageContentFromDataUrl(dataUrl: string): ImageContent {
  const match = /^data:([^;,]+)(;[^,]*)?,([\s\S]*)$/u.exec(dataUrl);
  if (!match) throw new Error("Image data URL is malformed.");

  const mimeType = normalizeImageMimeType(match[1]);
  if (!mimeType) throw new Error("Image data URL must use an image MIME type.");

  const metadata = match[2] ?? "";
  const payload = match[3] ?? "";
  const bytes = metadata.toLowerCase().includes(";base64")
    ? Buffer.from(payload, "base64")
    : Buffer.from(decodeURIComponent(payload), "utf8");
  return imageContentFromBytes(bytes, mimeType);
}

async function imageContentFromHttpUrl(
  url: string,
  options: ResolveImageReferenceOptions,
): Promise<ImageContent> {
  const response = await (options.fetch ?? globalThis.fetch)(url, {
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (!response.ok) {
    throw new Error(
      `Unable to read image reference (HTTP ${response.status}).`,
    );
  }

  const contentType = normalizeImageMimeType(
    response.headers.get("content-type")?.split(";", 1)[0],
  );
  const bytes = new Uint8Array(await response.arrayBuffer());
  return imageContentFromBytes(bytes, contentType);
}

function imageContentFromBytes(
  bytes: Uint8Array,
  hintedMimeType?: string,
): ImageContent {
  if (bytes.byteLength === 0) throw new Error("Image reference is empty.");
  if (bytes.byteLength > MAX_IMAGE_INPUT_BYTES) {
    throw new Error(
      `Image reference is too large; the limit is ${MAX_IMAGE_INPUT_BYTES} bytes.`,
    );
  }

  const mimeType = hintedMimeType ?? detectImageMimeType(bytes);
  if (!mimeType) {
    throw new Error(
      "Unable to determine the image format. Use PNG, JPEG, GIF, WebP, AVIF, BMP, SVG, or an image data URL.",
    );
  }
  return {
    data: Buffer.from(bytes).toString("base64"),
    mimeType,
    type: "image",
  };
}

function detectImageMimeType(bytes: Uint8Array): string | undefined {
  const header = Buffer.from(bytes.subarray(0, 512));
  if (header.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) {
    return "image/png";
  }
  if (header.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex"))) {
    return "image/jpeg";
  }
  const ascii = header.toString("ascii");
  if (ascii.startsWith("GIF87a") || ascii.startsWith("GIF89a")) {
    return "image/gif";
  }
  if (ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP") {
    return "image/webp";
  }
  if (ascii.startsWith("BM")) return "image/bmp";
  if (ascii.includes("ftypavif") || ascii.includes("ftypavis")) {
    return "image/avif";
  }
  const text = header
    .toString("utf8")
    .replace(/^\uFEFF/, "")
    .trimStart();
  if (text.startsWith("<svg") || text.startsWith("<?xml")) {
    return "image/svg+xml";
  }
  return undefined;
}

function normalizeImageMimeType(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized?.startsWith("image/") ? normalized : undefined;
}

function filePathFromUrl(value: string): string {
  try {
    return fileURLToPath(value);
  } catch {
    throw new Error(`Invalid local image reference: ${value}`);
  }
}
