import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import {
  DEFAULT_IMAGE_MODEL,
  getImageModelPresetSizes,
  validateEditImageOptions,
  validateGenerateImageOptions,
} from "@imagemon/core";
import OpenAI from "openai";
import {
  type EditImageOptions,
  type GenerateImageOptions,
  type ImageClientOptions,
  type ImageResult,
  type ImageStreamEvent,
  type ImageUsage,
} from "./image.types.js";

export * from "./image.types.js";
export { DEFAULT_IMAGE_MODEL, getImageModelPresetSizes } from "@imagemon/core";
const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_CONFIG_FILE_NAME = "imagemon.config.json";

interface ImageConfigFile {
  apiKey?: string;
  baseURL?: string;
  timeout?: number;
  maxRetries?: number;
}

type NonStreamingGenerateOptions = GenerateImageOptions & {
  stream?: false | null | undefined;
};
type StreamingGenerateOptions = GenerateImageOptions & { stream: true };
type NonStreamingEditOptions = EditImageOptions & {
  stream?: false | null | undefined;
};
type StreamingEditOptions = EditImageOptions & { stream: true };

export function createImageClient(options: ImageClientOptions = {}): OpenAI {
  const config = loadImageConfig(options.configPath);
  const apiKey = options.apiKey ?? config.apiKey ?? process.env.IMAGEMON_API_KEY;
  const baseURL = normalizeBaseURL(options.baseURL ?? config.baseURL ?? process.env.IMAGEMON_API_BASE_URL);
  const timeout = options.timeout ?? config.timeout ?? parseOptionalInteger(process.env.IMAGEMON_API_TIMEOUT_MS);
  const maxRetries =
    options.maxRetries ?? config.maxRetries ?? parseOptionalInteger(process.env.IMAGEMON_API_MAX_RETRIES);

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

  if (config.maxRetries !== undefined) {
    if (typeof config.maxRetries !== "number") {
      throw new Error(`Imagemon config file ${configPath} field maxRetries must be a number`);
    }

    if (!Number.isInteger(config.maxRetries) || config.maxRetries < 0) {
      throw new Error(`Imagemon config file ${configPath} field maxRetries must be a non-negative integer`);
    }
  }

  return {
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    timeout: config.timeout,
    maxRetries: config.maxRetries,
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
  validateGenerateImageOptions(options);

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
  validateEditImageOptions(options);

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
