import { createUtcTimestamp } from "../storage";
import type {
  ModelConnectionFailureReason,
  ModelConnectionFailureSummary,
} from "./types";
import { normalizeBaseUrl } from "./validation";

export const DEFAULT_MODEL_CONNECTION_TEST_TIMEOUT_MS = 30_000;

export interface FetchResponseLike {
  status: number;
  json(): Promise<unknown>;
}

export interface FetchInitLike {
  method: "GET";
  headers: Record<string, string>;
  signal: AbortSignal;
}

export type FetchLike = (
  url: string,
  init: FetchInitLike,
) => Promise<FetchResponseLike>;

export type ModelConnectionTestResult =
  | {
      status: "succeeded";
      testedAt: string;
    }
  | {
      status: "failed";
      failure: ModelConnectionFailureSummary;
    };

export interface TestModelConnectionOptions {
  baseUrl: string;
  apiKey: string | null | undefined;
  modelName: string;
  fetch?: FetchLike;
  now?: () => string;
  timeoutMs?: number;
}

export async function testModelConnection({
  baseUrl,
  apiKey,
  modelName,
  fetch = defaultFetch,
  now = createUtcTimestamp,
  timeoutMs = DEFAULT_MODEL_CONNECTION_TEST_TIMEOUT_MS,
}: TestModelConnectionOptions): Promise<ModelConnectionTestResult> {
  const testedAt = now();
  const credential = apiKey?.trim();
  if (!credential) {
    return failure("missing_credential", testedAt);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(`${normalizeBaseUrl(baseUrl)}/models`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${credential}`,
      },
      signal: controller.signal,
    });

    if (!response || typeof response.status !== "number") {
      return failure("invalid_response", testedAt);
    }

    const reason = mapStatusToFailureReason(response.status);
    if (reason) {
      return failure(reason, testedAt);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return failure("invalid_response", testedAt);
    }

    const modelIds = extractModelIds(body);
    if (!modelIds) {
      return failure("invalid_response", testedAt);
    }

    const expectedModelName = modelName.trim();
    if (!modelIds.includes(expectedModelName)) {
      return failure(
        "model_not_found",
        testedAt,
        `模型服务返回的模型列表不包含 ${formatQuotedValue(expectedModelName)}。`,
      );
    }

    return { status: "succeeded", testedAt };
  } catch (error) {
    if (controller.signal.aborted || isAbortError(error)) {
      return failure("timeout", testedAt);
    }
    if (error instanceof TypeError) {
      return failure("network_error", testedAt);
    }
    return failure("unknown_error", testedAt);
  } finally {
    clearTimeout(timeout);
  }
}

function mapStatusToFailureReason(status: number): ModelConnectionFailureReason | null {
  if (status >= 200 && status < 300) {
    return null;
  }
  if (status === 401) {
    return "unauthorized";
  }
  if (status === 403) {
    return "forbidden";
  }
  if (status === 429) {
    return "rate_limited";
  }
  if (status >= 400 && status < 500) {
    return "invalid_response";
  }
  if (status >= 500 && status < 600) {
    return "server_error";
  }
  return "invalid_response";
}

function failure(
  reason: ModelConnectionFailureReason,
  occurredAt: string,
  message = failureMessage(reason),
): ModelConnectionTestResult {
  return {
    status: "failed",
    failure: {
      reason,
      message,
      occurredAt,
    },
  };
}

function failureMessage(reason: ModelConnectionFailureReason): string {
  switch (reason) {
    case "missing_credential":
      return "缺少 API Key。";
    case "unauthorized":
      return "API Key 未通过认证。";
    case "forbidden":
      return "当前凭据没有访问权限。";
    case "rate_limited":
      return "请求受到限流。";
    case "server_error":
      return "模型服务返回服务器错误。";
    case "network_error":
      return "网络连接失败。";
    case "timeout":
      return "测试连接超时。";
    case "invalid_response":
      return "模型服务没有返回可解析的模型列表，请检查 base URL 是否包含 API 版本前缀。";
    case "model_not_found":
      return "模型服务返回的模型列表不包含当前模型名。";
    case "unknown_error":
      return "测试连接失败。";
  }
}

function extractModelIds(body: unknown): string[] | null {
  if (!isObject(body) || !Array.isArray(body.data)) {
    return null;
  }

  const ids: string[] = [];
  for (const item of body.data) {
    if (!isObject(item) || typeof item.id !== "string" || item.id.trim() === "") {
      return null;
    }
    ids.push(item.id);
  }
  return ids;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function formatQuotedValue(value: string): string {
  return value ? `“${value}”` : "当前模型名";
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

async function defaultFetch(url: string, init: FetchInitLike): Promise<FetchResponseLike> {
  if (typeof globalThis.fetch !== "function") {
    throw new TypeError("fetch is unavailable");
  }
  return globalThis.fetch(url, init);
}
