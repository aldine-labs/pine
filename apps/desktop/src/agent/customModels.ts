import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import type {
  AddCustomModelRequest,
  CustomModelDefinition,
  DeleteCustomModelRequest,
  DeleteCustomProviderRequest,
  PineThinkingLevel,
  UpdateCustomModelRequest,
  UpdateCustomProviderRequest,
} from "../shared/models";

const THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export interface ModelsFile {
  [key: string]: unknown;
  providers: Record<string, Record<string, unknown>>;
}

const BUILTIN_PROVIDER_IDS = new Set(
  builtinProviders().map((provider) => provider.id),
);

function stripJsonComments(input: string): string {
  return input
    .replace(/"(?:\\.|[^"\\])*"|\/\/[^\n]*/g, (match) =>
      match[0] === '"' ? match : "",
    )
    .replace(
      /"(?:\\.|[^"\\])*"|,(\s*[}\]])/g,
      (match, tail: string) => tail ?? (match[0] === '"' ? match : ""),
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readModelsFile(destination: string): Promise<ModelsFile> {
  try {
    const parsed: unknown = JSON.parse(
      stripJsonComments(await readFile(destination, "utf8")),
    );
    if (!isRecord(parsed) || !isRecord(parsed.providers)) {
      throw new Error(
        'models.json must contain a top-level "providers" object.',
      );
    }
    return parsed as ModelsFile;
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") return { providers: {} };
    throw new Error(
      `Unable to update models.json: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function readCustomModelsFile(
  agentDir: string,
): Promise<ModelsFile> {
  return readModelsFile(path.join(agentDir, "models.json"));
}

function writeModelsFile(
  destination: string,
  config: ModelsFile,
): Promise<void> {
  const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
  return writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  }).then(() => rename(temporary, destination));
}

function providerModels(
  provider: Record<string, unknown>,
  providerId: string,
): Record<string, unknown>[] {
  const models = provider.models;
  if (models !== undefined && !Array.isArray(models)) {
    throw new Error(`Provider "${providerId}" has an invalid model list.`);
  }
  if ((models ?? []).some((model) => !isRecord(model))) {
    throw new Error(`Provider "${providerId}" has an invalid model list.`);
  }
  return (models ?? []) as Record<string, unknown>[];
}

function modelDefinition(
  input: CustomModelDefinition,
): Record<string, unknown> {
  const supportedThinkingLevels = new Set(input.thinkingLevels);
  const reasoning = input.thinkingLevels.some((level) => level !== "off");
  const thinkingLevelMap: Partial<
    Record<PineThinkingLevel, PineThinkingLevel | null>
  > = {};
  if (reasoning) {
    for (const level of THINKING_LEVELS) {
      if (!supportedThinkingLevels.has(level)) thinkingLevelMap[level] = null;
      else if (level === "xhigh" || level === "max") {
        thinkingLevelMap[level] = level;
      }
    }
  }
  return {
    id: input.modelId,
    ...(input.modelName ? { name: input.modelName } : {}),
    reasoning,
    ...(reasoning ? { thinkingLevelMap } : {}),
    input: input.vision ? ["text", "image"] : ["text"],
    contextWindow: input.contextWindow,
    maxTokens: input.maxTokens,
  };
}

function requireCustomProvider(
  config: ModelsFile,
  providerId: string,
): Record<string, unknown> {
  const provider = config.providers[providerId];
  if (!provider)
    throw new Error(`Custom provider "${providerId}" was not found.`);
  if (BUILTIN_PROVIDER_IDS.has(providerId)) {
    throw new Error(`Provider "${providerId}" is not a custom provider.`);
  }
  return provider;
}

export async function addCustomModel(
  agentDir: string,
  input: AddCustomModelRequest,
): Promise<void> {
  await mkdir(agentDir, { recursive: true });
  const destination = path.join(agentDir, "models.json");
  const config = await readModelsFile(destination);
  const currentProvider = config.providers[input.providerId];

  if (currentProvider && !isRecord(currentProvider)) {
    throw new Error(
      `Provider "${input.providerId}" has an invalid configuration.`,
    );
  }

  const currentModels = currentProvider
    ? providerModels(currentProvider, input.providerId)
    : [];
  if (
    currentModels?.some(
      (model) => isRecord(model) && model.id === input.modelId,
    )
  ) {
    throw new Error(
      `Model "${input.modelId}" already exists on provider "${input.providerId}".`,
    );
  }
  if (input.providerMode === "new" && currentProvider) {
    throw new Error(
      `Provider "${input.providerId}" already exists. Select it as an existing provider instead.`,
    );
  }

  const provider = {
    ...currentProvider,
    ...(input.providerMode === "new"
      ? {
          name: input.providerName,
          baseUrl: input.baseUrl,
          apiKey: input.apiKey,
          api: input.api,
        }
      : {}),
    models: [...(currentModels ?? []), modelDefinition(input)],
  };
  const next = {
    providers: {
      ...config.providers,
      [input.providerId]: provider,
    },
  };
  await writeModelsFile(destination, { ...config, providers: next.providers });
}

export async function updateCustomModel(
  agentDir: string,
  input: UpdateCustomModelRequest,
): Promise<void> {
  await mkdir(agentDir, { recursive: true });
  const destination = path.join(agentDir, "models.json");
  const config = await readModelsFile(destination);
  const provider = config.providers[input.providerId];
  if (!provider)
    throw new Error(`Provider "${input.providerId}" was not found.`);
  const models = providerModels(provider, input.providerId);
  const index = models.findIndex((model) => model.id === input.originalModelId);
  if (index < 0) {
    throw new Error(
      `Model "${input.originalModelId}" was not found on provider "${input.providerId}".`,
    );
  }
  if (
    input.modelId !== input.originalModelId &&
    models.some((model) => model.id === input.modelId)
  ) {
    throw new Error(
      `Model "${input.modelId}" already exists on provider "${input.providerId}".`,
    );
  }
  const currentModel = models[index];
  const nextModel = { ...currentModel, ...modelDefinition(input) };
  if (!input.modelName) delete nextModel.name;
  const nextModels = [...models];
  nextModels[index] = nextModel;
  await writeModelsFile(destination, {
    ...config,
    providers: {
      ...config.providers,
      [input.providerId]: { ...provider, models: nextModels },
    },
  });
}

export async function deleteCustomModel(
  agentDir: string,
  input: DeleteCustomModelRequest,
): Promise<void> {
  await mkdir(agentDir, { recursive: true });
  const destination = path.join(agentDir, "models.json");
  const config = await readModelsFile(destination);
  const provider = config.providers[input.providerId];
  if (!provider)
    throw new Error(`Provider "${input.providerId}" was not found.`);
  const models = providerModels(provider, input.providerId);
  const nextModels = models.filter((model) => model.id !== input.modelId);
  if (nextModels.length === models.length) {
    throw new Error(
      `Model "${input.modelId}" was not found on provider "${input.providerId}".`,
    );
  }
  await writeModelsFile(destination, {
    ...config,
    providers: {
      ...config.providers,
      [input.providerId]: { ...provider, models: nextModels },
    },
  });
}

export async function updateCustomProvider(
  agentDir: string,
  input: UpdateCustomProviderRequest,
): Promise<void> {
  await mkdir(agentDir, { recursive: true });
  const destination = path.join(agentDir, "models.json");
  const config = await readModelsFile(destination);
  const provider = requireCustomProvider(config, input.providerId);
  const nextProvider = {
    ...provider,
    name: input.providerName,
    baseUrl: input.baseUrl,
    api: input.api,
    ...(input.apiKey ? { apiKey: input.apiKey } : {}),
  };
  await writeModelsFile(destination, {
    ...config,
    providers: { ...config.providers, [input.providerId]: nextProvider },
  });
}

export async function deleteCustomProvider(
  agentDir: string,
  input: DeleteCustomProviderRequest,
): Promise<void> {
  await mkdir(agentDir, { recursive: true });
  const destination = path.join(agentDir, "models.json");
  const config = await readModelsFile(destination);
  requireCustomProvider(config, input.providerId);
  const providers = { ...config.providers };
  delete providers[input.providerId];
  await writeModelsFile(destination, { ...config, providers });
}

export function isCustomProviderId(providerId: string): boolean {
  return !BUILTIN_PROVIDER_IDS.has(providerId);
}
