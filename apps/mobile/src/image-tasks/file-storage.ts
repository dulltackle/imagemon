import type {
  ImageResultFormat,
  ImageTaskInternalAttachmentSnapshot,
} from "./types";
import { MAX_BASE_MEDIA_UPLOAD_BYTES } from "../shared/base-media-upload";

export interface ImageResultFileStorage {
  saveImageResultFile(input: SaveImageResultFileInput): Promise<SavedImageResultFile>;
  resolveFileUri(filePath: string): Promise<string>;
  createUploadFile(
    filePath: string,
    format: ImageResultFormat,
  ): Promise<ImageResultUploadFile>;
  deleteFile(filePath: string): Promise<void>;
}

export interface ImageTaskInternalAttachmentStorage {
  copyTaskInputAttachment(
    input: CopyTaskInputAttachmentInput,
  ): Promise<SavedTaskInputAttachment>;
  resolveAttachmentUri(filePath: string): Promise<string>;
  createUploadFile(
    filePath: string,
    metadata: ImageTaskInternalAttachmentSnapshot,
  ): Promise<ImageUploadFile>;
  deleteAttachment(filePath: string): Promise<void>;
}

export interface SaveImageResultFileInput {
  imageResultId: string;
  format: ImageResultFormat;
  base64?: string;
  bytes?: Uint8Array;
}

export interface SavedImageResultFile {
  filePath: string;
}

export interface CopyTaskInputAttachmentInput {
  historyId: string;
  role: "image" | "mask";
  sourceUri: string;
  mimeType: string;
  originalFileName?: string | null;
  width?: number | null;
  height?: number | null;
  byteSize?: number | null;
}

export type SavedTaskInputAttachment = ImageTaskInternalAttachmentSnapshot;

export interface ImageUploadFile {
  uri: string;
  name: string;
  type: string;
}

export interface ImageResultUploadFile extends ImageUploadFile {
  size: number;
}

const IMAGE_RESULTS_DIRECTORY = "image-results";
const TASK_HISTORY_ATTACHMENTS_DIRECTORY = "task-history-attachments";

const IMAGE_MIME_EXTENSIONS = new Map<string, string>([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/jpg", "jpg"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
  ["image/heic", "heic"],
  ["image/heif", "heif"],
]);

const SUPPORTED_IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "heic",
  "heif",
]);

export function createExpoImageResultFileStorage(): ImageResultFileStorage {
  return {
    async saveImageResultFile(input) {
      const { Directory, File, Paths } = await import("expo-file-system");
      const fileName = createImageResultFileName(input.imageResultId, input.format);
      const directory = new Directory(Paths.document, IMAGE_RESULTS_DIRECTORY);
      directory.create({ idempotent: true, intermediates: true });

      const file = new File(directory, fileName);
      file.create({ intermediates: true, overwrite: false });
      if (input.base64 !== undefined) {
        file.write(input.base64, { encoding: "base64" });
      } else if (input.bytes !== undefined) {
        file.write(input.bytes);
      } else {
        throw new Error("图片结果内容缺失。");
      }

      return {
        filePath: `${IMAGE_RESULTS_DIRECTORY}/${fileName}`,
      };
    },

    async resolveFileUri(filePath) {
      if (isAbsoluteUri(filePath)) {
        return filePath;
      }

      const { File, Paths } = await import("expo-file-system");
      const segments = parseInternalFilePath(filePath);
      return new File(Paths.document, ...segments).uri;
    },

    async createUploadFile(filePath, format) {
      const segments = parseInternalFilePath(filePath);
      const { File, Paths } = await import("expo-file-system");
      const file = new File(Paths.document, ...segments);
      const info = file.info();
      const size = assertUploadableImageResultFile(info.exists, info.size);
      return {
        uri: file.uri,
        name: segments[segments.length - 1],
        type: imageResultMimeType(format),
        size,
      };
    },

    async deleteFile(filePath) {
      const segments = parseInternalFilePath(filePath);
      const { File, Paths } = await import("expo-file-system");
      const file = new File(Paths.document, ...segments);
      if (file.exists) {
        file.delete();
      }
    },
  };
}

