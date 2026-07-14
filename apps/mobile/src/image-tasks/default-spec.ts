import { IMAGE_TASK_AVAILABLE_SIZES, type ImageTaskSize } from "./types";

/**
 * 应用默认规格（ADR 0038）。
 *
 * 当前版本只有 size 一个维度存在多个取值；quality / format / count 各自只支持
 * 一个取值，因此类型写成字面量，如实反映能力边界。将来放开某一维时，把对应的
 * 字面量改成联合类型即可。
 */
export interface ApplicationDefaultImageSpec {
  size: ImageTaskSize;
  quality: "auto";
  format: "png";
  count: 1;
}

export const APPLICATION_DEFAULT_IMAGE_SPEC: ApplicationDefaultImageSpec = {
  size: "1024x1024",
  quality: "auto",
  format: "png",
  count: 1,
};

const SIZE_LABELS: Record<ImageTaskSize, string> = {
  "1024x1024": "方图",
  "1536x1024": "横图",
  "1024x1536": "竖图",
};

export function getImageTaskSizeLabel(size: ImageTaskSize): string {
  return SIZE_LABELS[size];
}

/**
 * 读时容错：任何不被当前版本支持的持久化值都回落到默认值，绝不抛错。
 *
 * 备份文件或旧库里可能存着未来版本才支持的取值（例如 quality: "high"），
 * 按 ADR 0091 / 0092「不被当前版本支持的规格不得阻断」，读时回落而不是写时
 * 用 CHECK 约束拦截。
 */
export function parseApplicationDefaultImageSpec(raw: {
  size: unknown;
  quality: unknown;
  format: unknown;
  count: unknown;
}): ApplicationDefaultImageSpec {
  return {
    size: isImageTaskSize(raw.size)
      ? raw.size
      : APPLICATION_DEFAULT_IMAGE_SPEC.size,
    quality:
      raw.quality === "auto" ? "auto" : APPLICATION_DEFAULT_IMAGE_SPEC.quality,
    format: raw.format === "png" ? "png" : APPLICATION_DEFAULT_IMAGE_SPEC.format,
    count: raw.count === 1 ? 1 : APPLICATION_DEFAULT_IMAGE_SPEC.count,
  };
}

function isImageTaskSize(value: unknown): value is ImageTaskSize {
  return IMAGE_TASK_AVAILABLE_SIZES.some((size) => size === value);
}
