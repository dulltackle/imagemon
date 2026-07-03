import { validateGenerateImageOptions } from "@imagemon/core";

import { normalizeBaseUrl } from "../model-configurations";
import { ImageTaskExecutionError, failureMessage } from "./errors";
import {
  parseImageTaskSize,
  type ImageResultFormat,
  type ImageTaskFailureReason,
  type ImageTaskSize,
} from "./types";

export interface ImageModelClient {
  generate(input: GenerateImageModelInput): Promise<GeneratedImageModelResult>;
}

export interface GenerateImageModelInput {
  baseUrl: string;
  apiKey: string;
  modelName: string;
  prompt: string;
  size: ImageTaskSize;
  quality: "auto";
  format: ImageResultFormat;
  n: 1;
}

export interface GeneratedImageModelResult {
  base64: string;
  width: number;
  height: number;
}

export interface ImageGenerationFetchResponseLike {
  status: number;
  json(): Promise<unknown>;
}

export interface ImageGenerationFetchInitLike {
  method: "POST";
  headers: Record<string, string>;
  body: string;
  signal?: AbortSignal;
}

export type ImageGenerationFetchLike = (
  url: string,
  init: ImageGenerationFetchInitLike,
) => Promise<ImageGenerationFetchResponseLike>;

export interface CreateFetchImageModelClientOptions {
  fetch?: ImageGenerationFetchLike;
  timeoutMs?: number;
}

const DEFAULT_IMAGE_GENERATION_TIMEOUT_MS = 120_000;

export function createFetchImageModelClient(
  options: CreateFetchImageModelClientOptions = {},
): ImageModelClient {
  const fetch = options.fetch ?? defaultFetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_IMAGE_GENERATION_TIMEOUT_MS;

  return {
    async generate(input) {
      validateGenerateImageOptions({
        model: input.modelName,
        prompt: input.prompt,
        size: input.size,
        quality: input.quality,
        n: input.n,
        output_format: input.format,
      });

      let response: ImageGenerationFetchResponseLike;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      try {
        response = await fetch(`${normalizeBaseUrl(input.baseUrl)}/images/generations`, {
          method: "POST",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${input.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: input.modelName,
            prompt: input.prompt,
            size: input.size,
            quality: input.quality,
            output_format: input.format,
            n: input.n,
          }),
          signal: controller.signal,
        });
      } catch (error) {
        if (error instanceof ImageTaskExecutionError) {
          throw error;
        }
        if (error instanceof DOMException && error.name === "AbortError") {
          throw createModelError("timeout");
        }
        if (error instanceof TypeError) {
          throw createModelError("network_error");
        }
        throw createModelError("unknown_error");
      } finally {
        clearTimeout(timeoutId);
      }

      if (!response || typeof response.status !== "number") {
        throw createModelError("invalid_response");
      }

      if (response.status < 200 || response.status >= 300) {
        const body = await tryReadJson(response);
        throw createModelError(mapStatusToReason(response.status), {
          statusCode: response.status,
          providerCode: extractProviderCode(body),
        });
      }

      const body = await tryReadJson(response);
      const base64 = extractFirstBase64Image(body);
      if (!base64) {
        throw createModelError("invalid_response");
      }

      return {
        base64,
        ...parseImageTaskSize(input.size),
      };
    },
  };
}

async function defaultFetch(
  url: string,
  init: ImageGenerationFetchInitLike,
): Promise<ImageGenerationFetchResponseLike> {
  if (typeof globalThis.fetch !== "function") {
    throw new TypeError("fetch is unavailable");
  }
  return globalThis.fetch(url, init);
}

function mapStatusToReason(status: number): ImageTaskFailureReason {
  if (status === 401 || status === 403) {
    return "unauthorized";
  }
  if (status === 429) {
    return "rate_limited";
  }
  if (status >= 500 && status < 600) {
    return "server_error";
  }
  return "unknown_error";
}

async function tryReadJson(
  response: ImageGenerationFetchResponseLike,
): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function extractFirstBase64Image(body: unknown): string | null {
  if (!isObject(body) || !Array.isArray(body.data)) {
    return null;
  }

  for (const item of body.data) {
    if (isObject(item) && typeof item.b64_json === "string" && item.b64_json.length > 0) {
      return item.b64_json;
    }
  }
  return null;
}

function extractProviderCode(body: unknown): string | undefined {
  if (!isObject(body) || !isObject(body.error)) {
    return undefined;
  }

  return typeof body.error.code === "string" ? body.error.code : undefined;
}

function createModelError(
  reason: ImageTaskFailureReason,
  options: {
    statusCode?: number;
    providerCode?: string;
  } = {},
): ImageTaskExecutionError {
  return new ImageTaskExecutionError(
    reason,
    failureMessage(reason),
    options.statusCode,
    options.providerCode,
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