export function createExpoImageTaskInternalAttachmentStorage(): ImageTaskInternalAttachmentStorage {
  return {
    async copyTaskInputAttachment(input) {
      const { Directory, File, Paths } = await import("expo-file-system");
      const fileName = createAttachmentFileName(input);
      const directory = new Directory(
        Paths.document,
        TASK_HISTORY_ATTACHMENTS_DIRECTORY,
        input.historyId,
      );
      directory.create({ idempotent: true, intermediates: true });

      const source = new File(input.sourceUri);
      if (!source.exists) {
        throw new Error("无法读取编辑输入附件。");
      }
      const destination = new File(directory, fileName);
      source.copy(destination);

      return createAttachmentSnapshot(input, fileName);
    },

    async resolveAttachmentUri(filePath) {
      const { File, Paths } = await import("expo-file-system");
      const segments = parseTaskInputAttachmentFilePath(filePath);
      const file = new File(Paths.document, ...segments);
      if (!file.exists) {
        throw new Error("编辑输入附件文件缺失。");
      }
      return file.uri;
    },

    async createUploadFile(filePath, metadata) {
      const uri = await this.resolveAttachmentUri(filePath);
      const segments = parseTaskInputAttachmentFilePath(filePath);
      return {
        uri,
        name: segments[segments.length - 1],
        type: metadata.mimeType,
      };
    },

    async deleteAttachment(filePath) {
      const { File, Paths } = await import("expo-file-system");
      const segments = parseTaskInputAttachmentFilePath(filePath);
      const file = new File(Paths.document, ...segments);
      if (file.exists) {
        file.delete();
      }
    },
  };
}

export function createMemoryImageResultFileStorage(): ImageResultFileStorage & {
  readonly files: Map<string, string | Uint8Array>;
} {
  const files = new Map<string, string | Uint8Array>();

  return {
    files,
    async saveImageResultFile(input) {
      const fileName = createImageResultFileName(input.imageResultId, input.format);
      const filePath = `${IMAGE_RESULTS_DIRECTORY}/${fileName}`;
      if (input.base64 !== undefined) {
        files.set(filePath, input.base64);
      } else if (input.bytes !== undefined) {
        files.set(filePath, input.bytes);
      } else {
        throw new Error("图片结果内容缺失。");
      }
      return { filePath };
    },
    async resolveFileUri(filePath) {
      parseInternalFilePath(filePath);
      return `memory:///${filePath}`;
    },
    async createUploadFile(filePath, format) {
      const segments = parseInternalFilePath(filePath);
      const content = files.get(filePath);
      if (content === undefined) {
        throw new Error("图片结果文件缺失。");
      }
      const size = assertUploadableImageResultFile(
        true,
        typeof content === "string"
          ? base64ByteLength(content)
          : content.byteLength,
      );
      return {
        uri: `memory:///${filePath}`,
        name: segments[segments.length - 1],
        type: imageResultMimeType(format),
        size,
      };
    },
    async deleteFile(filePath) {
      parseInternalFilePath(filePath);
      files.delete(filePath);
    },
  };
}

export function createMemoryImageTaskInternalAttachmentStorage(): ImageTaskInternalAttachmentStorage & {
  readonly files: Map<string, CopyTaskInputAttachmentInput>;
} {
  const files = new Map<string, CopyTaskInputAttachmentInput>();

  return {
    files,
    async copyTaskInputAttachment(input) {
      const fileName = createAttachmentFileName(input);
      const attachment = createAttachmentSnapshot(input, fileName);
      files.set(attachment.filePath, { ...input });
      return attachment;
    },
    async resolveAttachmentUri(filePath) {
      parseTaskInputAttachmentFilePath(filePath);
      if (!files.has(filePath)) {
        throw new Error("编辑输入附件文件缺失。");
      }
      return `memory:///${filePath}`;
    },
    async createUploadFile(filePath, metadata) {
      const uri = await this.resolveAttachmentUri(filePath);
      const segments = parseTaskInputAttachmentFilePath(filePath);
      return {
        uri,
        name: segments[segments.length - 1],
        type: metadata.mimeType,
      };
    },
    async deleteAttachment(filePath) {
      parseTaskInputAttachmentFilePath(filePath);
      files.delete(filePath);
    },
  };
}

function assertSafePathSegment(segment: string): void {
  if (
    segment.trim().length === 0 ||
    segment === "." ||
    segment === ".." ||
    segment.includes("/") ||
    segment.includes("\\") ||
    segment.includes("\0")
  ) {
    throw new Error("内部文件路径片段无效。");
  }
}

