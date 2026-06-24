export type ImageTaskErrorCategory =
  | "auth"
  | "rate_limit"
  | "network"
  | "server"
  | "invalid_request"
  | "content_rejected"
  | "unknown";

export interface ImageTaskErrorSummary {
  category: ImageTaskErrorCategory;
  message: string;
  occurredAt: string;
  httpStatus?: number;
  platformCode?: string;
}

export function createImageTaskErrorSummary(
  error: unknown,
  occurredAt: Date | string = new Date(),
): ImageTaskErrorSummary {
  const httpStatus = getHttpStatus(error);
  const platformCode = getPlatformCode(error);
  const category = categorizeError(error, httpStatus, platformCode);

  return {
    category,
    message: messageForCategory(category),
    occurredAt: normalizeTimestamp(occurredAt),
    ...(httpStatus !== undefined ? { httpStatus } : {}),
    ...(platformCode !== undefined ? { platformCode } : {}),
  };
}

function categorizeError(
  error: unknown,
  httpStatus: number | undefined,
  platformCode: string | undefined,
): ImageTaskErrorCategory {
  const normalizedCode = platformCode?.toLowerCase() ?? "";
  const normalizedMessage = error instanceof Error ? error.message.toLowerCase() : "";

  if (containsAny(`${normalizedCode} ${normalizedMessage}`, ["content", "moderation", "policy", "safety", "rejected"])) {
    return "content_rejected";
  }
  if (httpStatus === 401 || httpStatus === 403 || containsAny(normalizedCode, ["auth", "permission", "invalid_api_key"])) {
    return "auth";
  }
  if (httpStatus === 429 || containsAny(normalizedCode, ["rate", "quota", "too_many_requests"])) {
    return "rate_limit";
  }
  if (httpStatus !== undefined && httpStatus >= 500) {
    return "server";
  }
  if (httpStatus !== undefined && httpStatus >= 400) {
    return "invalid_request";
  }
  if (isNetworkError(error, normalizedCode)) {
    return "network";
  }
  return "unknown";
}

function messageForCategory(category: ImageTaskErrorCategory): string {
  switch (category) {
    case "auth":
      return "模型服务鉴权失败，请检查 API Key 或权限。";
    case "rate_limit":
      return "模型服务限流，请稍后重试。";
    case "network":
      return "无法连接模型服务，请检查网络或 base URL。";
    case "server":
      return "模型服务暂时不可用，请稍后重试。";
    case "invalid_request":
      return "模型服务拒绝了本次请求，请检查任务输入和图片规格。";
    case "content_rejected":
      return "模型服务拒绝了本次内容，请调整任务输入后重试。";
    case "unknown":
      return "图片任务失败，请稍后重试或检查模型服务配置。";
  }
}

function getHttpStatus(error: unknown): number | undefined {
  const status = getNumericProperty(error, "status") ?? getNumericProperty(error, "statusCode");
  return status !== undefined && Number.isInteger(status) && status >= 100 && status <= 599 ? status : undefined;
}

function getPlatformCode(error: unknown): string | undefined {
  const code = getStringProperty(error, "code") ?? getNestedStringProperty(error, "error", "code");
  if (!code || code.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(code)) {
    return undefined;
  }
  return code;
}

function getNumericProperty(value: unknown, key: string): number | undefined {
  if (!isObject(value)) {
    return undefined;
  }
  return typeof value[key] === "number" ? value[key] : undefined;
}

function getStringProperty(value: unknown, key: string): string | undefined {
  if (!isObject(value)) {
    return undefined;
  }
  return typeof value[key] === "string" ? value[key] : undefined;
}

function getNestedStringProperty(value: unknown, objectKey: string, nestedKey: string): string | undefined {
  if (!isObject(value) || !isObject(value[objectKey])) {
    return undefined;
  }
  return typeof value[objectKey][nestedKey] === "string" ? value[objectKey][nestedKey] : undefined;
}

function isNetworkError(error: unknown, normalizedCode: string): boolean {
  if (containsAny(normalizedCode, ["econn", "enet", "etimedout", "timeout", "dns"])) {
    return true;
  }
  return error instanceof TypeError;
}

function containsAny(value: string, needles: readonly string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}

function normalizeTimestamp(value: Date | string): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("occurredAt must be a valid date");
  }
  return parsed.toISOString();
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
