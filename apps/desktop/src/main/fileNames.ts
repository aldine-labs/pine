import sanitizeFilename from "sanitize-filename";
import { isValidProjectEntryName } from "../shared/fileNames";

/** Main-process validation remains authoritative for every file operation. */
export function isValidHostProjectEntryName(
  name: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return (
    isValidProjectEntryName(name, platform) &&
    (platform !== "win32" ||
      sanitizeFilename(name, { replacement: "\ufffd" }) === name)
  );
}
