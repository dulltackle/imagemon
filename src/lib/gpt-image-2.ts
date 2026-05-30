import OpenAI from "openai";
import type {
  CommonGptImage2Options,
  EditGptImage2Options,
  GenerateGptImage2Options,
  GptImage2ClientOptions,
  GptImage2Result,
  GptImage2StreamEvent,
  GptImage2Size,
  GptImage2Usage,
} from "./gpt-image-2.types.js";

export * from "./gpt-image-2.types.js";

const GPT_IMAGE_2_MODEL = "gpt-image-2" as const;
const DEFAULT_BASE_URL = "https://api.openai.com/v1";

type NonStreamingGenerateOptions = GenerateGptImage2Options & {
  stream?: false | null | undefined;
};
type StreamingGenerateOptions = GenerateGptImage2Options & { stream: true };
type NonStreamingEditOptions = EditGptImage2Options & {
  stream?: false | null | undefined;
};
type StreamingEditOptions = EditGptImage2Options & { stream: true };

export function createGptImage2Client(options: GptImage2ClientOptions = {}): OpenAI {
  const apiKey = options.apiKey ?? process.env.IMAGE_API_KEY;
  const baseURL = normalizeBaseURL(options.baseURL ?? process.env.IMAGE_API_BASE_URL);
  const timeout = options.timeout ?? parseOptionalInteger(process.env.IMAGE_API_TIMEOUT_MS);
  const maxRetries = options.maxRetries ?? parseOptionalInteger(process.env.IMAGE_API_MAX_RETRIES);

  if (!apiKey) {
    throw new Error("IMAGE_API_KEY is required to call gpt-image-2");
  }

  return new OpenAI({
    apiKey,
    baseURL,
    timeout,
    maxRetries,
    fetch: wrapFetch(options.fetch),
  });
}

function wrapFetch(customFetch: typeof fetch | undefined): typeof fetch | undefined {
  if (!customFetch) {
    return undefined;
  }

  return async (input, init) => {
    if (String(input).startsWith("data:")) {
      return globalThis.fetch(input, init);
    }

    return customFetch(input, init);
  };
}

export async function generateGptImage2(
  options: StreamingGenerateOptions,
  clientOptions?: GptImage2ClientOptions,
): Promise<AsyncGenerator<GptImage2StreamEvent, void, unknown>>;
export async function generateGptImage2(
  options: NonStreamingGenerateOptions,
  clientOptions?: GptImage2ClientOptions,
): Promise<GptImage2Result>;
export async function generateGptImage2(
  options: GenerateGptImage2Options,
  clientOptions?: GptImage2ClientOptions,
): Promise<GptImage2Result | AsyncGenerator<GptImage2StreamEvent, void, unknown>>;
export async function generateGptImage2(
  options: GenerateGptImage2Options,
  clientOptions: GptImage2ClientOptions = {},
): Promise<GptImage2Result | AsyncGenerator<GptImage2StreamEvent, void, unknown>> {
  validateGenerateOptions(options);

  const client = createGptImage2Client(clientOptions);
  const body = {
    ...options,
    model: GPT_IMAGE_2_MODEL,
  };

  if (options.stream) {
    const stream = await client.images.generate(body as Parameters<typeof client.images.generate>[0]);
    return normalizeImageStream(stream as AsyncIterable<unknown>);
  }

  const response = await client.images.generate(body as Parameters<typeof client.images.generate>[0]);
  return normalizeImageResponse(response);
}

export async function editGptImage2(
  options: StreamingEditOptions,
  clientOptions?: GptImage2ClientOptions,
): Promise<AsyncGenerator<GptImage2StreamEvent, void, unknown>>;
export async function editGptImage2(
  options: NonStreamingEditOptions,
  clientOptions?: GptImage2ClientOptions,
): Promise<GptImage2Result>;
export async function editGptImage2(
  options: EditGptImage2Options,
  clientOptions?: GptImage2ClientOptions,
): Promise<GptImage2Result | AsyncGenerator<GptImage2StreamEvent, void, unknown>>;
export async function editGptImage2(
  options: EditGptImage2Options,
  clientOptions: GptImage2ClientOptions = {},
): Promise<GptImage2Result | AsyncGenerator<GptImage2StreamEvent, void, unknown>> {
  validateEditOptions(options);

  const client = createGptImage2Client(clientOptions);
  const body = {
    ...options,
    model: GPT_IMAGE_2_MODEL,
  };

  if (options.stream) {
    const stream = await client.images.edit(body as Parameters<typeof client.images.edit>[0]);
    return normalizeImageStream(stream as AsyncIterable<unknown>);
  }

  const response = await client.images.edit(body as Parameters<typeof client.images.edit>[0]);
  return normalizeImageResponse(response);
}

