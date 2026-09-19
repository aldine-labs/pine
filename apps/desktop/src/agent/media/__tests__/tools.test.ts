import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ToolGate } from "../../gate";
import {
  ACTIVATE_MEDIA_GENERATION_TOOL_NAME,
  GENERATE_IMAGE_TOOL_NAME,
  MEDIA_GENERATION_DYNAMIC_TOOL_NAMES,
  createMediaGenerationToolDefinitions,
  mergeImageParameters,
  type MediaGenerationToolOptions,
} from "../tools";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function createOutputDirectory(): Promise<string> {
  const root = await mkdtemp(
    path.join(
      process.platform === "darwin" ? "/private/tmp" : os.tmpdir(),
      "pine-media-",
    ),
  );
  temporaryDirectories.push(root);
  return root;
}

function fakeGate(
  review: ToolGate["reviewPrivilegedCall"] = vi.fn(() =>
    Promise.resolve({ kind: "allow" as const }),
  ),
) {
  return {
    isApprovedCommand: vi.fn(() => false),
    resetTurn: vi.fn(),
    reviewBashCommand: vi.fn(),
    reviewDenial: vi.fn(),
    reviewFileCall: vi.fn(),
    reviewPrivilegedCall: review,
  } satisfies ToolGate;
}

function pngOutput(data = Buffer.from("image-bytes").toString("base64")) {
  return {
    api: "openrouter-images" as const,
    model: "google/gemini-3-pro-image",
    output: [
      { type: "image" as const, data, mimeType: "image/png" },
      { type: "text" as const, text: "A red circle on white." },
    ],
    provider: "openrouter",
    stopReason: "stop" as const,
    timestamp: Date.now(),
  };
}

function createOptions(
  overrides: Partial<MediaGenerationToolOptions> = {},
): MediaGenerationToolOptions {
  return {
    activateMediaGeneration: vi.fn(),
    authorizeWrite: (targetPath) => Promise.resolve(targetPath),
    cwd: "/tmp/pine-project",
    getApprovalMode: () => "auto-approve",
    getGate: () => fakeGate(),
    outputDirectory: "/tmp/pine-project-tmp/media",
    presentFile: vi.fn(),
    resolveApiKey: () => Promise.resolve("sk-or-test"),
    ...overrides,
  };
}

function toolNamed(
  options: MediaGenerationToolOptions,
  name: string,
): ToolDefinition {
  const tool = createMediaGenerationToolDefinitions(options).find(
    (candidate) => candidate.name === name,
  );
  if (!tool) throw new Error(`Missing tool: ${name}`);
  return tool;
}

async function execute(
  options: MediaGenerationToolOptions,
  name: string,
  params: unknown = {},
) {
  return toolNamed(options, name).execute(
    "call-1",
    params,
    undefined,
    undefined,
    {} as never,
  );
}

describe("createMediaGenerationToolDefinitions", () => {
  it("registers nothing until the runtime can activate media generation", () => {
    expect(
      createMediaGenerationToolDefinitions(
        createOptions({ activateMediaGeneration: undefined }),
      ),
    ).toEqual([]);
  });

  it("registers the activator before the hidden image tool", () => {
    const names = createMediaGenerationToolDefinitions(createOptions()).map(
      (tool) => tool.name,
    );

    expect(names).toEqual([
      ACTIVATE_MEDIA_GENERATION_TOOL_NAME,
      ...MEDIA_GENERATION_DYNAMIC_TOOL_NAMES,
    ]);
  });

  it("activates image generation and returns prompt guidance", async () => {
    const activateMediaGeneration = vi.fn();
    const options = createOptions({ activateMediaGeneration });

    const result = await execute(options, ACTIVATE_MEDIA_GENERATION_TOOL_NAME);

    expect(activateMediaGeneration).toHaveBeenCalledOnce();
    expect(result.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("Image generation is active"),
    });
    expect(result.details).toMatchObject({
      activatedToolNames: [GENERATE_IMAGE_TOOL_NAME],
    });
  });
});

