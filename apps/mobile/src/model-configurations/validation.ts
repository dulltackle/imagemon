import type {
  ModelConfigurationType,
  ModelConfigurationValidationIssue,
  SaveModelConfigurationInput,
} from "./types";

const BLOCKED_ENDPOINT_PATHS = ["/images/generations", "/images/edits"];

export function validateModelConfigurationInput(
  input: SaveModelConfigurationInput,
): ModelConfigurationValidationIssue[] {
  const issues: ModelConfigurationValidationIssue[] = [];

  if (input.type !== "image" && input.type !== "text") {
    issues.push({
      field: "type",
      code: "invalid_type",
      message: "模型配置类型无效。",
    });
  }

  if (input.name.trim().length === 0) {
    issues.push({
      field: "name",
      code: "required",
      message: "配置名称不能为空。",
    });
  }

  issues.push(...validateBaseUrl(input.baseUrl));

  if (input.modelName.trim().length === 0) {
    issues.push({
      field: "modelName",
      code: "required",
      message: "模型名不能为空。",
    });
  }

  return issues;
}

export function assertValidModelConfigurationInput(input: SaveModelConfigurationInput): void {
  const issues = validateModelConfigurationInput(input);
  if (issues.length > 0) {
    throw new ModelConfigurationValidationError(issues);
  }
}

export function normalizeModelConfigurationInput(
  input: SaveModelConfigurationInput,
): SaveModelConfigurationInput {
  return {
    ...input,
    name: input.name.trim(),
    baseUrl: normalizeBaseUrl(input.baseUrl),
    modelName: input.modelName.trim(),
    apiKey: input.apiKey,
  };
}

export function normalizeBaseUrl(value: string): string {
  const parsed = new URL(value.trim());
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  const serialized = parsed.toString();
  return serialized.endsWith("/") ? serialized.slice(0, -1) : serialized;
}

export function isModelConfigurationType(value: string): value is ModelConfigurationType {
  return value === "image" || value === "text";
}

function validateBaseUrl(value: string): ModelConfigurationValidationIssue[] {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return [
      {
        field: "baseUrl",
        code: "required",
        message: "base URL 不能为空。",
      },
    ];
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return [
      {
        field: "baseUrl",
        code: "invalid_url",
        message: "base URL 不是有效 URL。",
      },
    ];
  }

  if (parsed.protocol !== "https:") {
    return [
      {
        field: "baseUrl",
        code: "unsupported_protocol",
        message: "base URL 必须使用 https。",
      },
    ];
  }

  if (parsed.hostname.trim().length === 0) {
    return [
      {
        field: "baseUrl",
        code: "missing_host",
        message: "base URL 必须包含 host。",
      },
    ];
  }

  const normalizedPath = parsed.pathname.replace(/\/+$/, "");
  if (BLOCKED_ENDPOINT_PATHS.some((path) => normalizedPath.endsWith(path))) {
    return [
      {
        field: "baseUrl",
        code: "endpoint_path",
        message: "base URL 不能写到具体图片接口路径。",
      },
    ];
  }

  return [];
}

export class ModelConfigurationValidationError extends Error {
  constructor(readonly issues: ModelConfigurationValidationIssue[]) {
    super("模型配置校验失败。");
    this.name = "ModelConfigurationValidationError";
  }
}
