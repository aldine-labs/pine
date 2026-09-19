import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  AssistantImages,
  ImagesApi,
  ImagesContext,
  ImagesModel,
} from "@earendil-works/pi-ai";
import {
  defineTool,
  withFileMutationQueue,
  type AgentToolResult,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import type { PineApprovalMode } from "../../shared/agent";
import type { ToolGate } from "../gate";
import {
  DEFAULT_IMAGE_MODEL_ID,
  imageModel,
  imageModelIds,
  pineImagesModels,
} from "./models";

export const ACTIVATE_MEDIA_GENERATION_TOOL_NAME =
  "activate_media_generation" as const;
export const GENERATE_IMAGE_TOOL_NAME = "generate_image" as const;

/**
 * Media tools hidden until `activate_media_generation` runs. Image generation
 * is the only entry today; further media tools join this list instead of
 * widening the always-visible tool set.
 */
export const MEDIA_GENERATION_DYNAMIC_TOOL_NAMES = [
  GENERATE_IMAGE_TOOL_NAME,
] as const;

const MAX_PROMPT_LENGTH = 8_000;
const MAX_PRESENTED_IMAGES = 4;
const MODEL_LIST_PREVIEW_LIMIT = 24;
const PROTECTED_PAYLOAD_FIELDS = new Set(["messages", "model", "stream"]);

const IMAGE_FILE_EXTENSIONS: Record<string, string> = {
  "image/avif": "avif",
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const ACTIVATION_GUIDANCE = `Image generation is active for this session.

Call ${GENERATE_IMAGE_TOOL_NAME} with a self-contained prompt: name the subject, its actions and setting, then the composition, medium or style, lighting, colour palette, and any text that must appear in the image. Write the prompt in the language the user is using unless the prompt itself benefits from another language. Prefer one clear image per call; ask for variants with separate calls instead of stacking contradictory instructions in one prompt.

Use model only when the result needs a specific model's strengths, and parameters only for model-specific options the user asked for (for example size, quality, aspect ratio, or style). Generated files are saved to disk and opened in a background tab for the user; mention what you generated and where it was saved.`;

function textResult(
  text: string,
  details: Record<string, unknown>,
): AgentToolResult<Record<string, unknown>> {
  return { content: [{ type: "text", text }], details };
}

function extensionFor(mimeType: string): string {
  return IMAGE_FILE_EXTENSIONS[mimeType.trim().toLowerCase()] ?? "png";
}

function parameterRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function imageFileName(sequence: number): string {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/gu, "")
    .replace(/\..+$/u, "");
  const suffix = randomUUID().slice(0, 8);
  return `image-${stamp}-${suffix}${sequence > 1 ? `-${sequence}` : ""}`;
}

function withExtension(filePath: string, extension: string): string {
  return path.extname(filePath) ? filePath : `${filePath}.${extension}`;
}

function withSequence(filePath: string, sequence: number): string {
  if (sequence <= 1) return filePath;
  const extension = path.extname(filePath);
  return `${filePath.slice(0, filePath.length - extension.length)}-${sequence}${extension}`;
}

function modelListMessage(): string {
  const ids = imageModelIds();
  const preview = ids.slice(0, MODEL_LIST_PREVIEW_LIMIT);
  const rest = ids.length - preview.length;
  return `${preview.join(", ")}${rest > 0 ? `, and ${rest} more` : ""}`;
}

export interface GenerateImageRequest {
  apiKey: string;
  model: ImagesModel<ImagesApi>;
  prompt: string;
  parameters?: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface MediaGenerationToolOptions {
  /** Records activation and exposes the hidden media tools for this session. */
  activateMediaGeneration?: () => void;
  /** Project root used to resolve relative output paths. */
  cwd: string;
  getApprovalMode(): PineApprovalMode;
  getGate(): ToolGate | null;
  /** Resolves the OpenRouter credential; undefined when it is not configured. */
  resolveApiKey(): Promise<string | undefined>;
  /** The image model chosen in the model picker, when the user picked one. */
  defaultImageModelId?: () => Promise<string | undefined> | string | undefined;
  /** Directory that receives generated files when output_path is omitted. */
  outputDirectory: string;
  /** Authorizes (and canonicalizes) a project write target. */
  authorizeWrite(targetPath: string): Promise<string>;
  /** Opens a generated file for the user without moving their focus. */
  presentFile?: (toolCallId: string, filePath: string) => void;
  /** Injectable image generation, used by tests. */
  generateImages?: (request: GenerateImageRequest) => Promise<AssistantImages>;
}

export async function generateImagesWithOpenRouter(
  request: GenerateImageRequest,
): Promise<AssistantImages> {
  const context: ImagesContext = {
    input: [{ type: "text", text: request.prompt }],
  };
  return pineImagesModels().generateImages(request.model, context, {
    apiKey: request.apiKey,
    onPayload: (payload: unknown) =>
      mergeImageParameters(payload, request.parameters),
    ...(request.signal ? { signal: request.signal } : {}),
  });
}

/**
 * Merges model-specific options into the OpenRouter request body. The prompt
 * frame itself (messages, model, stream) stays under Pine's control.
 */
export function mergeImageParameters(
  payload: unknown,
  parameters: Record<string, unknown> | undefined,
): unknown {
  if (!parameters) return payload;
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    return payload;
  }
  const body = { ...(payload as Record<string, unknown>) };
  for (const [key, value] of Object.entries(parameters)) {
    if (PROTECTED_PAYLOAD_FIELDS.has(key)) continue;
    body[key] = value;
  }
  return body;
}

const emptyParams = Type.Object({}, { additionalProperties: false });

const generateImageParams = Type.Object(
  {
    prompt: Type.String({
      description:
        "A complete, self-contained description of the image to create: subject, setting, composition, style or medium, lighting, palette, and any text that must appear.",
      minLength: 1,
      maxLength: MAX_PROMPT_LENGTH,
    }),
    model: Type.Optional(
      Type.String({
        description: `OpenRouter image model id, for example "google/gemini-3-pro-image" or "black-forest-labs/flux.2-pro". Omit to use the model chosen in Pine's image model picker.`,
        maxLength: 200,
      }),
    ),
    parameters: Type.Optional(
      Type.Record(Type.String(), Type.Unknown(), {
        description:
          "Extra OpenRouter request-body fields for model-specific options, such as size, quality, aspect_ratio, style, or image_config. Passed through unchanged; models that do not support a field may ignore or reject it. messages, model, and stream cannot be overridden here.",
      }),
    ),
    output_path: Type.Optional(
      Type.String({
        description:
          "File path for the generated image. A relative path resolves against the project root and must stay inside a folder shared with Pine. Omit to save into this project's Pine temporary directory. When several images are returned, later files get a numeric suffix.",
        maxLength: 4_096,
      }),
    ),
  },
  { additionalProperties: false },
);

function createActivateTool(options: MediaGenerationToolOptions) {
  return defineTool({
    name: ACTIVATE_MEDIA_GENERATION_TOOL_NAME,
    label: "Activate Media Generation",
    description:
      "Dynamically enable Pine's media generation tools for the current session. Call this before generating images; the tools stay out of context until activation. Ask for image generation directly when the user asks for a picture, illustration, logo, mockup, or diagram rendered as an image.",
    promptSnippet:
      "Activate image generation on demand before drawing or generating any picture",
    promptGuidelines: [
      `Call ${ACTIVATE_MEDIA_GENERATION_TOOL_NAME} once when the user asks for a picture, illustration, logo, mockup, or any other image, then call ${GENERATE_IMAGE_TOOL_NAME}.`,
      `Skip activation for text-only work such as diagrams, charts, or icons that should be expressed as code.`,
    ],
    parameters: emptyParams,
    prepareArguments: () => ({}),
    executionMode: "sequential",
    execute: () => {
      options.activateMediaGeneration?.();
      return Promise.resolve(
        textResult(ACTIVATION_GUIDANCE, {
          activatedToolNames: [...MEDIA_GENERATION_DYNAMIC_TOOL_NAMES],
        }),
      );
    },
  });
}

function createGenerateImageTool(options: MediaGenerationToolOptions) {
  return defineTool({
    name: GENERATE_IMAGE_TOOL_NAME,
    label: "Generate Image",
    description:
      "Generate an image from a text prompt with OpenRouter's aggregated image models, save the result as a file, and open it for the user in a background tab. Requires activate_media_generation first. This call reaches the network and may cost money, so it is reviewed like other privileged actions.",
    promptSnippet:
      "Generate images from a prompt with OpenRouter image models and save them as project files",
    promptGuidelines: [
      `Write ${GENERATE_IMAGE_TOOL_NAME} prompts that a reader could execute without seeing the conversation: describe the subject, setting, composition, style, lighting, and palette, and spell out text that must appear in the image.`,
      `Prefer one image per call and iterate on the prompt instead of asking for many unrelated images at once.`,
      `Pass output_path only when the user wants the file in a specific location; otherwise Pine saves into this project's temporary directory and reports the path.`,
      `The generated file is opened in a background tab: say what was created and where it was saved instead of assuming the user already looked at it.`,
    ],
    parameters: generateImageParams,
    prepareArguments: (args) => args as Static<typeof generateImageParams>,
    executionMode: "sequential",
    execute: async (toolCallId, params, signal) => {
      const apiKey = (await options.resolveApiKey())?.trim();
      if (!apiKey) {
        throw new Error(
          "Image generation is unavailable because OpenRouter is not configured. Ask the user to add an OpenRouter API key or sign in with OpenRouter in Pine's model settings, then try again.",
        );
      }

      const requestedModelId =
        params.model?.trim() ||
        (await options.defaultImageModelId?.())?.trim() ||
        DEFAULT_IMAGE_MODEL_ID;
      const model = imageModel(requestedModelId);
      if (!model) {
        throw new Error(
          `Unknown image model "${requestedModelId}". Available OpenRouter image models: ${modelListMessage()}.`,
        );
      }

      if (options.getApprovalMode() !== "YOLO") {
        const gate = options.getGate();
        if (!gate) {
          throw new Error(
            "Image generation requires an approval gate in this mode.",
          );
        }
        const decision = await gate.reviewPrivilegedCall({
          toolCallId,
          toolName: GENERATE_IMAGE_TOOL_NAME,
          subject: `${model.name}: ${params.prompt}`,
          description: `Generate an image with ${model.name}`,
          evidence:
            "This sends the prompt to OpenRouter's image API, outside Pine's project sandbox, and the request may cost money.",
          signal,
        });
        if (decision.kind === "deny") {
          throw new Error(decision.reason ?? "Image generation was denied.");
        }
      }
      if (signal?.aborted) throw new Error("aborted");

      const generate = options.generateImages ?? generateImagesWithOpenRouter;
      const result = await generate({
        apiKey,
        model,
        prompt: params.prompt,
        ...(params.parameters
          ? { parameters: parameterRecord(params.parameters) }
          : {}),
        ...(signal ? { signal } : {}),
      });
      if (result.stopReason === "aborted") throw new Error("aborted");
      if (result.stopReason === "error") {
        throw new Error(
          result.errorMessage ?? "Image generation failed without a message.",
        );
      }

      const images = result.output.filter(
        (part): part is { type: "image"; data: string; mimeType: string } =>
          part.type === "image",
      );
      const modelText = result.output
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n")
        .trim();
      if (images.length === 0) {
        throw new Error(
          `${model.name} returned no image${modelText ? `: ${modelText}` : "."}`,
        );
      }

      const baseDirectory = options.outputDirectory;
      const requestedOutput = params.output_path?.trim();
      const files: { path: string; mimeType: string; bytes: number }[] = [];
      for (const [index, image] of images.entries()) {
        const extension = extensionFor(image.mimeType);
        const requestedTarget = requestedOutput
          ? withSequence(
              withExtension(
                path.isAbsolute(requestedOutput)
                  ? requestedOutput
                  : path.resolve(options.cwd, requestedOutput),
                extension,
              ),
              index + 1,
            )
          : path.join(
              baseDirectory,
              `${imageFileName(index + 1)}.${extension}`,
            );
        const target = await options.authorizeWrite(requestedTarget);
        const bytes = Buffer.from(image.data, "base64");
        await mkdir(path.dirname(target), { recursive: true });
        await withFileMutationQueue(target, () =>
          writeFile(target, bytes, { mode: 0o600 }),
        );
        files.push({
          bytes: bytes.byteLength,
          mimeType: image.mimeType,
          path: target,
        });
      }

      for (const file of files.slice(0, MAX_PRESENTED_IMAGES)) {
        options.presentFile?.(toolCallId, file.path);
      }

      const list = files
        .map(
          (file) =>
            `- ${file.path} (${file.mimeType}, ${Math.round(file.bytes / 1024)} KB)`,
        )
        .join("\n");
      const summary = [
        `Generated ${files.length} image${files.length === 1 ? "" : "s"} with ${model.name}:`,
        list,
        ...(modelText ? [`\n${model.name} also returned:\n${modelText}`] : []),
        files.length > MAX_PRESENTED_IMAGES
          ? `\nOnly the first ${MAX_PRESENTED_IMAGES} images were opened in background tabs.`
          : "",
      ]
        .filter(Boolean)
        .join("\n");
      return textResult(summary, {
        files,
        model: model.id,
        ...(params.parameters ? { parameters: params.parameters } : {}),
        prompt: params.prompt,
        ...(result.responseId ? { responseId: result.responseId } : {}),
      });
    },
  });
}

/**
 * Builds the media generation tools. The activator is always visible; the
 * generation tools are registered up front and become active only after
 * activation, so their schemas and prompt guidance stay out of context until
 * the session actually needs them.
 */
export function createMediaGenerationToolDefinitions(
  options: MediaGenerationToolOptions,
): ToolDefinition[] {
  if (!options.activateMediaGeneration) return [];
  return [createActivateTool(options), createGenerateImageTool(options)];
}
