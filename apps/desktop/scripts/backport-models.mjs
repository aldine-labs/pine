#!/usr/bin/env bun
/**
 * Backports the newest Pi model lists onto the npm-installed `pi-ai`.
 *
 * Pi publishes its model catalogs as generated data committed upstream at
 * release time, and npm only sees the result at the next release — the two
 * `gpt-image-2.5` image models reached `main` on 2026-09-16, eleven days after
 * 0.85.1 shipped with 52 OpenRouter image models instead of 54. Waiting for the
 * next release means Pine ships a stale list for weeks.
 *
 * This script closes that gap without touching a single line of Pi's code: it
 * builds `packages/ai` upstream, then copies the generated catalog files (and
 * the provider data they import) into the installed npm package. Only data
 * moves, so the runtime contract between `pi-ai` and `pi-coding-agent` stays
 * exactly what was released, and the published version numbers stay untouched.
 * See docs/architecture/pi-model-backport.md.
 */
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "../../..");
const SOURCE_DIR = path.resolve(
  REPO_ROOT,
  process.env.PI_SYNC_DIR ?? ".pi-src",
);
const STATE_FILE = path.join(SOURCE_DIR, "pi-backport-state.json");
const STATE_FILE_NAME = path.basename(STATE_FILE);
const BACKUP_DIR = path.join(REPO_ROOT, ".pi-backport-backup");
const PACKAGE_DIR = path.join(
  REPO_ROOT,
  "node_modules",
  "@earendil-works",
  "pi-ai",
);

const DEFAULT_REPO = "https://github.com/earendil-works/pi.git";
const DEFAULT_REF = "main";
const PACKAGE_VERSION = "0.85.1";

/** Written into the patched package so a reinstall is detectable. */
const MARKER_FILE = ".pine-model-backport.json";
const MANIFEST_FILE = "backport-files.json";

/**
 * The generated catalog surface, relative to `dist/`. These files are data:
 * `models.generated.js` only imports the per-provider `*.models.js` files, those
 * only import `./data/*.json` and `../model-catalog.js`, and npm 0.85.1 ships a
 * byte-identical `model-catalog.js`. Nothing here reaches into Pi's runtime.
 *
 * `.d.ts` files stay as npm shipped them: the runtime shape is identical and
 * keeping the released types avoids churning our own typecheck.
 */
const GENERATED_FILES = [
  "dist/image-models.generated.js",
  "dist/models.generated.js",
];
const GENERATED_DIRECTORIES = ["dist/providers/data"];
const GENERATED_GLOB_DIRECTORY = "dist/providers";
const GENERATED_GLOB_SUFFIX = ".models.js";

const HELP = `Usage: bun run backport:models [options]

Copies the newest Pi model lists from https://github.com/earendil-works/pi onto
the npm-installed @earendil-works/pi-ai. See docs/architecture/pi-model-backport.md.

Options:
  --ref <ref>   Branch, tag, or commit to read the catalogs from (default: main)
  --restore     Put the released catalog files back and stop
  --check       Report the current state without touching anything
  --force       Re-apply even when the recorded commit is unchanged
  --verbose     Stream every git/npm command
  --quiet       Print warnings and errors only
  -h, --help    Show this message

Environment:
  PI_SYNC_DIR=<dir>  Keep the upstream clone somewhere other than .pi-src
  PI_SYNC_REPO=<url> Clone from another remote (forks, mirrors)
`;

function parseArgs(argv) {
  const options = {
    check: false,
    force: false,
    quiet: false,
    ref: process.env.PI_REF?.trim() || DEFAULT_REF,
    restore: false,
    verbose: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--check") options.check = true;
    else if (argument === "--restore") options.restore = true;
    else if (argument === "--force") options.force = true;
    else if (argument === "--quiet") options.quiet = true;
    else if (argument === "--verbose") options.verbose = true;
    else if (argument === "-h" || argument === "--help") {
      process.stdout.write(HELP);
      process.exit(0);
    } else if (argument === "--ref") {
      const value = argv[index + 1];
      if (!value) throw new Error("--ref needs a branch, tag, or commit");
      options.ref = value;
      index += 1;
    } else if (argument.startsWith("--ref=")) {
      options.ref = argument.slice("--ref=".length);
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));

function log(message) {
  if (!options.quiet) process.stdout.write(`[pi-models] ${message}\n`);
}

function warn(message) {
  process.stderr.write(`[pi-models] ${message}\n`);
}

function run(command, args, { stream = options.verbose, ...rest } = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: stream ? "inherit" : "pipe",
    ...rest,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const output = [result.stdout, result.stderr]
      .filter(Boolean)
      .join("\n")
      .trim();
    throw new Error(
      [
        `\`${command} ${args.join(" ")}\` exited with ${result.status}`,
        output ? `\n${output.split("\n").slice(-40).join("\n")}` : "",
      ].join(""),
    );
  }
  return result.stdout ?? "";
}

