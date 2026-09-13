const WINDOWS_RESERVED_NAME =
  /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\..*)?$/iu;

export function isValidProjectEntryName(
  name: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (
    name.trim().length === 0 ||
    /[\\/\u0000-\u001f]/u.test(name) ||
    name === "." ||
    name === ".."
  ) {
    return false;
  }
  return (
    platform !== "win32" ||
    (!/[<>:"|?*\u0080-\u009f]/u.test(name) &&
      !WINDOWS_RESERVED_NAME.test(name) &&
      !/[. ]$/u.test(name))
  );
}
