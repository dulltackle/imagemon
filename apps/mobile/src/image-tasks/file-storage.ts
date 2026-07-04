import type { ImageResultFormat } from "./types";

export interface ImageResultFileStorage {
  saveImageResultFile(input: SaveImageResultFileInput): Promise<SavedImageResultFile>;
  resolveFileUri(filePath: string): Promise<string>;
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

const IMAGE_RESULTS_DIRECTORY = "image-results";

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
    throw new Error("图片结果路径片段无效。");
  }
}

function createImageResultFileName(
  imageResultId: string,
  format: ImageResultFormat,
): string {
  assertSafePathSegment(imageResultId);
  return `${imageResultId}.${format}`;
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

function isAbsoluteUri(filePath: string): boolean {
  return /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(filePath);
}
