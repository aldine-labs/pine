import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { removeMcpServer, saveMcpServer } from "../mcpConfig";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("MCP project config", () => {
  it("preserves other servers and settings while editing a JSONC file", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "pine-mcp-"));
    roots.push(root);
    const filePath = path.join(root, ".mcp.json");
    await writeFile(
      filePath,
      '{ "settings": { "allowInstall": false }, "mcpServers": { "existing": { "url": "https://example.com/mcp" }, }, } // comment\n',
    );

    await saveMcpServer(root, {
      projectId: "unused",
      scope: "project",
      name: "local",
      definition: { command: "node", args: ["server.js"] },
    });
    const saved = JSON.parse(await readFile(filePath, "utf8"));
    expect(saved.settings.allowInstall).toBe(false);
    expect(saved.mcpServers.existing.url).toBe("https://example.com/mcp");
    expect(saved.mcpServers.local).toEqual({
      command: "node",
      args: ["server.js"],
    });

    await removeMcpServer(root, {
      projectId: "unused",
      scope: "project",
      name: "local",
    });
    const removed = JSON.parse(await readFile(filePath, "utf8"));
    expect(removed.mcpServers).toEqual({
      existing: { url: "https://example.com/mcp" },
    });
  });
});
