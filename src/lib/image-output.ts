import { Buffer } from "node:buffer";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { downloadImage, type ImageDownloadOptions } from "./image-download.js";
import type { ImageOutputFormat, ImageResult, ImageUsage } from "./image.types.js";

const DEFAULT_OUTPUT_DIR = "outputs";
const DEFAULT_OUTPUT_FORMAT: ImageOutputFormat = "png";
const OUTPUT_FORMATS = new Set<ImageOutputFormat>(["png", "jpeg", "webp"]);

export interface SaveImageResultOptions {
  outDir?: string;
  baseName?: string;
  outputFormat?: ImageOutputFormat;
  createdAt?: Date;
  request?: Record<string, unknown>;
  download?: ImageDownloadOptions;
}

export interface SavedImageFile {
  index: number;
  path: string;
  format: ImageOutputFormat;
  bytes: number;
}

export interface SavedImageMetadata {
  createdAt: string;
  request: Record<string, unknown>;
  result: {
    created: number;
    size?: string;
    quality?: string;
    output_format: ImageOutputFormat;
    background?: string;
    usage?: ImageUsage;
  };
  files: SavedImageFile[];
}

export interface SavedImageResult {
  files: string[];
  metadataPath: string;
  metadata: SavedImageMetadata;
}

export async function saveImageResult(
  result: ImageResult,
  options: SaveImageResultOptions = {},
): Promise<SavedImageResult> {
  const outDir = await prepareImageOutputDirectory(options.outDir ?? DEFAULT_OUTPUT_DIR);

  const createdAt = options.createdAt ?? new Date();
  const baseName = options.baseName ?? timestampFileName(createdAt);
  const outputFormat = normalizeOutputFormat(result.output_format, options.outputFormat);
  const files: SavedImageFile[] = [];

  for (const [index, image] of result.images.entries()) {
    let bytes: Buffer;
    if (image.b64_json) {
      bytes = Buffer.from(image.b64_json, "base64");
    } else if (image.url) {
      bytes = await downloadImage(image.url, options.download);
    } else {
      throw new Error("Image data missing: neither b64_json nor url provided");
    }
    const path = resolve(outDir, `${baseName}-${index}.${outputFormat}`);
    await writeFile(path, bytes);
    files.push({ index, path, format: outputFormat, bytes: bytes.byteLength });
  }

  const metadata: SavedImageMetadata = {
    createdAt: createdAt.toISOString(),
    request: options.request ?? {},
    result: {
      created: result.created,
      size: result.size,
      quality: result.quality,
      output_format: outputFormat,
      background: result.background,
      usage: result.usage,
    },
    files,
  };
  const metadataPath = resolve(outDir, `${baseName}.json`);
  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");

  return {
    files: files.map((file) => file.path),
    metadataPath,
    metadata,
  };
}

export async function prepareImageOutputDirectory(outDir: string): Promise<string> {
  const resolvedOutDir = resolve(outDir);

  try {
    const info = await stat(resolvedOutDir);
    if (!info.isDirectory()) {
      throw new Error(`Output path is not a directory: ${resolvedOutDir}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  await mkdir(resolvedOutDir, { recursive: true });
  return resolvedOutDir;
}

function normalizeOutputFormat(
  responseFormat: string | undefined,
  requestedFormat: ImageOutputFormat | undefined,
): ImageOutputFormat {
  if (isOutputFormat(responseFormat)) {
    return responseFormat;
  }

  return requestedFormat ?? DEFAULT_OUTPUT_FORMAT;
}

function isOutputFormat(value: string | undefined): value is ImageOutputFormat {
  return value !== undefined && OUTPUT_FORMATS.has(value as ImageOutputFormat);
}

function timestampFileName(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-");
}
