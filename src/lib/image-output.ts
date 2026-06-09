import { Buffer } from "node:buffer";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, open, rename, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { downloadImage, type ImageDownloadOptions } from "./image-download.js";
import type { ImageOutputFormat, ImageResult, ImageUsage } from "./image.types.js";

const DEFAULT_OUTPUT_DIR = "outputs";
const DEFAULT_OUTPUT_FORMAT: ImageOutputFormat = "png";
const GENERATED_BASE_NAME_ATTEMPTS = 5;
const TEMP_DIRECTORY_PREFIX = ".imagemon-";
const RANDOM_SUFFIX_BYTES = 3;
const OUTPUT_FORMATS = new Set<ImageOutputFormat>(["png", "jpeg", "webp"]);

export interface SaveImageResultOptions {
  outDir?: string;
  baseName?: string;
  overwrite?: boolean;
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
  const outputFormat = normalizeOutputFormat(result.output_format, options.outputFormat);

  if (options.baseName !== undefined) {
    try {
      return await writeImageResult(result, outDir, options.baseName, outputFormat, createdAt, options);
    } catch (error) {
      if (isFileExistsError(error) && !options.overwrite) {
        throw outputExistsError(error);
      }
      throw error;
    }
  }

  for (let attempt = 0; attempt < GENERATED_BASE_NAME_ATTEMPTS; attempt += 1) {
    const baseName = generatedBaseName(createdAt);
    try {
      return await writeImageResult(result, outDir, baseName, outputFormat, createdAt, options);
    } catch (error) {
      if (!isFileExistsError(error) || options.overwrite) {
        throw error;
      }
    }
  }

  throw new Error(`Unable to create unique output files after ${GENERATED_BASE_NAME_ATTEMPTS} attempts`);
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

function generatedBaseName(date: Date): string {
  return `${timestampFileName(date)}-${randomBytes(RANDOM_SUFFIX_BYTES).toString("hex")}`;
}

async function writeImageResult(
  result: ImageResult,
  outDir: string,
  baseName: string,
  outputFormat: ImageOutputFormat,
  createdAt: Date,
  options: SaveImageResultOptions,
): Promise<SavedImageResult> {
  const tempDir = await mkdtemp(join(outDir, TEMP_DIRECTORY_PREFIX));
  const files: SavedImageFile[] = [];
  const stagedFiles: StagedFile[] = [];

  try {
    for (const [index, image] of result.images.entries()) {
      const bytes = await imageBytes(image, options.download);
      const path = resolve(outDir, `${baseName}-${index}.${outputFormat}`);
      const tempPath = join(tempDir, `image-${index}.${outputFormat}`);
      await writeFile(tempPath, bytes, { flag: "wx" });
      files.push({ index, path, format: outputFormat, bytes: bytes.byteLength });
      stagedFiles.push({ tempPath, path });
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
    const tempMetadataPath = join(tempDir, "metadata.json");
    await writeFile(tempMetadataPath, `${JSON.stringify(metadata, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    stagedFiles.push({ tempPath: tempMetadataPath, path: metadataPath });

    await commitStagedFiles(stagedFiles, tempDir, options.overwrite ?? false);

    return {
      files: files.map((file) => file.path),
      metadataPath,
      metadata,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function isFileExistsError(error: unknown): error is NodeJS.ErrnoException {
  return (error as NodeJS.ErrnoException).code === "EEXIST";
}

function outputExistsError(error: NodeJS.ErrnoException): Error {
  const path = typeof error.path === "string" ? error.path : "unknown output path";
  return new Error(`Output file already exists: ${path}. Set overwrite: true to replace it.`);
}

interface StagedFile {
  tempPath: string;
  path: string;
}

interface BackupFile {
  backupPath: string;
  path: string;
}

async function imageBytes(
  image: ImageResult["images"][number],
  downloadOptions: ImageDownloadOptions | undefined,
): Promise<Buffer> {
  if (image.b64_json) {
    return Buffer.from(image.b64_json, "base64");
  }
  if (image.url) {
    return await downloadImage(image.url, downloadOptions);
  }
  throw new Error("Image data missing: neither b64_json nor url provided");
}

async function commitStagedFiles(stagedFiles: StagedFile[], tempDir: string, overwrite: boolean): Promise<void> {
  const reservedPaths: string[] = [];
  const backupFiles: BackupFile[] = [];
  const committedPaths: string[] = [];

  try {
    if (overwrite) {
      for (const [index, stagedFile] of stagedFiles.entries()) {
        const backupPath = join(tempDir, `backup-${index}`);
        if (await pathExists(stagedFile.path)) {
          await rename(stagedFile.path, backupPath);
          backupFiles.push({ backupPath, path: stagedFile.path });
        }
      }
    } else {
      for (const stagedFile of stagedFiles) {
        const handle = await open(stagedFile.path, "wx");
        reservedPaths.push(stagedFile.path);
        await handle.close();
      }
    }

    for (const stagedFile of stagedFiles) {
      await rename(stagedFile.tempPath, stagedFile.path);
      committedPaths.push(stagedFile.path);
    }
  } catch (error) {
    const rollbackErrors = await rollbackCommit(committedPaths, reservedPaths, backupFiles);
    if (rollbackErrors.length > 0) {
      throw new Error(
        `Failed to commit image result and rollback incomplete: ${errorMessage(error)}; ${rollbackErrors.join("; ")}`,
        { cause: error },
      );
    }
    if (isFileExistsError(error)) {
      throw error;
    }
    throw new Error(`Failed to commit image result: ${errorMessage(error)}`, { cause: error });
  }
}

async function rollbackCommit(
  committedPaths: string[],
  reservedPaths: string[],
  backupFiles: BackupFile[],
): Promise<string[]> {
  const errors: string[] = [];
  const createdPaths = [...new Set([...committedPaths, ...reservedPaths])];

  for (const path of createdPaths.reverse()) {
    try {
      await rm(path, { force: true });
    } catch (error) {
      errors.push(`failed to remove ${path}: ${errorMessage(error)}`);
    }
  }

  for (const backup of backupFiles.reverse()) {
    try {
      await rename(backup.backupPath, backup.path);
    } catch (error) {
      errors.push(`failed to restore ${backup.path}: ${errorMessage(error)}`);
    }
  }

  return errors;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
