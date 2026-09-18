import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AddCustomModelRequest } from "../../shared/models";
import {
  addCustomModel,
  deleteCustomModel,
  deleteCustomProvider,
  updateCustomModel,
  updateCustomProvider,
} from "../customModels";

const temporaryDirectories: string[] = [];

const model: AddCustomModelRequest = {
  api: "openai-completions",
  apiKey: "$LOCAL_MODEL_KEY",
  baseUrl: "http://localhost:11434/v1",
  contextWindow: 128_000,
  maxTokens: 16_384,
  modelId: "qwen2.5-coder:7b",
  modelName: "Qwen 2.5 Coder",
  providerId: "ollama",
  providerMode: "new",
  providerName: "Ollama",
  thinkingLevels: ["off"],
  vision: true,
};

async function createAgentDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pine-models-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("custom models configuration", () => {
  it("creates a Pi-compatible models.json entry", async () => {
    const agentDir = await createAgentDirectory();

    await addCustomModel(agentDir, model);

    const parsed = JSON.parse(
      await readFile(path.join(agentDir, "models.json"), "utf8"),
    );
    expect(parsed.providers.ollama).toEqual({
      api: "openai-completions",
      apiKey: "$LOCAL_MODEL_KEY",
      baseUrl: "http://localhost:11434/v1",
      models: [
        {
          contextWindow: 128_000,
          id: "qwen2.5-coder:7b",
          input: ["text", "image"],
          maxTokens: 16_384,
          name: "Qwen 2.5 Coder",
          reasoning: false,
        },
      ],
      name: "Ollama",
    });
  });

  it("appends to JSONC configuration and preserves unrelated providers", async () => {
    const agentDir = await createAgentDirectory();
    await writeFile(
      path.join(agentDir, "models.json"),
      `{
        // Existing provider
        "providers": {
          "existing": { "baseUrl": "https://example.com", },
        },
      }`,
      "utf8",
    );

    await addCustomModel(agentDir, model);

    const parsed = JSON.parse(
      await readFile(path.join(agentDir, "models.json"), "utf8"),
    );
    expect(parsed.providers.existing).toEqual({
      baseUrl: "https://example.com",
    });
    expect(parsed.providers.ollama.models).toHaveLength(1);
  });

  it("rejects duplicate provider/model pairs", async () => {
    const agentDir = await createAgentDirectory();
    await addCustomModel(agentDir, model);

    await expect(addCustomModel(agentDir, model)).rejects.toThrow(
      'Model "qwen2.5-coder:7b" already exists',
    );
  });

  it("adds a model to an existing provider without replacing its settings", async () => {
    const agentDir = await createAgentDirectory();
    await addCustomModel(agentDir, model);

    await addCustomModel(agentDir, {
      contextWindow: 32_768,
      maxTokens: 8_192,
      modelId: "reasoning-model",
      providerId: "ollama",
      providerMode: "existing",
      thinkingLevels: ["high", "max"],
      vision: false,
    });

    const parsed = JSON.parse(
      await readFile(path.join(agentDir, "models.json"), "utf8"),
    );
    expect(parsed.providers.ollama).toMatchObject({
      api: "openai-completions",
      apiKey: "$LOCAL_MODEL_KEY",
      baseUrl: "http://localhost:11434/v1",
    });
    expect(parsed.providers.ollama.models[1]).toMatchObject({
      id: "reasoning-model",
      reasoning: true,
      thinkingLevelMap: {
        max: "max",
        medium: null,
        minimal: null,
        low: null,
        off: null,
        xhigh: null,
      },
    });
  });

  it("updates a custom model and preserves provider settings", async () => {
    const agentDir = await createAgentDirectory();
    await addCustomModel(agentDir, model);

    await updateCustomModel(agentDir, {
      contextWindow: 256_000,
      maxTokens: 32_768,
      modelId: "qwen2.5-coder:14b",
      modelName: "Qwen 2.5 Coder 14B",
      originalModelId: model.modelId,
      providerId: model.providerId,
      thinkingLevels: ["medium", "high"],
      vision: false,
    });

    const parsed = JSON.parse(
      await readFile(path.join(agentDir, "models.json"), "utf8"),
    );
    expect(parsed.providers.ollama).toMatchObject({
      api: "openai-completions",
      apiKey: "$LOCAL_MODEL_KEY",
      baseUrl: "http://localhost:11434/v1",
    });
    expect(parsed.providers.ollama.models).toEqual([
      expect.objectContaining({
        contextWindow: 256_000,
        id: "qwen2.5-coder:14b",
        input: ["text"],
        maxTokens: 32_768,
        name: "Qwen 2.5 Coder 14B",
        reasoning: true,
      }),
    ]);
  });

  it("updates a custom provider without replacing its models", async () => {
    const agentDir = await createAgentDirectory();
    await addCustomModel(agentDir, model);

    await updateCustomProvider(agentDir, {
      api: "openai-responses",
      baseUrl: "https://localhost:11434/v1",
      providerId: model.providerId,
      providerName: "Updated Ollama",
    });

    const parsed = JSON.parse(
      await readFile(path.join(agentDir, "models.json"), "utf8"),
    );
    expect(parsed.providers.ollama).toMatchObject({
      api: "openai-responses",
      apiKey: "$LOCAL_MODEL_KEY",
      baseUrl: "https://localhost:11434/v1",
      name: "Updated Ollama",
    });
    expect(parsed.providers.ollama.models).toHaveLength(1);
  });

  it("deletes a custom model and provider", async () => {
    const agentDir = await createAgentDirectory();
    await addCustomModel(agentDir, model);
    await addCustomModel(agentDir, {
      ...model,
      modelId: "second-model",
      providerMode: "existing",
    });

    await deleteCustomModel(agentDir, {
      modelId: model.modelId,
      providerId: model.providerId,
    });
    let parsed = JSON.parse(
      await readFile(path.join(agentDir, "models.json"), "utf8"),
    );
    expect(parsed.providers.ollama.models).toEqual([
      expect.objectContaining({ id: "second-model" }),
    ]);

    await deleteCustomProvider(agentDir, { providerId: model.providerId });
    parsed = JSON.parse(
      await readFile(path.join(agentDir, "models.json"), "utf8"),
    );
    expect(parsed.providers.ollama).toBeUndefined();
  });
});
