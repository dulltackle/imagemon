import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import OpenAI from "openai";
import {
  GPT_IMAGE_2_UNIQUE_SIZES,
  type CommonImageOptions,
  type EditImageOptions,
  type GenerateImageOptions,
  type ImageClientOptions,
  type ImageModel,
  type ImageResult,
  type ImageStreamEvent,
  type ImageSize,
  type ImageUsage,
} from "./image.types.js";

export * from "./image.types.js";

export const DEFAULT_IMAGE_MODEL = "gpt-image-2" as const;
const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_CONFIG_FILE_NAME = "imagemon.config.json";

interface ImageModelCapabilities {
  transparentBackground: boolean;
  inputFidelity: boolean;
  customSize: boolean;
}

const IMAGE_MODEL_CAPABILITIES: Readonly<Record<string, ImageModelCapabilities>> = {
  "gpt-image-1": {
    transparentBackground: true,
    inputFidelity: true,
    customSize: false,
  },
  "gpt-image-1-mini": {
    transparentBackground: true,
    inputFidelity: false,
    customSize: false,
  },
  "gpt-image-1.5": {
    transparentBackground: true,
    inputFidelity: true,
    customSize: false,
  },
  [DEFAULT_IMAGE_MODEL]: {
    transparentBackground: false,
    inputFidelity: true,
    customSize: true,
  },
  "gpt-image-2-2026-04-21": {
    transparentBackground: false,
    inputFidelity: true,
    customSize: true,
  },
  "gpt-image-3": {
    transparentBackground: true,
    inputFidelity: true,
    customSize: true,
  },
};

const COMMON_IMAGE_PRESET_SIZES = Object.freeze(["auto", "1024x1024", "1536x1024", "1024x1536"] as const);
const GPT_IMAGE_2_MODELS = new Set<string>([DEFAULT_IMAGE_MODEL, "gpt-image-2-2026-04-21"]);
const GPT_IMAGE_2_PRESET_SIZES: readonly ImageSize[] = Object.freeze([
  ...COMMON_IMAGE_PRESET_SIZES,
  ...GPT_IMAGE_2_UNIQUE_SIZES,
]);

interface ImageConfigFile {
  apiKey?: string;
  baseURL?: string;
  timeout?: number;
}

type NonStreamingGenerateOptions = GenerateImageOptions & {
  stream?: false | null | undefined;
};
type StreamingGenerateOptions = GenerateImageOptions & { stream: true };
type NonStreamingEditOptions = EditImageOptions & {
  stream?: false | null | undefined;
};
type StreamingEditOptions = EditImageOptions & { stream: true };

export function getImageModelPresetSizes(model?: ImageModel): readonly ImageSize[] | undefined {
  const resolvedModel = getModel(model);
  if (!IMAGE_MODEL_CAPABILITIES[resolvedModel]) {
    return undefined;
  }

  return GPT_IMAGE_2_MODELS.has(resolvedModel) ? GPT_IMAGE_2_PRESET_SIZES : COMMON_IMAGE_PRESET_SIZES;
}

export function createImageClient(options: ImageClientOptions = {}): OpenAI {
  const config = loadImageConfig(options.configPath);
  const apiKey = options.apiKey ?? config.apiKey ?? process.env.IMAGEMON_API_KEY;
  const baseURL = normalizeBaseURL(options.baseURL ?? config.baseURL ?? process.env.IMAGEMON_API_BASE_URL);
  const timeout = options.timeout ?? config.timeout ?? parseOptionalInteger(process.env.IMAGEMON_API_TIMEOUT_MS);
  const maxRetries = options.maxRetries ?? parseOptionalInteger(process.env.IMAGEMON_API_MAX_RETRIES);

  if (!apiKey) {
    throw new Error("IMAGEMON_API_KEY or imagemon.config.json apiKey is required to call GPT Image models");
  }

  return new OpenAI({
    apiKey,
    baseURL,
    timeout,
    maxRetries,
    fetch: wrapFetch(options.fetch),
  });
}

