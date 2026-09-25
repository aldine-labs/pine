import type { FilePreviewTarget } from "@/shared/projectFiles";

/**
 * Path used for display, language detection, and icon lookup. Project files
 * stay relative to their folder; presented files are absolute.
 */
export function fileTargetPath(target: FilePreviewTarget): string {
  return target.source === "project" ? target.relativePath : target.path;
}

/** Last path segment, tolerating the separators a presented path may use. */
export function fileName(filePath: string): string {
  return filePath.split(/[\\/]/).filter(Boolean).at(-1) ?? filePath;
}

/** Parent directory for a portable project-relative file path. */
export function projectFileDirectory(relativePath: string): string {
  return relativePath.split("/").slice(0, -1).join("/");
}

/** Identity that makes one tab per file, and drops restored duplicates. */
export function fileTargetKey(target: FilePreviewTarget): string {
  return target.source === "project"
    ? `project:${target.projectId}:${target.folderId}:${target.relativePath}`
    : `presented:${target.path}`;
}