describe("generate_image", () => {
  it("asks for configuration when OpenRouter has no credential", async () => {
    const options = createOptions({
      resolveApiKey: () => Promise.resolve(undefined),
    });

    await expect(
      execute(options, GENERATE_IMAGE_TOOL_NAME, { prompt: "A red circle" }),
    ).rejects.toThrow(/OpenRouter is not configured/u);
  });

  it("rejects unknown image models and lists the catalog", async () => {
    const options = createOptions();

    await expect(
      execute(options, GENERATE_IMAGE_TOOL_NAME, {
        model: "acme/not-an-image-model",
        prompt: "A red circle",
      }),
    ).rejects.toThrow(/Unknown image model "acme\/not-an-image-model"/u);
  });

  it("uses the image model picked in the model selector", async () => {
    const generateImages = vi.fn(() => Promise.resolve(pngOutput()));
    const options = createOptions({
      defaultImageModelId: () => "google/gemini-2.5-flash-image",
      generateImages,
    });

    await execute(options, GENERATE_IMAGE_TOOL_NAME, {
      prompt: "A red circle",
    });

    expect(generateImages).toHaveBeenCalledWith(
      expect.objectContaining({
        model: expect.objectContaining({
          id: "google/gemini-2.5-flash-image",
        }),
      }),
    );
  });

  it("requires approval before reaching the provider", async () => {
    const review = vi.fn(() =>
      Promise.resolve({ kind: "deny" as const, reason: "no images today" }),
    );
    const generateImages = vi.fn(() => Promise.resolve(pngOutput()));
    const options = createOptions({
      generateImages,
      getGate: () => fakeGate(review),
    });

    await expect(
      execute(options, GENERATE_IMAGE_TOOL_NAME, { prompt: "A red circle" }),
    ).rejects.toThrow("no images today");
    expect(review).toHaveBeenCalledWith(
      expect.objectContaining({
        description: expect.stringContaining("Google: Nano Banana Pro"),
        toolName: GENERATE_IMAGE_TOOL_NAME,
      }),
    );
    expect(generateImages).not.toHaveBeenCalled();
  });

  it("skips review in YOLO mode", async () => {
    const review = vi.fn(() => Promise.resolve({ kind: "deny" as const }));
    const outputDirectory = await createOutputDirectory();
    const options = createOptions({
      generateImages: () => Promise.resolve(pngOutput()),
      getApprovalMode: () => "YOLO",
      getGate: () => fakeGate(review),
      outputDirectory,
    });

    await execute(options, GENERATE_IMAGE_TOOL_NAME, {
      prompt: "A red circle",
    });

    expect(review).not.toHaveBeenCalled();
  });

  it("saves generated images, presents them, and reports the paths", async () => {
    const outputDirectory = await createOutputDirectory();
    const presentFile = vi.fn();
    const options = createOptions({
      generateImages: () => Promise.resolve(pngOutput()),
      outputDirectory,
      presentFile,
    });

    const result = await execute(options, GENERATE_IMAGE_TOOL_NAME, {
      prompt: "A red circle on a plain white background",
    });

    const files = (
      result.details as { files: { mimeType: string; path: string }[] }
    ).files;
    expect(files).toHaveLength(1);
    expect(files[0]?.mimeType).toBe("image/png");
    expect(files[0]?.path.startsWith(outputDirectory)).toBe(true);
    const file = files[0];
    if (!file) throw new Error("expected one generated image file");
    expect(await readFile(file.path, "utf8")).toBe("image-bytes");
    expect(presentFile).toHaveBeenCalledWith("call-1", file.path);
    expect(result.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("A red circle on white."),
    });
  });

  it("writes to a requested project path and numbers extra images", async () => {
    const authorizeWrite = vi.fn((targetPath: string) =>
      Promise.resolve(targetPath),
    );
    const output = pngOutput();
    output.output.push({
      type: "image",
      data: Buffer.from("second-image").toString("base64"),
      mimeType: "image/webp",
    });
    const options = createOptions({
      authorizeWrite,
      cwd: "/tmp/pine-project",
      generateImages: () => Promise.resolve(output),
    });

    const result = await execute(options, GENERATE_IMAGE_TOOL_NAME, {
      output_path: "assets/hero",
      prompt: "A red circle",
    });

    expect(authorizeWrite.mock.calls.map(([target]) => target)).toEqual([
      path.join("/tmp/pine-project", "assets/hero.png"),
      path.join("/tmp/pine-project", "assets/hero-2.webp"),
    ]);
    expect(
      (result.details as { files: { path: string }[] }).files.map(
        (file) => file.path,
      ),
    ).toEqual([
      path.join("/tmp/pine-project", "assets/hero.png"),
      path.join("/tmp/pine-project", "assets/hero-2.webp"),
    ]);
  });

  it("surfaces provider failures", async () => {
    const options = createOptions({
      generateImages: () =>
        Promise.resolve({
          ...pngOutput(),
          errorMessage: "Upstream model is unavailable",
          output: [],
          stopReason: "error" as const,
        }),
    });

    await expect(
      execute(options, GENERATE_IMAGE_TOOL_NAME, { prompt: "A red circle" }),
    ).rejects.toThrow("Upstream model is unavailable");
  });
});

describe("mergeImageParameters", () => {
  const payload = {
    messages: [{ role: "user" }],
    modalities: ["image"],
    model: "google/gemini-3-pro-image",
    stream: false,
  };

  it("adds model-specific options to the request body", () => {
    expect(
      mergeImageParameters(payload, {
        aspect_ratio: "16:9",
        image_config: { aspect_ratio: "16:9" },
      }),
    ).toEqual({
      ...payload,
      aspect_ratio: "16:9",
      image_config: { aspect_ratio: "16:9" },
    });
  });

  it("keeps the prompt frame under Pine's control", () => {
    expect(
      mergeImageParameters(payload, {
        messages: [],
        model: "acme/other",
        stream: true,
      }),
    ).toEqual(payload);
  });

  it("leaves the payload untouched without parameters", () => {
    expect(mergeImageParameters(payload, undefined)).toBe(payload);
  });
});
