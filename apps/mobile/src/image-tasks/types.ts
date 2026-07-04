export const IMAGE_TASK_AVAILABLE_SIZES = [
  "1024x1024",
  "1536x1024",
  "1024x1536",
] as const;

export type ImageTaskType = "generate";
export type ImageTaskStatus = "running" | "completed" | "failed" | "unknown";
export type ImageTaskSize = (typeof IMAGE_TASK_AVAILABLE_SIZES)[number];
export type ImageResultFormat = "png";

export type ImageTaskFailureReason =
  | "missing_default_model_configuration"
  | "missing_credential"
  | "invalid_input"
  | "network_error"
  | "timeout"
  | "unauthorized"
  | "rate_limited"
  | "server_error"
  | "invalid_request"
  | "content_rejected"
  | "invalid_response"
  | "unknown_error";

export interface ImageTaskFailureSummary {
  reason: ImageTaskFailureReason;
  message: string;
  occurredAt: string;
  statusCode?: number;
  providerCode?: string;
}

export interface ImageTaskSnapshot {
  source: "manual";
  prompt: string;
  imageSpec: {
    size: ImageTaskSize;
    quality: "auto";
    format: ImageResultFormat;
    n: 1;
  };
  modelConfiguration: {
    type: "image";
    baseUrl: string;
    modelName: string;
  };
}

export interface ImageTaskHistory {
  id: string;
  taskType: ImageTaskType;
  status: ImageTaskStatus;
  snapshot: ImageTaskSnapshot;
  errorSummary: ImageTaskFailureSummary | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface ImageResult {
  id: string;
  taskHistoryId: string | null;
  filePath: string;
  format: ImageResultFormat;
  width: number | null;
  height: number | null;
  createdAt: string;
}

export function parseImageTaskSize(
  size: ImageTaskSize,
): { width: number; height: number } {
  const [width, height] = size.split("x").map(Number);
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    throw new Error(`无效的图片任务尺寸: ${size}`);
  }
  return { width, height };
}
