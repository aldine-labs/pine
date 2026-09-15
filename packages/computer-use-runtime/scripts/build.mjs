import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const packageRoot = path.resolve(fileURLToPath(import.meta.url), "../..");
const vendorRoot = path.join(packageRoot, "vendor", "munim-computer-use");
const outputRoot = path.join(packageRoot, "pine-computer-use");
const executableName =
  process.platform === "win32" ? "pine-computer-use.exe" : "pine-computer-use";
const outputExecutable = path.join(outputRoot, "bin", executableName);

function latestModifiedAt(root) {
  let latest = 0;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name === ".build" || entry.name === "target") continue;
    const entryPath = path.join(root, entry.name);
    latest = Math.max(
      latest,
      entry.isDirectory()
        ? latestModifiedAt(entryPath)
        : statSync(entryPath).mtimeMs,
    );
  }
  return latest;
}

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: buildEnvironment(),
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} exited with status ${result.status ?? "unknown"}`,
    );
  }
}

function commandOutput(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env: buildEnvironment(),
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr || `${command} failed`);
  }
  return result.stdout.trim();
}

function buildEnvironment() {
  const cacheRoot = path.join(nativeSourceRoot, ".build", "pine-cache");
  mkdirSync(cacheRoot, { recursive: true });
  return {
    ...process.env,
    CLANG_MODULE_CACHE_PATH: path.join(cacheRoot, "clang"),
    SWIFTPM_MODULECACHE_OVERRIDE: path.join(cacheRoot, "swiftpm"),
  };
}

const nativeSourceRoot =
  process.platform === "darwin"
    ? path.join(vendorRoot, "macos")
    : path.join(vendorRoot, "windows-linux");
const nativeIsCurrent =
  existsSync(outputExecutable) &&
  statSync(outputExecutable).mtimeMs >= latestModifiedAt(nativeSourceRoot);

if (!nativeIsCurrent) {
  let builtExecutable;
  if (process.platform === "darwin") {
    run("swift", [
      "build",
      "-c",
      "release",
      "--package-path",
      nativeSourceRoot,
    ]);
    const binPath = commandOutput("swift", [
      "build",
      "-c",
      "release",
      "--show-bin-path",
      "--package-path",
      nativeSourceRoot,
    ]);
    builtExecutable = path.join(binPath, "munim-computer-use");
  } else {
    run("cargo", [
      "build",
      "--release",
      "--manifest-path",
      path.join(nativeSourceRoot, "Cargo.toml"),
    ]);
    builtExecutable = path.join(
      nativeSourceRoot,
      "target",
      "release",
      process.platform === "win32"
        ? "munim-computer-use.exe"
        : "munim-computer-use",
    );
  }
  mkdirSync(path.dirname(outputExecutable), { recursive: true });
  cpSync(builtExecutable, outputExecutable);
}

const extensionOutput = path.join(outputRoot, "chrome-extension");
rmSync(extensionOutput, { recursive: true, force: true });
cpSync(path.join(vendorRoot, "chrome-extension"), extensionOutput, {
  recursive: true,
});
cpSync(
  path.join(packageRoot, "LICENSE.upstream"),
  path.join(outputRoot, "LICENSE.munim"),
);
cpSync(path.join(packageRoot, "NOTICE.md"), path.join(outputRoot, "NOTICE.md"));

console.log(
  `Prepared Pine Computer Use for ${process.platform}/${process.arch}: ${outputRoot}`,
);
