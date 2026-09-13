import { createHash } from "node:crypto";
import { createReadStream, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const assetsDirectory = process.env.ASSETS_DIRECTORY;
if (!assetsDirectory) throw new Error("ASSETS_DIRECTORY is required");

async function sha256(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

const names = readdirSync(assetsDirectory)
  .filter((name) => /\.(dmg|exe|nupkg)$/i.test(name))
  .sort();
if (names.length === 0) throw new Error("No release assets were found");

const lines = [];
for (const name of names) {
  lines.push(`${await sha256(path.join(assetsDirectory, name))}  ${name}`);
}
writeFileSync(
  path.join(assetsDirectory, "SHA256SUMS"),
  `${lines.join("\n")}\n`,
);
