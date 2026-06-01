import { Buffer } from "node:buffer";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { GptImageOutputFormat, GptImageResult, GptImageUsage } from "./gpt-image.types.js";

const DEFAULT_OUTPUT_DIR = "outputs";
const DEFAULT_OUTPUT_FORMAT: GptImageOutputFormat = "png";
const OUTPUT_FORMATS = new Set<GptImageOutputFormat>(["png", "jpeg", "webp"]);

export interface SaveGptImageResultOptions {
  outDir?: string;
  baseName?: string;
  outputFormat?: GptImageOutputFormat;
  createdAt?: Date;
  request?: Record<string, unknown>;
}

export interface SavedGptImageFile {
  index: number;
  path: string;
  format: GptImageOutputFormat;
  bytes: number;
}

export interface SavedGptImageMetadata {
  createdAt: string;
  request: Record<string, unknown>;
  result: {
    created: number;
    size?: string;
    quality?: string;
    output_format: GptImageOutputFormat;
    background?: string;
    usage?: GptImageUsage;
  };
  files: SavedGptImageFile[];
}

export interface SavedGptImageResult {
  files: string[];
  metadataPath: string;
  metadata: SavedGptImageMetadata;
}

export async function saveGptImageResult(
  result: GptImageResult,
  options: SaveGptImageResultOptions = {},
): Promise<SavedGptImageResult> {
  const outDir = await prepareGptImageOutputDirectory(options.outDir ?? DEFAULT_OUTPUT_DIR);

  const createdAt = options.createdAt ?? new Date();
  const baseName = options.baseName ?? timestampFileName(createdAt);
  const outputFormat = normalizeOutputFormat(result.output_format, options.outputFormat);
  const files: SavedGptImageFile[] = [];

  for (const [index, image] of result.images.entries()) {
    const bytes = Buffer.from(image.b64_json, "base64");
    const path = resolve(outDir, `${baseName}-${index}.${outputFormat}`);
    await writeFile(path, bytes);
    files.push({ index, path, format: outputFormat, bytes: bytes.byteLength });
  }

  const metadata: SavedGptImageMetadata = {
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

export async function prepareGptImageOutputDirectory(outDir: string): Promise<string> {
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
  requestedFormat: GptImageOutputFormat | undefined,
): GptImageOutputFormat {
  if (isOutputFormat(responseFormat)) {
    return responseFormat;
  }

  return requestedFormat ?? DEFAULT_OUTPUT_FORMAT;
}

function isOutputFormat(value: string | undefined): value is GptImageOutputFormat {
  return value !== undefined && OUTPUT_FORMATS.has(value as GptImageOutputFormat);
}

function timestampFileName(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-");
}
