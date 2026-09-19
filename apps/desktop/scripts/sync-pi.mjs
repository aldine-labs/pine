#!/usr/bin/env bun
/**
 * Builds Pine's Pi source dependency from the upstream repository instead of npm.
 *
 * Pi publishes `@earendil-works/pi-*` from a monorepo whose generated model
 * catalogs (chat and image) move faster than the releases: the image catalog on
 * `main` can be weeks ahead of the newest npm version, and Pine reads that
 * catalog directly for its model pickers. This script keeps a shallow clone in
 * `.pi-src/`, builds `@earendil-works/pi-ai`, and drops the built output into
 * `node_modules/@earendil-works/pi-ai`, together with the dependency versions
 * that build declares.
 *
 * It is wired to `predev` and `prebuild`; see docs/architecture/pi-source-sync.md
 * for the full contract, the escape hatches, and how to get back to npm.
 */
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "../../..");
const SOURCE_DIR = path.resolve(
  REPO_ROOT,
  process.env.PI_SYNC_DIR ?? ".pi-src",
);
const STATE_FILE = path.join(SOURCE_DIR, "pi-sync-state.json");
/** `git clean` runs inside the clone; this file is the sync's own bookkeeping. */
const STATE_FILE_NAME = path.basename(STATE_FILE);
const NODE_MODULES = path.join(REPO_ROOT, "node_modules");

const DEFAULT_REPO = "https://github.com/earendil-works/pi.git";
const DEFAULT_REF = "main";

/** Written into every overlaid package so a stray `bun install` is detectable. */
const MARKER_FILE = ".pine-pi-sync.json";

/**
 * The packages this script rebuilds from upstream, in build order.
 *
 * The scope is deliberately one package. `@earendil-works/pi-ai` owns the
 * generated model catalogs that lag npm the longest — both `gpt-image-2.5`
 * models reached `main` on 2026-09-16, eleven days after the 0.85.1 release —
 * and its public API barely moves, so swapping it under the released
 * `pi-agent-core` and `pi-coding-agent` gives Pine a current catalog without
 * dragging upstream's in-flight API churn into our own typecheck.
 *
 * Widening the list to the whole runtime closure (chord, pi-tui, pi-telemetry,
 * pi-agent-core, pi-coding-agent) works mechanically — the script builds and
 * installs every entry the same way — but it does pull that churn in: building
 * `pi-agent-core` from `main` today already breaks `runtime.ts`, because
 * `CompactionSettings` gained a required `modelOverrides` field. Add packages
 * here only when Pine needs something npm has not shipped, and expect to adapt
 * our code in the same change.
 *
 * `extraPaths` are non-`dist` folders from the published file list that the
 * runtime may touch, such as Pi's bundled native prebuilds.
 */
const PACKAGES = [
  { build: "build", dir: "packages/ai", name: "@earendil-works/pi-ai" },
];

const HELP = `Usage: bun run sync:pi [options]

Builds @earendil-works/pi-ai from https://github.com/earendil-works/pi and
installs the result into node_modules. See docs/architecture/pi-source-sync.md.

Options:
  --ref <ref>   Branch, tag, or commit to build (default: main, or PI_REF)
  --strict      Exit non-zero when the sync fails instead of warning
  --check       Only verify the installed overlay, never touch the network
  --force       Rebuild even when the recorded commit is unchanged
  --verbose     Stream every git/npm/bun command in full
  --quiet       Print warnings and errors only
  -h, --help    Show this message

Environment:
  PI_SYNC=off        Skip the sync entirely (used by the pre-hooks)
  PI_REF=<ref>       Same as --ref
  PI_SYNC_REPO=<url> Clone from another remote (forks, mirrors)
  PI_SYNC_DIR=<dir>  Keep the clone somewhere other than .pi-src
`;

