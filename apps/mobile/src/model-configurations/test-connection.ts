import { createUtcTimestamp } from "../storage";
import type {
  ModelConnectionFailureReason,
  ModelConnectionFailureSummary,
} from "./types";
import { normalizeBaseUrl } from "./validation";

export const DEFAULT_MODEL_CONNECTION_TEST_TIMEOUT_MS = 30_000;

export interface FetchResponseLike {
  status: number;
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
  fetch?: FetchLike;
  now?: () => string;
  timeoutMs?: number;
}

export async function testModelConnection({
  baseUrl,
  apiKey,
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
    return reason ? failure(reason, testedAt) : { status: "succeeded", testedAt };
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
    return null;
  }
  if (status >= 500 && status < 600) {
    return "server_error";
  }
  return "invalid_response";
}

function failure(
  reason: ModelConnectionFailureReason,
  occurredAt: string,
): ModelConnectionTestResult {
  return {
    status: "failed",
    failure: {
      reason,
      message: failureMessage(reason),
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
      return "模型服务响应无效。";
    case "unknown_error":
      return "测试连接失败。";
  }
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
