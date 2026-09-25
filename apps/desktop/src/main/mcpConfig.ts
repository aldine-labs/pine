import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import stripJsonComments from "strip-json-comments";
import type {
  PineMcpCatalog,
  PineMcpMutation,
  PineMcpSaveRequest,
  PineMcpScope,
} from "../shared/mcp";

type Config = Record<string, unknown> & {
  mcpServers?: Record<string, Record<string, unknown>>;
};

async function readConfig(filePath: string): Promise<Config> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return { mcpServers: {} };
    throw error;
  }
  const contents = stripJsonComments(raw, { trailingCommas: true });
  if (!contents.trim()) return { mcpServers: {} };
  const parsed: unknown = JSON.parse(contents);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error(`Invalid MCP configuration: ${filePath}`);
  const config = parsed as Config;
  if (
    config.mcpServers !== undefined &&
    (!config.mcpServers ||
      typeof config.mcpServers !== "object" ||
      Array.isArray(config.mcpServers))
  )
    throw new Error(`Invalid MCP servers: ${filePath}`);
  return config;
}

async function writeConfig(filePath: string, config: Config): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, {
    mode: 0o600,
  });
  await rename(temporaryPath, filePath);
}

export function mcpConfigPaths(
  projectCwd: string,
): Record<PineMcpScope, string> {
  return {
    global: path.join(homedir(), ".config", "mcp", "mcp.json"),
    project: path.join(projectCwd, ".mcp.json"),
  };
}

export async function listMcpServers(
  projectCwd: string,
): Promise<PineMcpCatalog> {
  const paths = mcpConfigPaths(projectCwd);
  const servers: PineMcpCatalog["servers"] = [];
  for (const scope of ["global", "project"] as const) {
    const config = await readConfig(paths[scope]);
    for (const [name, definition] of Object.entries(config.mcpServers ?? {})) {
      servers.push({ name, scope, definition });
    }
  }
  return { paths, servers };
}

export async function saveMcpServer(
  projectCwd: string,
  request: PineMcpSaveRequest,
): Promise<void> {
  const filePath = mcpConfigPaths(projectCwd)[request.scope];
  const config = await readConfig(filePath);
  const servers = { ...config.mcpServers };
  if (request.previousName && request.previousName !== request.name)
    delete servers[request.previousName];
  servers[request.name] = request.definition;
  await writeConfig(filePath, { ...config, mcpServers: servers });
}

export async function removeMcpServer(
  projectCwd: string,
  request: PineMcpMutation,
): Promise<void> {
  const filePath = mcpConfigPaths(projectCwd)[request.scope];
  const config = await readConfig(filePath);
  const servers = { ...config.mcpServers };
  delete servers[request.name];
  await writeConfig(filePath, { ...config, mcpServers: servers });
}
