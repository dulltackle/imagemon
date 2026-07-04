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

type GeneratedImageModelPayload =
  | {
      base64: string;
      bytes?: never;
    }
  | {
      base64?: never;
      bytes: Uint8Array;
    };

export type GeneratedImageModelResult = {
  width: number;
  height: number;
} & GeneratedImageModelPayload;

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

export interface ImageDownloadFetchResponseLike {
  status: number;
  headers: {
    get(name: string): string | null;
  };
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface ImageDownloadFetchInitLike {
  method: "GET";
  headers: Record<string, string>;
  signal?: AbortSignal;
}

export type ImageDownloadFetchLike = (
  url: string,
  init: ImageDownloadFetchInitLike,
) => Promise<ImageDownloadFetchResponseLike>;

export interface CreateFetchImageModelClientOptions {
  fetch?: ImageGenerationFetchLike;
  downloadFetch?: ImageDownloadFetchLike;
  timeoutMs?: number;
}

const MAX_IMAGE_DOWNLOAD_BYTES = 20 * 1024 * 1024;
const ALLOWED_IMAGE_CONTENT_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

export function createFetchImageModelClient(
  options: CreateFetchImageModelClientOptions = {},
): ImageModelClient {
  const fetch = options.fetch ?? defaultFetch;
  const downloadFetch = options.downloadFetch ?? defaultDownloadFetch;
  const timeoutMs = options.timeoutMs;

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

      const controller = timeoutMs === undefined ? undefined : new AbortController();
      const timeoutId =
        controller === undefined
          ? undefined
          : setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(`${normalizeBaseUrl(input.baseUrl)}/images/generations`, {
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
          signal: controller?.signal,
        });

        if (!response || typeof response.status !== "number") {
          throw createModelError("invalid_response");
        }

        if (response.status < 200 || response.status >= 300) {
          const body = await tryReadJson(response);
          const providerCode = extractProviderCode(body);
          throw createModelError(mapResponseFailureReason(response.status, providerCode), {
            statusCode: response.status,
            providerCode,
          });
        }

        const body = await tryReadJson(response);
        const image = await extractFirstImage(body, downloadFetch, controller?.signal);
        if (!image) {
          throw createModelError("invalid_response");
        }

        const size = parseImageTaskSize(input.size);
        if (image.base64 !== undefined) {
          return {
            base64: image.base64,
            ...size,
          };
        }
        return {
          bytes: image.bytes,
          ...size,
        };
      } catch (error) {
        if (error instanceof ImageTaskExecutionError) {
          throw error;
        }
        if (controller?.signal.aborted) {
          throw createModelError("timeout");
        }
        if (isTimeoutLikeError(error)) {
          throw createModelError("timeout");
        }
        if (isAbortError(error)) {
          throw createModelError("network_error");
        }
        if (isNetworkLikeError(error)) {
          throw createModelError("network_error");
        }
        throw createModelError("unknown_error");
      } finally {
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
        }
      }
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

async function defaultDownloadFetch(
  url: string,
  init: ImageDownloadFetchInitLike,
): Promise<ImageDownloadFetchResponseLike> {
  if (typeof globalThis.fetch !== "function") {
    throw new TypeError("fetch is unavailable");
  }
  const response = await globalThis.fetch(url, init);
  return {
    status: response.status,
    headers: response.headers,
    async arrayBuffer() {
      return await response.arrayBuffer();
    },
  };
}

function mapResponseFailureReason(
  status: number,
  providerCode: string | undefined,
): ImageTaskFailureReason {
  const providerCodeTokens = tokenizeProviderCode(providerCode);
  if (matchesProviderCode(providerCodeTokens, [
    ["content", "policy"],
    ["content", "filter"],
    ["policy", "violation"],
    ["moderation"],
    ["safety"],
    ["rejected"],
  ])) {
    return "content_rejected";
  }
  if (matchesProviderCode(providerCodeTokens, [
    ["auth"],
    ["authentication"],
    ["unauthorized"],
    ["forbidden"],
    ["permission"],
    ["invalid", "api", "key"],
  ])) {
    return "unauthorized";
  }
  if (matchesProviderCode(providerCodeTokens, [
    ["rate"],
    ["quota"],
    ["too", "many", "requests"],
  ])) {
    return "rate_limited";
  }
  if (status === 401 || status === 403) {
    return "unauthorized";
  }
  if (status === 408) {
    return "timeout";
  }
  if (status === 429) {
    return "rate_limited";
  }
  if (status >= 500 && status < 600) {
    return "server_error";
  }
  if (status >= 400 && status < 500) {
    return "invalid_request";
  }
  return "invalid_response";
}

