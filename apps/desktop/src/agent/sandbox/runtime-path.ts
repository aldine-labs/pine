import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Executables launched with child_process.spawn need a real filesystem path.
 * Electron's virtual app.asar path remains readable but is not spawnable.
 */
export function resolveSpawnableResourcePath(
  candidate: string,
  fileExists: (filePath: string) => boolean = existsSync,
): string {
  const archiveSegment = `${path.sep}app.asar${path.sep}`;
  if (!candidate.includes(archiveSegment)) return candidate;
  const unpacked = candidate.replace(
    archiveSegment,
    `${path.sep}app.asar.unpacked${path.sep}`,
  );
  return fileExists(unpacked) ? unpacked : candidate;
}
