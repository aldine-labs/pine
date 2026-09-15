import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(fileURLToPath(import.meta.url), "../..");
const executable = path.join(
  packageRoot,
  "pine-computer-use",
  "bin",
  process.platform === "win32" ? "pine-computer-use.exe" : "pine-computer-use",
);
const child = spawn(executable, [], {
  env: { ...process.env, COMPUTER_USE_BROWSER: "1" },
  stdio: ["pipe", "pipe", "inherit"],
});

let stdout = "";
child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  stdout += chunk;
});

child.stdin.write(
  `${JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list",
    params: {},
  })}\n`,
);
child.stdin.end();

const exitCode = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", resolve);
});
if (exitCode !== 0)
  throw new Error(`Pine Computer Use exited with ${exitCode}`);

const response = JSON.parse(stdout.trim());
if (!Array.isArray(response?.result?.tools)) {
  throw new Error("Pine Computer Use returned no tool definitions.");
}
await writeFile(
  path.join(packageRoot, "tool-specs.json"),
  `${JSON.stringify(response.result.tools, null, 2)}\n`,
  "utf8",
);
console.log(
  `Wrote ${response.result.tools.length} Computer Use tool definitions.`,
);
