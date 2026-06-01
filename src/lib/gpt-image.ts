import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import OpenAI from "openai";
import type {
  CommonGptImageOptions,
  EditGptImageOptions,
  GenerateGptImageOptions,
  GptImageClientOptions,
  GptImageResult,
  GptImageStreamEvent,
  GptImageSize,
  GptImageUsage,
} from "./gpt-image.types.js";

export * from "./gpt-image.types.js";

const DEFAULT_GPT_IMAGE_MODEL = "gpt-image-2" as const;
const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_CONFIG_FILE_NAME = "gpt-image.config.json";

interface GptImageConfigFile {
  apiKey?: string;
  baseURL?: string;
}

type NonStreamingGenerateOptions = GenerateGptImageOptions & {
  stream?: false | null | undefined;
};
type StreamingGenerateOptions = GenerateGptImageOptions & { stream: true };
type NonStreamingEditOptions = EditGptImageOptions & {
  stream?: false | null | undefined;
};
type StreamingEditOptions = EditGptImageOptions & { stream: true };

export function createGptImageClient(options: GptImageClientOptions = {}): OpenAI {
  const config = loadGptImageConfig(options.configPath);
  const apiKey = options.apiKey ?? config.apiKey ?? process.env.IMAGE_API_KEY;
  const baseURL = normalizeBaseURL(options.baseURL ?? config.baseURL ?? process.env.IMAGE_API_BASE_URL);
  const timeout = options.timeout ?? parseOptionalInteger(process.env.IMAGE_API_TIMEOUT_MS);
  const maxRetries = options.maxRetries ?? parseOptionalInteger(process.env.IMAGE_API_MAX_RETRIES);

  if (!apiKey) {
    throw new Error("IMAGE_API_KEY or gpt-image.config.json apiKey is required to call GPT Image models");
  }

  return new OpenAI({
    apiKey,
    baseURL,
    timeout,
    maxRetries,
    fetch: wrapFetch(options.fetch),
  });
}

function loadGptImageConfig(configPathOption: string | undefined): GptImageConfigFile {
  const { configPath, isDefaultPath } = resolveConfigPath(configPathOption);

  if (!existsSync(configPath)) {
    if (isDefaultPath) {
      return {};
    }

    throw new Error(`GPT Image config file was not found at ${configPath}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`GPT Image config file ${configPath} must contain valid JSON`);
    }

    throw error;
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`GPT Image config file ${configPath} must be a JSON object`);
  }

  const config = parsed as Record<string, unknown>;
  if (config.apiKey !== undefined && typeof config.apiKey !== "string") {
    throw new Error(`GPT Image config file ${configPath} field apiKey must be a string`);
  }

  if (config.baseURL !== undefined && typeof config.baseURL !== "string") {
    throw new Error(`GPT Image config file ${configPath} field baseURL must be a string`);
  }

  return {
    apiKey: config.apiKey,
    baseURL: config.baseURL,
  };
}

function resolveConfigPath(configPathOption: string | undefined): { configPath: string; isDefaultPath: boolean } {
  const configuredPath = configPathOption ?? process.env.IMAGE_API_CONFIG_FILE;

  if (configuredPath !== undefined) {
    const trimmedPath = configuredPath.trim();
    if (!trimmedPath) {
      throw new Error("GPT Image config path cannot be empty");
    }

    return {
      configPath: isAbsolute(trimmedPath) ? trimmedPath : resolve(trimmedPath),
      isDefaultPath: false,
    };
  }

  return {
    configPath: join(process.cwd(), DEFAULT_CONFIG_FILE_NAME),
    isDefaultPath: true,
  };
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

export async function generateGptImage(
  options: StreamingGenerateOptions,
  clientOptions?: GptImageClientOptions,
): Promise<AsyncGenerator<GptImageStreamEvent, void, unknown>>;
export async function generateGptImage(
  options: NonStreamingGenerateOptions,
  clientOptions?: GptImageClientOptions,
): Promise<GptImageResult>;
export async function generateGptImage(
  options: GenerateGptImageOptions,
  clientOptions?: GptImageClientOptions,
): Promise<GptImageResult | AsyncGenerator<GptImageStreamEvent, void, unknown>>;
export async function generateGptImage(
  options: GenerateGptImageOptions,
  clientOptions: GptImageClientOptions = {},
): Promise<GptImageResult | AsyncGenerator<GptImageStreamEvent, void, unknown>> {
  validateGenerateOptions(options);

  const client = createGptImageClient(clientOptions);
  const body = {
    ...options,
    model: options.model ?? DEFAULT_GPT_IMAGE_MODEL,
  };

  if (options.stream) {
    const stream = await client.images.generate(body as Parameters<typeof client.images.generate>[0]);
    return normalizeImageStream(stream as AsyncIterable<unknown>);
  }

  const response = await client.images.generate(body as Parameters<typeof client.images.generate>[0]);
  return normalizeImageResponse(response);
}

export async function editGptImage(
  options: StreamingEditOptions,
  clientOptions?: GptImageClientOptions,
): Promise<AsyncGenerator<GptImageStreamEvent, void, unknown>>;
export async function editGptImage(
  options: NonStreamingEditOptions,
  clientOptions?: GptImageClientOptions,
): Promise<GptImageResult>;
export async function editGptImage(
  options: EditGptImageOptions,
  clientOptions?: GptImageClientOptions,
): Promise<GptImageResult | AsyncGenerator<GptImageStreamEvent, void, unknown>>;
export async function editGptImage(
  options: EditGptImageOptions,
  clientOptions: GptImageClientOptions = {},
): Promise<GptImageResult | AsyncGenerator<GptImageStreamEvent, void, unknown>> {
  validateEditOptions(options);

  const client = createGptImageClient(clientOptions);
  const body = {
    ...options,
    model: options.model ?? DEFAULT_GPT_IMAGE_MODEL,
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

function validateGenerateOptions(options: GenerateGptImageOptions): void {
  validateCommonOptions(options);
}

function validateEditOptions(options: EditGptImageOptions): void {
  validateCommonOptions(options);

  if (Array.isArray(options.image) && options.image.length === 0) {
    throw new Error("image must contain at least one input image");
  }

  if ("input_fidelity" in options) {
    throw new Error("GPT Image models handle input fidelity automatically; omit input_fidelity");
  }
}

function validateCommonOptions(options: CommonGptImageOptions): void {
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
    throw new Error('GPT Image models only support background values "auto" and "opaque"');
  }

  if (options.size !== undefined) {
    validateSize(options.size);
  }
}

function validateSize(size: GptImageSize): void {
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

function normalizeImageResponse(response: unknown): GptImageResult {
  const typedResponse = response as {
    created?: number;
    data?: Array<{ b64_json?: string }>;
    usage?: GptImageUsage;
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
    throw new Error("GPT Image response did not include base64 image data");
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

async function* normalizeImageStream(stream: AsyncIterable<unknown>): AsyncGenerator<GptImageStreamEvent, void, unknown> {
  for await (const event of stream) {
    const normalized = normalizeStreamEvent(event);
    if (normalized) {
      yield normalized;
    }
  }
}

function normalizeStreamEvent(event: unknown): GptImageStreamEvent | null {
  const typedEvent = event as Partial<GptImageStreamEvent> & { type?: string };
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

  return typedEvent as GptImageStreamEvent;
}
