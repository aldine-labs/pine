import type {
  AssistantImages,
  ImagesApi,
  ImagesModel,
  Usage,
} from "@earendil-works/pi-ai";

/**
 * OpenRouter's dedicated image API: `POST <baseUrl>/images`.
 *
 * Pi 0.85.1 only implements the chat transport (`chat/completions` with the
 * `image` modality), which OpenRouter refuses for pure image models with
 * `... cannot be used with the chat/completions endpoint. Use the /api/v1/images
 * endpoint instead.` This client speaks the documented image API so every model
 * in Pi's catalog is reachable, and it returns Pi's `AssistantImages` shape so
 * callers do not care which transport ran.
 *
 * @see https://openrouter.ai/docs/guides/overview/multimodal/image-generation
 */

/** Body fields Pine owns; `parameters` may not override them on either transport. */
export const PROTECTED_BODY_FIELDS = new Set([
  "messages",
  "model",
  "prompt",
  "stream",
]);

export interface ImagesEndpointRequest {
  apiKey: string;
  /** Injectable for tests; defaults to the global fetch. */
  fetch?: typeof globalThis.fetch;
  model: ImagesModel<ImagesApi>;
  parameters?: Record<string, unknown>;
  prompt: string;
  signal?: AbortSignal;
}

interface ImagesEndpointImage {
  b64_json?: string;
  media_type?: string;
}

interface ImagesEndpointUsage {
  completion_tokens?: number;
  cost?: number;
  prompt_tokens?: number;
  total_tokens?: number;
}

interface ImagesEndpointResponse {
  data?: ImagesEndpointImage[];
  usage?: ImagesEndpointUsage;
}

interface ErrorBody {
  error?: { message?: string } | string;
  message?: string;
}

export function imagesEndpointUrl(model: ImagesModel<ImagesApi>): string {
  return `${model.baseUrl.replace(/\/+$/u, "")}/images`;
}

/**
 * Builds the request body. The prompt frame (`model`, `prompt`) stays under
 * Pine's control; everything else passes through so model-specific options such
 * as `size`, `quality`, `aspect_ratio`, or `n` reach OpenRouter unchanged.
 */
export function imagesEndpointBody(
  request: ImagesEndpointRequest,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: request.model.id,
    prompt: request.prompt,
  };
  for (const [key, value] of Object.entries(request.parameters ?? {})) {
    if (PROTECTED_BODY_FIELDS.has(key)) continue;
    body[key] = value;
  }
  return body;
}

export async function generateImagesViaEndpoint(
  request: ImagesEndpointRequest,
): Promise<AssistantImages> {
  const { model } = request;
  const output: AssistantImages = {
    api: model.api,
    provider: model.provider,
    model: model.id,
    output: [],
    stopReason: "stop",
    timestamp: Date.now(),
  };

  try {
    const headers: Record<string, string> = {
      authorization: `Bearer ${request.apiKey}`,
      "content-type": "application/json",
    };
    for (const [key, value] of Object.entries(model.headers ?? {})) {
      if (value !== null) headers[key] = value;
    }

    const response = await (request.fetch ?? globalThis.fetch)(
      imagesEndpointUrl(model),
      {
        body: JSON.stringify(imagesEndpointBody(request)),
        headers,
        method: "POST",
        ...(request.signal ? { signal: request.signal } : {}),
      },
    );
    const raw = await response.text();
    if (!response.ok) {
      throw new Error(
        providerErrorMessage(raw) ??
          `OpenRouter returned HTTP ${response.status}.`,
      );
    }

    const payload = parseJson(raw) as ImagesEndpointResponse | undefined;
    for (const image of payload?.data ?? []) {
      if (!image.b64_json) continue;
      output.output.push({
        type: "image",
        mimeType: image.media_type?.trim() || "image/png",
        data: image.b64_json,
      });
    }
    const usage = parseUsage(payload?.usage, model);
    if (usage) output.usage = usage;
    return output;
  } catch (error) {
    output.stopReason = request.signal?.aborted ? "aborted" : "error";
    output.errorMessage =
      error instanceof Error ? error.message : String(error);
    return output;
  }
}

/**
 * True when a chat-transport failure is OpenRouter telling us the model only
 * exists on the dedicated image API, which makes a retry there worthwhile
 * instead of surfacing an error the caller cannot act on.
 */
export function isImagesEndpointRedirect(message: string | undefined): boolean {
  return (
    typeof message === "string" &&
    message.includes("/api/v1/images") &&
    /chat\/completions/u.test(message)
  );
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

function providerErrorMessage(raw: string): string | undefined {
  const body = parseJson(raw);
  if (typeof body !== "object" || body === null) return undefined;
  const error = (body as ErrorBody).error;
  if (typeof error === "string") return error;
  return error?.message ?? (body as ErrorBody).message;
}

/**
 * Mirrors Pi's own usage mapping: per-token rates come from the model catalog,
 * while OpenRouter's reported total is authoritative when it is present.
 */
function parseUsage(
  raw: ImagesEndpointUsage | undefined,
  model: ImagesModel<ImagesApi>,
): Usage | undefined {
  if (!raw) return undefined;
  const input = raw.prompt_tokens ?? 0;
  const output = raw.completion_tokens ?? 0;
  const usage: Usage = {
    input,
    output,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: raw.total_tokens ?? input + output,
    cost: {
      input: (model.cost.input / 1_000_000) * input,
      output: (model.cost.output / 1_000_000) * output,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
  };
  usage.cost.total =
    typeof raw.cost === "number"
      ? raw.cost
      : usage.cost.input + usage.cost.output;
  return usage;
}