function loadImageConfig(configPathOption: string | undefined): ImageConfigFile {
  const { configPath, isDefaultPath } = resolveConfigPath(configPathOption);

  if (!existsSync(configPath)) {
    if (isDefaultPath) {
      return {};
    }

    throw new Error(`Imagemon config file was not found at ${configPath}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Imagemon config file ${configPath} must contain valid JSON`);
    }

    throw error;
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Imagemon config file ${configPath} must be a JSON object`);
  }

  const config = parsed as Record<string, unknown>;
  if (config.apiKey !== undefined && typeof config.apiKey !== "string") {
    throw new Error(`Imagemon config file ${configPath} field apiKey must be a string`);
  }

  if (config.baseURL !== undefined && typeof config.baseURL !== "string") {
    throw new Error(`Imagemon config file ${configPath} field baseURL must be a string`);
  }

  if (config.timeout !== undefined) {
    if (typeof config.timeout !== "number") {
      throw new Error(`Imagemon config file ${configPath} field timeout must be a number`);
    }

    if (!Number.isInteger(config.timeout) || config.timeout < 0) {
      throw new Error(`Imagemon config file ${configPath} field timeout must be a non-negative integer`);
    }
  }

  return {
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    timeout: config.timeout,
  };
}

function resolveConfigPath(configPathOption: string | undefined): { configPath: string; isDefaultPath: boolean } {
  const configuredPath = configPathOption ?? process.env.IMAGEMON_API_CONFIG_FILE;

  if (configuredPath !== undefined) {
    const trimmedPath = configuredPath.trim();
    if (!trimmedPath) {
      throw new Error("Imagemon config path cannot be empty");
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

export async function generateImage(
  options: StreamingGenerateOptions,
  clientOptions?: ImageClientOptions,
): Promise<AsyncGenerator<ImageStreamEvent, void, unknown>>;
export async function generateImage(
  options: NonStreamingGenerateOptions,
  clientOptions?: ImageClientOptions,
): Promise<ImageResult>;
export async function generateImage(
  options: GenerateImageOptions,
  clientOptions?: ImageClientOptions,
): Promise<ImageResult | AsyncGenerator<ImageStreamEvent, void, unknown>>;
export async function generateImage(
  options: GenerateImageOptions,
  clientOptions: ImageClientOptions = {},
): Promise<ImageResult | AsyncGenerator<ImageStreamEvent, void, unknown>> {
  validateGenerateOptions(options);

  const client = createImageClient(clientOptions);
  const body = {
    ...options,
    model: options.model ?? DEFAULT_IMAGE_MODEL,
  };

  if (options.stream) {
    const stream = await client.images.generate(body as Parameters<typeof client.images.generate>[0]);
    return normalizeImageStream(stream as AsyncIterable<unknown>);
  }

  const response = await client.images.generate(body as Parameters<typeof client.images.generate>[0]);
  return normalizeImageResponse(response);
}

export async function editImage(
  options: StreamingEditOptions,
  clientOptions?: ImageClientOptions,
): Promise<AsyncGenerator<ImageStreamEvent, void, unknown>>;
export async function editImage(
  options: NonStreamingEditOptions,
  clientOptions?: ImageClientOptions,
): Promise<ImageResult>;
export async function editImage(
  options: EditImageOptions,
  clientOptions?: ImageClientOptions,
): Promise<ImageResult | AsyncGenerator<ImageStreamEvent, void, unknown>>;
export async function editImage(
  options: EditImageOptions,
  clientOptions: ImageClientOptions = {},
): Promise<ImageResult | AsyncGenerator<ImageStreamEvent, void, unknown>> {
  validateEditOptions(options);

  const client = createImageClient(clientOptions);
  const body = {
    ...options,
    model: options.model ?? DEFAULT_IMAGE_MODEL,
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
    throw new Error("IMAGEMON_API_BASE_URL cannot be empty");
  }

  if (/\/images\/(?:generations|edits)$/.test(normalized)) {
    throw new Error("IMAGEMON_API_BASE_URL must end at the API version prefix, for example https://example.com/v1");
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

function validateGenerateOptions(options: GenerateImageOptions): void {
  validateCommonOptions(options);
  validateModelCapabilities(options);
}

function validateEditOptions(options: EditImageOptions): void {
  validateCommonOptions(options);
  validateModelCapabilities(options);

  if (Array.isArray(options.image) && options.image.length === 0) {
    throw new Error("image must contain at least one input image");
  }

  const capabilities = getModelCapabilities(options.model);
  if (options.input_fidelity !== undefined && capabilities && !capabilities.inputFidelity) {
    throw new Error(`model ${getModel(options.model)} does not support input_fidelity`);
  }
}

function validateCommonOptions(options: CommonImageOptions): void {
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

  if (options.background === "transparent" && options.output_format === "jpeg") {
    throw new Error('transparent background requires output_format "png" or "webp"');
  }
}

function validateModelCapabilities(options: CommonImageOptions): void {
  const capabilities = getModelCapabilities(options.model);
  if (!capabilities) {
    return;
  }

  if (options.background === "transparent" && !capabilities.transparentBackground) {
    throw new Error(`model ${getModel(options.model)} does not support transparent background`);
  }

  if (options.size !== undefined && isCustomSize(options.size)) {
    if (!capabilities.customSize) {
      throw new Error(`model ${getModel(options.model)} does not support custom size`);
    }
    validateSize(options.size);
  }
}

function getModelCapabilities(model: ImageModel | undefined): ImageModelCapabilities | undefined {
  return IMAGE_MODEL_CAPABILITIES[getModel(model)];
}

function getModel(model: ImageModel | undefined): string {
  return model ?? DEFAULT_IMAGE_MODEL;
}

function isCustomSize(size: ImageSize): boolean {
  return !STANDARD_IMAGE_SIZES.has(size);
}

const STANDARD_IMAGE_SIZES = new Set<ImageSize>(COMMON_IMAGE_PRESET_SIZES);

function validateSize(size: ImageSize): void {
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

function normalizeImageResponse(response: unknown): ImageResult {
  const typedResponse = response as {
    created?: number;
    data?: Array<{ b64_json?: string; url?: string }>;
    usage?: ImageUsage;
    size?: string;
    quality?: string;
    output_format?: string;
    background?: string;
  };

  const images =
    typedResponse.data
      ?.map((image) => {
        if (typeof image.b64_json === "string" && image.b64_json.length > 0) {
          return { b64_json: image.b64_json };
        }
        if (typeof image.url === "string" && image.url.length > 0) {
          return { url: image.url };
        }
        return null;
      })
      .filter((item): item is NonNullable<typeof item> => item !== null) ?? [];

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

async function* normalizeImageStream(stream: AsyncIterable<unknown>): AsyncGenerator<ImageStreamEvent, void, unknown> {
  for await (const event of stream) {
    const normalized = normalizeStreamEvent(event);
    if (normalized) {
      yield normalized;
    }
  }
}

function normalizeStreamEvent(event: unknown): ImageStreamEvent | null {
  const typedEvent = event as Partial<ImageStreamEvent> & { type?: string };
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

  return typedEvent as ImageStreamEvent;
}