function git(args) {
  return run("git", ["-C", SOURCE_DIR, ...args]);
}

function npm(args, options = {}) {
  // Windows exposes npm as a .cmd batch file, which must run through a shell.
  return run("npm", args, {
    ...options,
    shell: process.platform === "win32",
  });
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function readState() {
  if (!existsSync(STATE_FILE)) return null;
  try {
    return readJson(STATE_FILE);
  } catch {
    return null;
  }
}

/** Every generated catalog file, relative to the upstream build's root. */
function generatedCatalogFiles() {
  const files = [...GENERATED_FILES];
  const buildRoot = path.join(SOURCE_DIR, "packages", "ai");
  for (const entry of readdirSync(
    path.join(buildRoot, GENERATED_GLOB_DIRECTORY),
  )) {
    if (entry.endsWith(GENERATED_GLOB_SUFFIX)) {
      files.push(`${GENERATED_GLOB_DIRECTORY}/${entry}`);
    }
  }
  for (const directory of GENERATED_DIRECTORIES) {
    for (const entry of readdirSync(path.join(buildRoot, directory))) {
      files.push(`${directory}/${entry}`);
    }
  }
  return files;
}

function readMarker() {
  const markerPath = path.join(PACKAGE_DIR, MARKER_FILE);
  if (!existsSync(markerPath)) return null;
  try {
    return readJson(markerPath);
  } catch {
    return null;
  }
}

/** Model counts from the currently installed catalog. */
async function catalogCountsInProcess() {
  const { builtinImagesModels, builtinModels } =
    await import("@earendil-works/pi-ai/providers/all");
  const models = builtinModels();
  return {
    chat: models
      .getProviders()
      .reduce(
        (total, provider) => total + models.getModels(provider.id).length,
        0,
      ),
    image: builtinImagesModels().getModels("openrouter").length,
  };
}

/**
 * Counts in a fresh process. Needed for the "before" numbers: importing the
 * catalogs caches them, so a later import in this process would keep reporting
 * the state from before the copy.
 */
function catalogCountsInChildProcess() {
  const script = [
    'const { builtinImagesModels, builtinModels } = await import("@earendil-works/pi-ai/providers/all");',
    "const models = builtinModels();",
    "process.stdout.write(JSON.stringify({",
    "  chat: models.getProviders().reduce((total, provider) => total + models.getModels(provider.id).length, 0),",
    '  image: builtinImagesModels().getModels("openrouter").length,',
    "}));",
  ].join("\n");
  const output = run("bun", ["-e", script], { cwd: REPO_ROOT });
  return JSON.parse(output);
}

function assertReleasedPackage() {
  const manifestPath = path.join(PACKAGE_DIR, "package.json");
  if (!existsSync(manifestPath)) {
    throw new Error(
      "node_modules/@earendil-works/pi-ai is missing; run `bun install` first",
    );
  }
  const version = readJson(manifestPath).version;
  if (version !== PACKAGE_VERSION) {
    warn(
      `pi-ai ${version} is installed, but this script was written for the released ${PACKAGE_VERSION} layout; verify the file list before trusting the result`,
    );
  }
}

function checkoutSource(ref) {
  const repository = process.env.PI_SYNC_REPO?.trim() || DEFAULT_REPO;
  if (!existsSync(path.join(SOURCE_DIR, ".git"))) {
    rmSync(SOURCE_DIR, { force: true, recursive: true });
    log(`cloning ${repository} into ${path.relative(REPO_ROOT, SOURCE_DIR)}`);
    run("git", ["clone", "--depth", "1", "--no-tags", repository, SOURCE_DIR]);
  }
  log(`fetching ${ref}`);
  git(["fetch", "--depth", "1", "--no-tags", "origin", ref]);
  git(["checkout", "--force", "--detach", "FETCH_HEAD"]);
  git(["clean", "-fdq", "-e", STATE_FILE_NAME]);
  return {
    committedAt: git(["show", "-s", "--format=%cI", "HEAD"]).trim(),
    head: git(["rev-parse", "HEAD"]).trim(),
    subject: git(["show", "-s", "--format=%s", "HEAD"]).trim(),
  };
}

/** Builds upstream `packages/ai` so its generated catalogs are compiled. */
function buildCatalogs() {
  if (!existsSync(path.join(SOURCE_DIR, "node_modules"))) {
    log("installing upstream build dependencies (npm, scripts disabled)");
    npm(["install", "--ignore-scripts", "--no-audit", "--no-fund"], {
      cwd: SOURCE_DIR,
    });
  }
  log("building @earendil-works/pi-ai catalogs");
  npm(["run", "build"], {
    cwd: path.join(SOURCE_DIR, "packages", "ai"),
  });
}

function backUpReleasedFiles(files) {
  if (existsSync(path.join(BACKUP_DIR, MANIFEST_FILE))) return;
  for (const relativePath of files) {
    const source = path.join(PACKAGE_DIR, relativePath);
    if (!existsSync(source)) continue;
    const target = path.join(BACKUP_DIR, relativePath);
    mkdirSync(path.dirname(target), { recursive: true });
    cpSync(source, target, { recursive: true });
  }
  writeFileSync(
    path.join(BACKUP_DIR, MANIFEST_FILE),
    `${JSON.stringify({ files, packageVersion: PACKAGE_VERSION }, null, 2)}\n`,
  );
}

function restoreReleasedFiles() {
  const manifestPath = path.join(BACKUP_DIR, MANIFEST_FILE);
  if (!existsSync(manifestPath)) return false;
  const { files } = readJson(manifestPath);
  for (const relativePath of files) {
    const source = path.join(BACKUP_DIR, relativePath);
    if (!existsSync(source)) continue;
    const target = path.join(PACKAGE_DIR, relativePath);
    mkdirSync(path.dirname(target), { recursive: true });
    cpSync(source, target, { recursive: true });
  }
  rmSync(path.join(PACKAGE_DIR, MARKER_FILE), { force: true });
  return true;
}

async function check() {
  const marker = readMarker();
  if (!marker) {
    const counts = await catalogCountsInProcess();
    log(
      `no backport installed; released catalogs (${counts.chat} chat models, ${counts.image} openrouter image models)`,
    );
    return true;
  }
  const counts = await catalogCountsInProcess();
  log(
    `backported ${marker.sha?.slice(0, 8) ?? "?"} (${marker.ref}, ${marker.appliedAt})`,
  );
  log(`  ${counts.chat} chat models, ${counts.image} openrouter image models`);
  return true;
}

async function backport() {
  assertReleasedPackage();
  const repository = process.env.PI_SYNC_REPO?.trim() || DEFAULT_REPO;
  const source = checkoutSource(options.ref);
  const state = readState();
  if (!options.force && state?.sha === source.head && readMarker()) {
    log(`already backported from ${source.head.slice(0, 8)} (${options.ref})`);
    return;
  }

  const before = catalogCountsInChildProcess();
  buildCatalogs();

  const files = generatedCatalogFiles();
  backUpReleasedFiles(files);
  for (const relativePath of files) {
    const from = path.join(SOURCE_DIR, "packages", "ai", relativePath);
    if (!existsSync(from)) continue;
    const to = path.join(PACKAGE_DIR, relativePath);
    mkdirSync(path.dirname(to), { recursive: true });
    cpSync(from, to, { recursive: true });
  }

  const appliedAt = new Date().toISOString();
  writeFileSync(
    path.join(PACKAGE_DIR, MARKER_FILE),
    `${JSON.stringify(
      { appliedAt, files, ref: options.ref, repository, sha: source.head },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    STATE_FILE,
    `${JSON.stringify(
      { appliedAt, ref: options.ref, repository, sha: source.head },
      null,
      2,
    )}\n`,
  );

  // Import the patched catalog before reporting success: a roster that no
  // longer loads is worse than a stale one.
  const after = await catalogCountsInProcess();
  log(
    `backported ${source.head.slice(0, 8)} (${options.ref}, ${source.committedAt})`,
  );
  log(`  subject: ${source.subject}`);
  log(
    `  image models: ${before.image} -> ${after.image}, chat models: ${before.chat} -> ${after.chat}`,
  );
  if (after.chat === 0 || after.image === 0) {
    throw new Error(
      "the backported catalogs are empty; restore with `--restore` and report this",
    );
  }
  log("  restore with `bun run backport:models --restore`");
}

function restore() {
  if (!restoreReleasedFiles()) {
    warn(
      "no backup found; reinstall the released package with `rm -rf node_modules/@earendil-works/pi-ai && bun install`",
    );
    return;
  }
  rmSync(STATE_FILE, { force: true });
  log("released catalog files restored");
}

try {
  if (options.check) {
    await check();
  } else if (options.restore) {
    restore();
  } else {
    await backport();
  }
} catch (error) {
  warn(`failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
