import { AsyncLocalStorage } from "node:async_hooks";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import type { AgentFolderGrant } from "./protocol";

const accessAttempt = new AsyncLocalStorage<{
  denial?: PathAccessDeniedError;
}>();

export class PathAccessDeniedError extends Error {
  constructor(message: string) {
    super(message);
    const attempt = accessAttempt.getStore();
    if (attempt) attempt.denial = this;
  }
}

/** Pi may wrap operation errors. Preserve policy identity without parsing text. */
export function preserveAccessDenial<T>(
  operation: () => Promise<T>,
): Promise<T> {
  return accessAttempt.run({}, async () => {
    try {
      return await operation();
    } catch (error) {
      throw accessAttempt.getStore()?.denial ?? error;
    }
  });
}

type AccessMode = "read" | "write";

interface CanonicalFolderGrant extends AgentFolderGrant {
  path: string;
}

export function pathContains(
  parentPath: string,
  candidatePath: string,
): boolean {
  const relativePath = path.relative(parentPath, candidatePath);
  return (
    relativePath === "" ||
    (!relativePath.startsWith(`..${path.sep}`) &&
      relativePath !== ".." &&
      !path.isAbsolute(relativePath))
  );
}

/**
 * Read-only paths explicitly selected by the user as message attachments.
 * Grants accumulate for the live session. Files match exactly; directories
 * include descendants after realpath canonicalization.
 */
export class PineAttachedPathAccess {
  private readonly paths = new Set<string>();

  async grant(targetPaths: readonly string[]): Promise<void> {
    const canonicalPaths = await Promise.allSettled(
      targetPaths.map((targetPath) => realpath(path.resolve(targetPath))),
    );
    for (const result of canonicalPaths) {
      if (result.status === "fulfilled") this.paths.add(result.value);
    }
  }

  allowsRead(canonicalPath: string): boolean {
    return [...this.paths].some((attachedPath) =>
      pathContains(attachedPath, canonicalPath),
    );
  }

  readablePaths(): string[] {
    return [...this.paths];
  }
}

async function canonicalizeTarget(
  targetPath: string,
  allowMissing: boolean,
): Promise<string> {
  try {
    return await realpath(targetPath);
  } catch (error) {
    if (!allowMissing || (error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  const missingSegments: string[] = [];
  let ancestorPath = path.resolve(targetPath);
  while (true) {
    try {
      await lstat(ancestorPath);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parentPath = path.dirname(ancestorPath);
      if (parentPath === ancestorPath) throw error;
      missingSegments.unshift(path.basename(ancestorPath));
      ancestorPath = parentPath;
    }
  }

  const canonicalAncestor = await realpath(ancestorPath);
  return path.join(canonicalAncestor, ...missingSegments);
}

export class PineToolAccessPolicy {
  private constructor(
    readonly cwd: string,
    readonly folders: CanonicalFolderGrant[],
    private readonly attachedPaths?: PineAttachedPathAccess,
    private readonly dynamicFolders?: () => readonly AgentFolderGrant[],
    private readonly permissive = false,
  ) {}

  static async create(
    cwd: string,
    folders: AgentFolderGrant[],
    attachedPaths?: PineAttachedPathAccess,
    dynamicFolders?: () => readonly AgentFolderGrant[],
  ): Promise<PineToolAccessPolicy> {
    const canonicalFolders = await Promise.all(
      folders.map(async (folder) => ({
        ...folder,
        path: await realpath(folder.path),
      })),
    );
    const canonicalCwd = await realpath(cwd);
    const defaultGrant = canonicalFolders.find(
      (folder) =>
        folder.access === "read-write" &&
        pathContains(folder.path, canonicalCwd),
    );
    if (!defaultGrant) {
      throw new Error(
        "The project default folder must be an available read-write folder.",
      );
    }
    return new PineToolAccessPolicy(
      canonicalCwd,
      canonicalFolders,
      attachedPaths,
      dynamicFolders,
      false,
    );
  }

  /**
   * A policy that authorizes every path. It is only used after an approval
   * gate explicitly allows a denied file operation to cross folder grants.
   */
  static permissive(cwd: string): PineToolAccessPolicy {
    return new PineToolAccessPolicy(cwd, [], undefined, undefined, true);
  }

  async authorize(
    targetPath: string,
    mode: AccessMode,
    options: { allowMissing?: boolean } = {},
  ): Promise<string> {
    const canonicalPath = await canonicalizeTarget(
      path.resolve(targetPath),
      options.allowMissing ?? false,
    );
    if (this.permissive) return canonicalPath;
    if (mode === "read" && this.attachedPaths?.allowsRead(canonicalPath)) {
      return canonicalPath;
    }
    const containingGrants = this.folders.filter((folder) =>
      pathContains(folder.path, canonicalPath),
    );
    const dynamicGrants = await Promise.all(
      (this.dynamicFolders?.() ?? []).map(async (folder) => ({
        ...folder,
        path: await canonicalizeTarget(folder.path, true),
      })),
    );
    containingGrants.push(
      ...dynamicGrants.filter((folder) =>
        pathContains(folder.path, canonicalPath),
      ),
    );
    const containingGrant = containingGrants[0];
    if (!containingGrant) {
      throw new PathAccessDeniedError(
        `Path is outside the folders shared with Pine: ${targetPath}`,
      );
    }
    if (
      mode === "write" &&
      !containingGrants.some((folder) => folder.access === "read-write")
    ) {
      throw new PathAccessDeniedError(
        `Folder is read-only: ${containingGrant.path}`,
      );
    }
    return canonicalPath;
  }

  writableFolders(): string[] {
    if (this.permissive) return [];
    return this.folders
      .filter((folder) => folder.access === "read-write")
      .map((folder) => folder.path)
      .concat(
        (this.dynamicFolders?.() ?? [])
          .filter((folder) => folder.access === "read-write")
          .map((folder) => folder.path),
      );
  }

  readablePaths(): string[] {
    return [
      ...this.folders.map((folder) => folder.path),
      ...(this.dynamicFolders?.() ?? []).map((folder) => folder.path),
      ...(this.attachedPaths?.readablePaths() ?? []),
    ];
  }
}
