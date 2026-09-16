import { attachmentImageUrl } from "@/shared/attachments";

/**
 * Markdown image sources fall into four groups:
 * 1. Remote or inline-data URLs (`https:`, `data:`, `blob:`, protocol-relative)
 *    — pass through untouched.
 * 2. `file://` URLs — decoded to an absolute path.
 * 3. Absolute local paths (POSIX `/…` or Windows `C:\…` / `C:/…`) — served
 *    through the scoped `pine-attachment://` protocol, whose main-process
 *    handler validates the path against attachments and granted folders.
 * 4. Relative paths — chat has no base document, so they pass through
 *    unchanged (they cannot resolve, matching nothing to anchor against).
 *
 * The scheme pattern requires at least two characters before the colon so
 * Windows drive letters (`C:\…`, `c:/…`) are not mistaken for a URL scheme.
 */
const SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z\d+.-]+:/;
const WINDOWS_ABSOLUTE_PATTERN = /^[a-zA-Z]:[\\/]/;

function fileUrlToPath(src: string): string | undefined {
  try {
    const url = new URL(src);
    if (url.protocol !== "file:") return undefined;
    let pathname = decodeURIComponent(url.pathname);
    // Windows file URLs keep a drive-letter slash: file:///C:/Users/...
    if (/^\/[a-zA-Z]:/.test(pathname)) pathname = pathname.slice(1);
    return pathname;
  } catch {
    return undefined;
  }
}

function isAbsoluteLocalPath(path: string): boolean {
  return (
    (path.startsWith("/") && !path.startsWith("//")) ||
    WINDOWS_ABSOLUTE_PATTERN.test(path)
  );
}

/** Rewrite a markdown image `src` into a URL the renderer may load. */
export function resolveMarkdownImageSrc(src: string): string {
  const trimmed = src.trim();
  if (!trimmed) return trimmed;
  if (SCHEME_PATTERN.test(trimmed)) {
    if (trimmed.startsWith("file:")) {
      const path = fileUrlToPath(trimmed);
      return path ? attachmentImageUrl(path) : trimmed;
    }
    return trimmed;
  }
  if (isAbsoluteLocalPath(trimmed)) return attachmentImageUrl(trimmed);
  return trimmed;
}