function normalizeBaseURL(baseURL: string | undefined): string {
  const normalized = (baseURL ?? DEFAULT_BASE_URL).trim().replace(/\/+$/, "");

  if (!normalized) {
    throw new Error("IMAGE_API_BASE_URL cannot be empty");
  }

  if (/\/images\/(?:generations|edits)$/.test(normalized)) {
    throw new Error("IMAGE_API_BASE_URL must end at the API version prefix, for example https://example.com/v1");
  }

  return normalized;
}

function parseOptionalInteger(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Expected a non-negative integer, got ${value}`);
  }

  return parsed;
}

function validateGenerateOptions(options: GenerateGptImage2Options): void {
  validateCommonOptions(options);
}

function validateEditOptions(options: EditGptImage2Options): void {
  validateCommonOptions(options);

  if (Array.isArray(options.image) && options.image.length === 0) {
    throw new Error("image must contain at least one input image");
  }

  if ("input_fidelity" in options) {
    throw new Error("gpt-image-2 handles input fidelity automatically; omit input_fidelity");
  }
}

function validateCommonOptions(options: CommonGptImage2Options): void {
  if (!options.prompt || options.prompt.trim().length === 0) {
    throw new Error("prompt is required");
  }

  if (options.n !== undefined && (!Number.isInteger(options.n) || options.n < 1 || options.n > 10)) {
    throw new Error("n must be an integer between 1 and 10");
  }

  if (
    options.partial_images !== undefined &&
    (!Number.isInteger(options.partial_images) || options.partial_images < 0 || options.partial_images > 3)
  ) {
    throw new Error("partial_images must be an integer between 0 and 3");
  }

  if (
    options.output_compression !== undefined &&
    (!Number.isInteger(options.output_compression) ||
      options.output_compression < 0 ||
      options.output_compression > 100)
  ) {
    throw new Error("output_compression must be an integer between 0 and 100");
  }

  if (options.background !== undefined && options.background !== "auto" && options.background !== "opaque") {
    throw new Error('gpt-image-2 only supports background values "auto" and "opaque"');
  }

  if (options.size !== undefined) {
    validateSize(options.size);
  }
}

function validateSize(size: GptImage2Size): void {
  const standardSizes = new Set([
    "auto",
    "1024x1024",
    "1536x1024",
    "1024x1536",
    "2048x2048",
    "2048x1152",
    "3840x2160",
    "2160x3840",
  ]);
  if (standardSizes.has(size)) {
    return;
  }

  const match = /^(\d+)x(\d+)$/.exec(size);
  if (!match) {
    throw new Error('size must be "auto", a standard size, or a WIDTHxHEIGHT string');
  }

  const width = Number(match[1]);
  const height = Number(match[2]);
  if (width % 16 !== 0 || height % 16 !== 0) {
    throw new Error("custom size width and height must both be divisible by 16");
  }

  if (width > 3840 || height > 3840) {
    throw new Error("custom size width and height must not exceed 3840px");
  }

  const ratio = width / height;
  if (ratio < 1 / 3 || ratio > 3) {
    throw new Error("custom size aspect ratio must be between 1:3 and 3:1");
  }

  const pixels = width * height;
  if (pixels < 655_360 || pixels > 8_294_400) {
    throw new Error("custom size total pixels must be between 655,360 and 8,294,400");
  }
}

function normalizeImageResponse(response: unknown): GptImage2Result {
  const typedResponse = response as {
    created?: number;
    data?: Array<{ b64_json?: string }>;
    usage?: GptImage2Usage;
    size?: string;
    quality?: string;
    output_format?: string;
    background?: string;
  };

  const images =
    typedResponse.data
      ?.map((image) => image.b64_json)
      .filter((b64Json): b64Json is string => typeof b64Json === "string" && b64Json.length > 0)
      .map((b64Json) => ({ b64_json: b64Json })) ?? [];

  if (images.length === 0) {
    throw new Error("gpt-image-2 response did not include base64 image data");
  }

  return {
    created: typedResponse.created ?? 0,
    images,
    usage: typedResponse.usage,
    size: typedResponse.size,
    quality: typedResponse.quality,
    output_format: typedResponse.output_format,
    background: typedResponse.background,
  };
}

async function* normalizeImageStream(stream: AsyncIterable<unknown>): AsyncGenerator<GptImage2StreamEvent, void, unknown> {
  for await (const event of stream) {
    const normalized = normalizeStreamEvent(event);
    if (normalized) {
      yield normalized;
    }
  }
}

function normalizeStreamEvent(event: unknown): GptImage2StreamEvent | null {
  const typedEvent = event as Partial<GptImage2StreamEvent> & { type?: string };
  if (
    typedEvent.type !== "image_generation.partial_image" &&
    typedEvent.type !== "image_generation.completed" &&
    typedEvent.type !== "image_edit.partial_image" &&
    typedEvent.type !== "image_edit.completed"
  ) {
    return null;
  }

  if (typeof typedEvent.b64_json !== "string" || typedEvent.b64_json.length === 0) {
    throw new Error(`Streaming event ${typedEvent.type} did not include base64 image data`);
  }

  return typedEvent as GptImage2StreamEvent;
}