function createImageResultFileName(
  imageResultId: string,
  format: ImageResultFormat,
): string {
  assertSafePathSegment(imageResultId);
  return `${imageResultId}.${format}`;
}

function imageResultMimeType(format: ImageResultFormat): string {
  switch (format) {
    case "png":
      return "image/png";
  }
}

function assertUploadableImageResultFile(
  exists: boolean,
  size: number | undefined,
): number {
  if (!exists) {
    throw new Error("图片结果文件缺失。");
  }
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size <= 0) {
    throw new Error("图片结果文件为空或无法读取文件大小。");
  }
  if (size > MAX_BASE_MEDIA_UPLOAD_BYTES) {
    throw new Error("图片结果文件超过 20 MB 上传上限。");
  }
  return size;
}

function base64ByteLength(value: string): number {
  const normalized = value.replace(/\s/g, "");
  if (normalized === "") {
    return 0;
  }
  const padding = normalized.endsWith("==")
    ? 2
    : normalized.endsWith("=")
      ? 1
      : 0;
  return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);
}

function parseInternalFilePath(filePath: string): string[] {
  const segments = filePath.split("/");
  if (segments.length !== 2 || segments[0] !== IMAGE_RESULTS_DIRECTORY) {
    throw new Error("图片结果路径无效。");
  }
  try {
    for (const segment of segments) {
      assertSafePathSegment(segment);
    }
  } catch {
    throw new Error("图片结果路径无效。");
  }
  return segments;
}

function createAttachmentFileName(input: CopyTaskInputAttachmentInput): string {
  assertSafePathSegment(input.historyId);
  const extension = inferImageExtension(input);
  return `${input.role}.${extension}`;
}

function createAttachmentSnapshot(
  input: CopyTaskInputAttachmentInput,
  fileName: string,
): SavedTaskInputAttachment {
  const filePath = `${TASK_HISTORY_ATTACHMENTS_DIRECTORY}/${input.historyId}/${fileName}`;
  parseTaskInputAttachmentFilePath(filePath);
  return {
    role: input.role,
    filePath,
    mimeType: input.mimeType,
    originalFileName: input.originalFileName ?? null,
    width: input.width ?? null,
    height: input.height ?? null,
    byteSize: input.byteSize ?? null,
  };
}

function inferImageExtension(input: CopyTaskInputAttachmentInput): string {
  const originalExtension = input.originalFileName
    ? getSafeFileExtension(input.originalFileName)
    : null;
  if (originalExtension) {
    return originalExtension === "jpeg" ? "jpg" : originalExtension;
  }

  const mimeExtension = IMAGE_MIME_EXTENSIONS.get(input.mimeType.toLowerCase());
  if (mimeExtension) {
    return mimeExtension;
  }

  throw new Error("编辑输入附件类型不受支持。");
}

function getSafeFileExtension(fileName: string): string | null {
  const normalizedName = fileName.trim();
  const extensionSeparatorIndex = normalizedName.lastIndexOf(".");
  if (
    extensionSeparatorIndex <= 0 ||
    extensionSeparatorIndex === normalizedName.length - 1
  ) {
    return null;
  }

  const extension = normalizedName.slice(extensionSeparatorIndex + 1).toLowerCase();
  if (!SUPPORTED_IMAGE_EXTENSIONS.has(extension)) {
    return null;
  }
  assertSafePathSegment(extension);
  return extension;
}

function parseTaskInputAttachmentFilePath(filePath: string): string[] {
  const segments = filePath.split("/");
  if (
    segments.length !== 3 ||
    segments[0] !== TASK_HISTORY_ATTACHMENTS_DIRECTORY
  ) {
    throw new Error("编辑输入附件路径无效。");
  }
  try {
    for (const segment of segments) {
      assertSafePathSegment(segment);
    }
  } catch {
    throw new Error("编辑输入附件路径无效。");
  }

  const extensionSeparatorIndex = segments[2].lastIndexOf(".");
  const fileRole = segments[2].slice(0, extensionSeparatorIndex);
  const extension = segments[2].slice(extensionSeparatorIndex + 1);
  if (
    extensionSeparatorIndex <= 0 ||
    (fileRole !== "image" && fileRole !== "mask") ||
    !SUPPORTED_IMAGE_EXTENSIONS.has(extension)
  ) {
    throw new Error("编辑输入附件路径无效。");
  }
  return segments;
}

function isAbsoluteUri(filePath: string): boolean {
  return /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(filePath);
}