function parseArgs(argv) {
  const options = {
    check: false,
    force: false,
    quiet: false,
    ref: process.env.PI_REF?.trim() || DEFAULT_REF,
    strict: false,
    verbose: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--check") options.check = true;
    else if (argument === "--force") options.force = true;
    else if (argument === "--quiet") options.quiet = true;
    else if (argument === "--strict") options.strict = true;
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
  if (!options.quiet) process.stdout.write(`[pi-sync] ${message}\n`);
}

function warn(message) {
  process.stderr.write(`[pi-sync] ${message}\n`);
}

/**
 * Runs a command, buffering its output so a failure stays readable in CI. With
 * `--verbose` the command streams instead, which is what you want when a build
 * starts failing after an upstream change.
 */
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

function git(args, rest) {
  return run("git", ["-C", SOURCE_DIR, ...args], rest);
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

function writeState(state) {
  writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
}

function packageDirectory(name) {
  return path.join(NODE_MODULES, ...name.split("/"));
}

function readInstalledVersion(name) {
  const manifestPath = path.join(packageDirectory(name), "package.json");
  if (!existsSync(manifestPath)) return null;
  try {
    return readJson(manifestPath).version ?? null;
  } catch {
    return null;
  }
}

/** True when every overlaid package still carries the marker for `sha`. */
function overlayMatches(sha) {
  return PACKAGES.every((entry) => {
    const markerPath = path.join(packageDirectory(entry.name), MARKER_FILE);
    if (!existsSync(markerPath)) return false;
    try {
      return readJson(markerPath).sha === sha;
    } catch {
      return false;
    }
  });
}

function describeOverlay(sha) {
  return PACKAGES.map((entry) => {
    const markerPath = path.join(packageDirectory(entry.name), MARKER_FILE);
    const version = readInstalledVersion(entry.name);
    const synced = existsSync(markerPath)
      ? (readJson(markerPath).sha ?? "").slice(0, 8)
      : "npm";
    return `  ${entry.name} ${version ?? "missing"} (source: ${synced})`;
  }).join("\n");
}

/** Clones or fast-forwards `.pi-src` to the requested ref. */
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
  // Drops sources deleted upstream. Ignored build output and node_modules stay,
  // and the excluded state file survives because it lives inside the worktree.
  git(["clean", "-fdq", "-e", STATE_FILE_NAME]);
  const head = git(["rev-parse", "HEAD"]).trim();
  const committedAt = git(["show", "-s", "--format=%cI", "HEAD"]).trim();
  const subject = git(["show", "-s", "--format=%s", "HEAD"]).trim();
  return { committedAt, head, subject };
}

function installSourceDependencies() {
  log("installing upstream build dependencies (npm, scripts disabled)");
  run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"], {
    cwd: SOURCE_DIR,
  });
}

/** Builds every package in dependency order inside the clone. */
function buildPackages() {
  for (const entry of PACKAGES) {
    const cwd = path.join(SOURCE_DIR, entry.dir);
    if (!existsSync(cwd)) {
      throw new Error(
        `${entry.dir} is missing from ${options.ref}; upstream renamed or moved it`,
      );
    }
    log(`building ${entry.name} (npm run ${entry.build})`);
    run("npm", ["run", entry.build], { cwd });
  }
}

/**
 * Copies the upstream build of every package into node_modules, together with
 * the dependency versions that build declares.
 *
 * The runtime dependencies are installed per package into a staging directory
 * outside the repository and then copied in, which keeps the versions Pi expects
 * nested under Pi instead of overwriting the versions the rest of the app
 * resolved. Sibling `@earendil-works/*` copies are dropped afterwards so every
 * Pi package in a sync comes from the same commit.
 */
/** Drops `node_modules/.bin` shims whose target disappeared. */
function pruneDanglingBinLinks(binDirectory) {
  if (!existsSync(binDirectory)) return;
  for (const entry of readdirSync(binDirectory)) {
    const link = path.join(binDirectory, entry);
    if (!existsSync(link)) rmSync(link, { force: true });
  }
}

function installOverlay() {
  const stagingRoot = mkdtempSync(path.join(os.tmpdir(), "pine-pi-overlay-"));
  try {
    for (const entry of PACKAGES) {
      const source = path.join(SOURCE_DIR, entry.dir);
      const staging = path.join(stagingRoot, entry.name.replace("/", "__"));
      mkdirSync(staging, { recursive: true });
      cpSync(
        path.join(source, "package.json"),
        path.join(staging, "package.json"),
      );
      for (const folder of ["dist", ...(entry.extraPaths ?? [])]) {
        const from = path.join(source, folder);
        if (existsSync(from)) {
          cpSync(from, path.join(staging, folder), { recursive: true });
        }
      }

      log(`installing runtime dependencies for ${entry.name}`);
      run("bun", ["install", "--production", "--ignore-scripts"], {
        cwd: staging,
      });
      rmSync(path.join(staging, "node_modules", "@earendil-works"), {
        force: true,
        recursive: true,
      });
      pruneDanglingBinLinks(path.join(staging, "node_modules", ".bin"));

      const target = packageDirectory(entry.name);
      rmSync(target, { force: true, recursive: true });
      mkdirSync(path.dirname(target), { recursive: true });
      cpSync(staging, target, { dereference: true, recursive: true });
    }
  } finally {
    rmSync(stagingRoot, { force: true, recursive: true });
  }
}

/**
 * Removes overlays this run no longer owns — a previous run with a wider
 * PACKAGES list, for example — and reinstalls their npm copies, so a shrinking
 * scope cannot leave part of the Pi runtime pinned to a different commit.
 */
