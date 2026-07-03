import { createUtcTimestamp } from "../storage";
import type {
  ImageTaskFailureReason,
  ImageTaskFailureSummary,
} from "./types";

export class ImageTaskExecutionError extends Error {
  constructor(
    readonly reason: ImageTaskFailureReason,
    message: string,
    readonly statusCode?: number,
    readonly providerCode?: string,
  ) {
    super(message);
    this.name = "ImageTaskExecutionError";
    Object.setPrototypeOf(this, ImageTaskExecutionError.prototype);
  }
}

export function createImageTaskFailureSummary(
  reason: ImageTaskFailureReason,
  occurredAt = createUtcTimestamp(),
  options: {
    statusCode?: number;
    providerCode?: string;
  } = {},
): ImageTaskFailureSummary {
  const statusCode = normalizeStatusCode(options.statusCode);
  const providerCode = normalizeProviderCode(options.providerCode);

  return {
    reason,
    message: failureMessage(reason),
    occurredAt,
    ...(statusCode !== undefined ? { statusCode } : {}),
    ...(providerCode !== undefined ? { providerCode } : {}),
  };
}

export function summarizeImageTaskError(
  error: unknown,
  occurredAt = createUtcTimestamp(),
): ImageTaskFailureSummary {
  if (error instanceof ImageTaskExecutionError) {
    return createImageTaskFailureSummary(error.reason, occurredAt, {
      statusCode: error.statusCode,
      providerCode: error.providerCode,
    });
  }

  return createImageTaskFailureSummary("unknown_error", occurredAt);
}

export function failureMessage(reason: ImageTaskFailureReason): string {
  switch (reason) {
    case "missing_default_model_configuration":
      return "缺少就绪的默认图片模型配置。";
    case "missing_credential":
      return "默认图片模型配置缺少 API Key。";
    case "invalid_input":
      return "提示词不能为空。";
    case "network_error":
      return "无法连接模型服务，请检查网络或 base URL。";
    case "timeout":
      return "模型服务响应超时，请稍后重试。";
    case "unauthorized":
      return "API Key 未通过认证，请检查凭据。";
    case "rate_limited":
      return "模型服务请求受到限流，请稍后重试。";
    case "server_error":
      return "模型服务暂时不可用，请稍后重试。";
    case "invalid_response":
      return "模型服务响应无效。";
    case "unknown_error":
      return "图片生成失败，请稍后重试或检查模型配置。";
    default: {
      const exhaustive: never = reason;
      throw new Error(`未处理的失败原因: ${String(exhaustive)}`);
    }
  }
}

function normalizeStatusCode(statusCode: number | undefined): number | undefined {
  return statusCode !== undefined &&
    Number.isInteger(statusCode) &&
    statusCode >= 100 &&
    statusCode <= 599
    ? statusCode
    : undefined;
}

function normalizeProviderCode(providerCode: string | undefined): string | undefined {
  if (
    providerCode === undefined ||
    providerCode.length === 0 ||
    providerCode.length > 128 ||
    !/^[A-Za-z0-9._:-]+$/.test(providerCode)
  ) {
    return undefined;
  }
  return providerCode;
}
