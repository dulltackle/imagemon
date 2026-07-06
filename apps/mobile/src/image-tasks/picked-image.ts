import type { ImagePickerAsset } from "expo-image-picker";

const MAX_EDIT_INPUT_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_EDIT_INPUT_IMAGE_PIXELS = 25_000_000;

const IMAGE_EXTENSION_MIME_TYPES = new Map<string, string>([
  ["png", "image/png"],
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["webp", "image/webp"],
  ["gif", "image/gif"],
  ["heic", "image/heic"],
  ["heif", "image/heif"],
]);

export interface PickedEditInputImage {
  uri: string;
  mimeType: string;
  fileName: string | null;
  width: number;
  height: number;
  byteSize: number;
}

export type PickedEditInputImageErrorReason =
  | "unreadable"
  | "non_image"
  | "too_large"
  | "too_many_pixels";

export interface PickedEditInputImageError {
  reason: PickedEditInputImageErrorReason;
  message: string;
}

export type NormalizePickedEditInputImageResult =
  | { status: "ready"; image: PickedEditInputImage }
  | { status: "failed"; error: PickedEditInputImageError };

export interface NormalizePickedEditInputImageOptions {
  getFileInfo?: (uri: string) => Promise<PickedImageFileInfo>;
}

export interface PickedImageFileInfo {
  exists: boolean;
  size?: number | null;
}

export async function normalizePickedEditInputImage(
  asset: ImagePickerAsset,
  options: NormalizePickedEditInputImageOptions = {},
): Promise<NormalizePickedEditInputImageResult> {
  const uri = asset.uri.trim();
  if (!uri) {
    return failed("unreadable");
  }

  const mimeType = resolveImageMimeType(asset);
  if (!mimeType) {
    return failed("non_image");
  }

  const width = normalizePositiveInteger(asset.width);
  const height = normalizePositiveInteger(asset.height);
  if (width === null || height === null) {
    return failed("unreadable");
  }

  if (width * height > MAX_EDIT_INPUT_IMAGE_PIXELS) {
    return failed("too_many_pixels");
  }

  const byteSize = await resolveByteSize(
    uri,
    asset.fileSize,
    options.getFileInfo ?? getExpoFileInfo,
  );
  if (byteSize === null) {
    return failed("unreadable");
  }
  if (byteSize > MAX_EDIT_INPUT_IMAGE_BYTES) {
    return failed("too_large");
  }

  return {
    status: "ready",
    image: {
      uri,
      mimeType,
      fileName: asset.fileName ?? null,
      width,
      height,
      byteSize,
    },
  };
}

function failed(
  reason: PickedEditInputImageErrorReason,
): NormalizePickedEditInputImageResult {
  return {
    status: "failed",
    error: {
      reason,
      message: getPickedEditInputImageErrorMessage(reason),
    },
  };
}

export function getPickedEditInputImageErrorMessage(
  reason: PickedEditInputImageErrorReason,
): string {
  switch (reason) {
    case "unreadable":
      return "无法读取所选图片，请重新选择。";
    case "non_image":
      return "请选择图片文件。";
    case "too_large":
      return "所选图片超过 20MB，请选择较小的图片。";
    case "too_many_pixels":
      return "所选图片像素过高，请选择不超过 25MP 的图片。";
  }
}

function resolveImageMimeType(asset: ImagePickerAsset): string | null {
  const mimeType = asset.mimeType?.trim().toLowerCase();
  if (mimeType) {
    return mimeType.startsWith("image/") ? mimeType : null;
  }

  return inferImageMimeType(asset.fileName ?? asset.uri);
}

function inferImageMimeType(filePath: string): string | null {
  const extension = getFileExtension(filePath);
  if (!extension) {
    return null;
  }
  return IMAGE_EXTENSION_MIME_TYPES.get(extension) ?? null;
}

function getFileExtension(filePath: string): string | null {
  const withoutQuery = filePath.split(/[?#]/, 1)[0];
  const lastPathSegment = withoutQuery.split("/").at(-1) ?? "";
  const extensionSeparatorIndex = lastPathSegment.lastIndexOf(".");
  if (
    extensionSeparatorIndex <= 0 ||
    extensionSeparatorIndex === lastPathSegment.length - 1
  ) {
    return null;
  }
  return lastPathSegment.slice(extensionSeparatorIndex + 1).toLowerCase();
}

function normalizePositiveInteger(value: number): number | null {
  return Number.isInteger(value) && value > 0 ? value : null;
}

async function resolveByteSize(
  uri: string,
  fileSize: number | undefined,
  getFileInfo: (uri: string) => Promise<PickedImageFileInfo>,
): Promise<number | null> {
  if (
    typeof fileSize === "number" &&
    Number.isInteger(fileSize) &&
    fileSize >= 0
  ) {
    return fileSize;
  }

  try {
    const info = await getFileInfo(uri);
    const size = info.size;
    if (!info.exists || typeof size !== "number" || !Number.isInteger(size)) {
      return null;
    }
    return size >= 0 ? size : null;
  } catch {
    return null;
  }
}

async function getExpoFileInfo(uri: string): Promise<PickedImageFileInfo> {
  const { File } = await import("expo-file-system");
  const info = new File(uri).info();
  return {
    exists: info.exists,
    size: info.size ?? null,
  };
}