function restoreUnownedOverlays() {
  const scoped = path.join(NODE_MODULES, "@earendil-works");
  if (!existsSync(scoped)) return;
  const scope = new Set(PACKAGES.map((entry) => entry.name));
  const stale = readdirSync(scoped).filter(
    (entry) =>
      !scope.has(`@earendil-works/${entry}`) &&
      existsSync(path.join(scoped, entry, MARKER_FILE)),
  );
  if (stale.length === 0) return;
  for (const entry of stale) {
    log(`restoring the npm copy of @earendil-works/${entry}`);
    rmSync(path.join(scoped, entry), { force: true, recursive: true });
  }
  run("bun", ["install", "--frozen-lockfile"], { cwd: REPO_ROOT });
}

function writeMarkers(state) {
  for (const entry of PACKAGES) {
    const markerPath = path.join(packageDirectory(entry.name), MARKER_FILE);
    writeFileSync(
      markerPath,
      `${JSON.stringify(
        {
          builtAt: state.syncedAt,
          ref: state.ref,
          sha: state.sha,
          source: state.repository,
        },
        null,
        2,
      )}\n`,
    );
  }
}

/**
 * Imports the freshly installed overlay the same way the agent process does, so
 * a broken build fails here instead of at runtime.
 */
async function verifyOverlay() {
  const { builtinImagesModels } =
    await import("@earendil-works/pi-ai/providers/all");
  const imageModels = builtinImagesModels().getModels("openrouter").length;
  await import("@earendil-works/pi-coding-agent");
  await import("@earendil-works/pi-agent-core/node");
  return { imageModels };
}

function report(result) {
  log(
    `synced ${result.sha.slice(0, 8)} (${result.ref}, ${result.committedAt})`,
  );
  log(`  subject: ${result.subject}`);
  log(`  openrouter image models: ${result.imageModels}`);
  for (const entry of PACKAGES) {
    log(`  ${entry.name} ${readInstalledVersion(entry.name) ?? "missing"}`);
  }
}

function checkOnly() {
  const state = readState();
  if (!state) {
    warn("no recorded sync; run `bun run sync:pi` first");
    return false;
  }
  const matches = overlayMatches(state.sha);
  log(
    `recorded ${state.sha.slice(0, 8)} from ${state.syncedAt}; overlay ${
      matches ? "in place" : "missing or replaced"
    }`,
  );
  log(describeOverlay(state.sha));
  return matches;
}

async function sync() {
  const repository = process.env.PI_SYNC_REPO?.trim() || DEFAULT_REPO;
  restoreUnownedOverlays();
  const source = checkoutSource(options.ref);
  const state = readState();
  if (
    !options.force &&
    state?.sha === source.head &&
    overlayMatches(source.head)
  ) {
    log(
      `already at ${source.head.slice(0, 8)} (${options.ref}), ${
        state.imageModels ?? "?"
      } openrouter image models`,
    );
    return;
  }

  if (
    state?.sha !== source.head ||
    !existsSync(path.join(SOURCE_DIR, "node_modules"))
  ) {
    installSourceDependencies();
  }
  buildPackages();
  installOverlay();
  // Import the overlay before recording it: a build that cannot even load must
  // not look like a successful sync.
  const { imageModels } = await verifyOverlay();
  const syncedAt = new Date().toISOString();
  writeMarkers({
    committedAt: source.committedAt,
    ref: options.ref,
    repository,
    sha: source.head,
    subject: source.subject,
    syncedAt,
  });
  writeState({
    committedAt: source.committedAt,
    imageModels,
    packages: PACKAGES.map((entry) => ({
      name: entry.name,
      version: readInstalledVersion(entry.name),
    })),
    ref: options.ref,
    repository,
    sha: source.head,
    subject: source.subject,
    syncedAt,
  });
  report({ ...source, imageModels, ref: options.ref, sha: source.head });
}

if (process.env.PI_SYNC?.trim() === "off") {
  log("skipped (PI_SYNC=off)");
  process.exit(0);
}

if (options.check) {
  process.exit(checkOnly() ? 0 : 1);
}

try {
  await sync();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const state = readState();
  const hasOverlay = state ? overlayMatches(state.sha) : false;
  warn(`sync failed: ${message}`);
  if (hasOverlay) {
    warn(
      `keeping the previous overlay (${state.sha.slice(0, 8)}, ${state.syncedAt})`,
    );
  } else {
    warn("node_modules still holds the npm releases of the Pi packages");
  }
  if (options.strict) {
    warn("failing because --strict was requested");
    process.exit(1);
  }
  warn("continuing; rerun `bun run sync:pi` to retry, or PI_SYNC=off to mute");
  process.exit(0);
}