function tokenizeProviderCode(providerCode: string | undefined): string[] {
  return providerCode?.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean) ?? [];
}

function matchesProviderCode(
  tokens: readonly string[],
  patterns: readonly (readonly string[])[],
): boolean {
  return patterns.some((pattern) => hasTokenSequence(tokens, pattern));
}

function hasTokenSequence(
  tokens: readonly string[],
  pattern: readonly string[],
): boolean {
  if (pattern.length === 0 || tokens.length < pattern.length) {
    return false;
  }

  for (let index = 0; index <= tokens.length - pattern.length; index += 1) {
    if (pattern.every((token, offset) => tokens[index + offset] === token)) {
      return true;
    }
  }
  return false;
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

async function extractFirstImage(
  body: unknown,
  downloadFetch: ImageDownloadFetchLike,
  signal: AbortSignal | undefined,
): Promise<GeneratedImageModelPayload | null> {
  if (!isObject(body) || !Array.isArray(body.data)) {
    return null;
  }

  for (const item of body.data) {
    if (isObject(item) && typeof item.b64_json === "string" && item.b64_json.length > 0) {
      return { base64: item.b64_json };
    }
    if (isObject(item) && typeof item.url === "string" && item.url.length > 0) {
      return { bytes: await downloadImageBytes(item.url, downloadFetch, signal) };
    }
  }
  return null;
}

async function downloadImageBytes(
  imageUrl: string,
  fetch: ImageDownloadFetchLike,
  signal: AbortSignal | undefined,
): Promise<Uint8Array> {
  if (!isAllowedImageUrl(imageUrl)) {
    throw createModelError("invalid_response");
  }

  const response = await fetch(imageUrl, {
    method: "GET",
    headers: {
      Accept: "image/*",
    },
    signal,
  });
  if (
    !response ||
    typeof response.status !== "number" ||
    !response.headers ||
    typeof response.headers.get !== "function" ||
    typeof response.arrayBuffer !== "function" ||
    response.status < 200 ||
    response.status >= 300
  ) {
    throw createModelError("invalid_response");
  }

  validateDownloadContentType(response.headers);
  validateDownloadContentLength(response.headers);

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_DOWNLOAD_BYTES) {
    throw createModelError("invalid_response");
  }
  return bytes;
}

function isAllowedImageUrl(imageUrl: string): boolean {
  try {
    const url = new URL(imageUrl);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

function validateDownloadContentType(headers: ImageDownloadFetchResponseLike["headers"]): void {
  const contentType = headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (!contentType || !ALLOWED_IMAGE_CONTENT_TYPES.has(contentType)) {
    throw createModelError("invalid_response");
  }
}

function validateDownloadContentLength(headers: ImageDownloadFetchResponseLike["headers"]): void {
  const rawContentLength = headers.get("content-length")?.trim();
  if (!rawContentLength || !/^\d+$/.test(rawContentLength)) {
    throw createModelError("invalid_response");
  }

  const contentLength = Number(rawContentLength);
  if (
    !Number.isSafeInteger(contentLength) ||
    contentLength <= 0 ||
    contentLength > MAX_IMAGE_DOWNLOAD_BYTES
  ) {
    throw createModelError("invalid_response");
  }
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

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function isTimeoutLikeError(error: unknown): boolean {
  return containsAny(errorFingerprint(error), [
    "timeout",
    "timed out",
    "etimedout",
    "nsurlerrortimedout",
  ]);
}

function isNetworkLikeError(error: unknown): boolean {
  if (error instanceof TypeError) {
    return true;
  }

  return containsAny(errorFingerprint(error), [
    "network",
    "failed to fetch",
    "request failed",
    "econn",
    "enet",
    "dns",
    "offline",
    "internet connection",
    "could not connect",
  ]);
}

function errorFingerprint(error: unknown): string {
  const parts: string[] = [];
  if (error instanceof Error) {
    parts.push(error.name, error.message);
  }
  if (isObject(error)) {
    for (const key of ["name", "message", "code"] as const) {
      const value = error[key];
      if (typeof value === "string") {
        parts.push(value);
      }
    }
  }
  return parts.join(" ").toLowerCase();
}

function containsAny(value: string, needles: readonly string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}
