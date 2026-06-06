#!/usr/bin/env node
import { createReadStream } from "node:fs";
import { basename, resolve } from "node:path";
import { toFile, type Uploadable } from "openai";
import { editImage, generateImage } from "./lib/image.js";
import { prepareImageOutputDirectory, saveImageResult } from "./lib/image-output.js";
import type {
  EditImageOptions,
  GenerateImageOptions,
  ImageClientOptions,
  ImageOutputFormat,
  ImageQuality,
  ImageResult,
  ImageSize,
} from "./lib/image.types.js";

const DEFAULT_OUT_DIR = "outputs";
const OUTPUT_FORMATS = new Set<ImageOutputFormat>(["png", "jpeg", "webp"]);
const ALLOWED_OPTIONS = new Set([
  "prompt",
  "model",
  "size",
  "quality",
  "out",
  "format",
  "n",
  "image",
  "mask",
  "api-key",
  "base-url",
  "config",
  "json",
]);

type CliGenerateOptions = GenerateImageOptions & { stream?: false | null | undefined };
type CliEditOptions = EditImageOptions & { stream?: false | null | undefined };

interface CliStreams {
  stdout: Pick<NodeJS.WriteStream, "write">;
  stderr: Pick<NodeJS.WriteStream, "write">;
}

export interface RunImagemonCliOptions {
  fetch?: typeof fetch;
  streams?: CliStreams;
  now?: Date;
}

interface ParsedArgs {
  command: "generate" | "edit";
  prompt: string;
  model?: string;
  size?: ImageSize;
  quality?: ImageQuality;
  outDir: string;
  outputFormat?: ImageOutputFormat;
  n?: number;
  imagePath?: string;
  maskPath?: string;
  apiKey?: string;
  baseURL?: string;
  configPath?: string;
}

interface CliSuccess {
  ok: true;
  files: string[];
  metadataPath: string;
  usage?: unknown;
}

interface CliFailure {
  ok: false;
  files: [];
  metadataPath: null;
  error: {
    message: string;
  };
}

export async function runImagemonCli(argv: string[], options: RunImagemonCliOptions = {}): Promise<number> {
  const streams = options.streams ?? { stdout: process.stdout, stderr: process.stderr };

  try {
    const parsed = parseArgs(argv);
    const outDir = await prepareImageOutputDirectory(parsed.outDir);
    const clientOptions: ImageClientOptions = {
      apiKey: parsed.apiKey,
      baseURL: parsed.baseURL,
      configPath: parsed.configPath,
      fetch: options.fetch,
    };

    let result: ImageResult;
    if (parsed.command === "generate") {
      result = await generateImage(buildGenerateOptions(parsed), clientOptions);
    } else {
      result = await editImage(await buildEditOptions(parsed), clientOptions);
    }

    const saved = await saveImageResult(result, {
      outDir,
      outputFormat: parsed.outputFormat,
      createdAt: options.now,
      request: {
        command: parsed.command,
        model: parsed.model ?? "gpt-image-2",
        prompt: parsed.prompt,
        size: parsed.size,
        quality: parsed.quality,
        output_format: parsed.outputFormat,
        n: parsed.n,
        image: parsed.imagePath ? resolve(parsed.imagePath) : undefined,
        mask: parsed.maskPath ? resolve(parsed.maskPath) : undefined,
      },
    });

    writeJson(streams.stdout, {
      ok: true,
      files: saved.files,
      metadataPath: saved.metadataPath,
      usage: saved.metadata.result.usage,
    } satisfies CliSuccess);
    return 0;
  } catch (error) {
    writeJson(streams.stdout, {
      ok: false,
      files: [],
      metadataPath: null,
      error: {
        message: error instanceof Error ? error.message : String(error),
      },
    } satisfies CliFailure);
    return 1;
  }
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command, ...rest] = argv;
  if (command !== "generate" && command !== "edit") {
    throw new Error("Usage: imagemon <generate|edit> --prompt <text> [options]");
  }

  const values = readOptions(rest);
  const prompt = getRequiredString(values, "prompt");
  const outDir = getString(values, "out") ?? DEFAULT_OUT_DIR;
  const outputFormat = parseOutputFormat(getString(values, "format"));

  const parsed: ParsedArgs = {
    command,
    prompt,
    model: getString(values, "model"),
    size: getString(values, "size") as ImageSize | undefined,
    quality: getString(values, "quality") as ImageQuality | undefined,
    outDir,
    outputFormat,
    n: parseIntegerOption(values, "n"),
    imagePath: getString(values, "image"),
    maskPath: getString(values, "mask"),
    apiKey: getString(values, "api-key"),
    baseURL: getString(values, "base-url"),
    configPath: getString(values, "config"),
  };

  if (parsed.command === "edit" && !parsed.imagePath) {
    throw new Error("--image is required for edit");
  }

  return parsed;
}

function readOptions(args: string[]): Map<string, string | true> {
  const values = new Map<string, string | true>();

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected argument: ${arg}`);
    }

    const withoutPrefix = arg.slice(2);
    const equalIndex = withoutPrefix.indexOf("=");
    if (equalIndex >= 0) {
      const name = withoutPrefix.slice(0, equalIndex);
      assertKnownOption(name);
      values.set(name, withoutPrefix.slice(equalIndex + 1));
      continue;
    }

    assertKnownOption(withoutPrefix);
    if (withoutPrefix === "json") {
      values.set(withoutPrefix, true);
      continue;
    }

    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for --${withoutPrefix}`);
    }

    values.set(withoutPrefix, value);
    index += 1;
  }

  return values;
}

function assertKnownOption(name: string): void {
  if (!ALLOWED_OPTIONS.has(name)) {
    throw new Error(`Unknown option: --${name}`);
  }
}

function buildGenerateOptions(parsed: ParsedArgs): CliGenerateOptions {
  return stripUndefined({
    model: parsed.model,
    prompt: parsed.prompt,
    size: parsed.size,
    quality: parsed.quality,
    output_format: parsed.outputFormat,
    n: parsed.n,
  });
}

async function buildEditOptions(parsed: ParsedArgs): Promise<CliEditOptions> {
  if (!parsed.imagePath) {
    throw new Error("--image is required for edit");
  }

  const image = await uploadableFromPath(parsed.imagePath);
  const mask = parsed.maskPath ? await uploadableFromPath(parsed.maskPath) : undefined;

  return stripUndefined({
    model: parsed.model,
    image,
    mask,
    prompt: parsed.prompt,
    size: parsed.size,
    quality: parsed.quality,
    output_format: parsed.outputFormat,
    n: parsed.n,
  });
}

async function uploadableFromPath(path: string): Promise<Uploadable> {
  return toFile(createReadStream(path), basename(path));
}

function parseOutputFormat(value: string | undefined): ImageOutputFormat | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!OUTPUT_FORMATS.has(value as ImageOutputFormat)) {
    throw new Error('--format must be one of "png", "jpeg", or "webp"');
  }

  return value as ImageOutputFormat;
}

function parseIntegerOption(values: Map<string, string | true>, name: string): number | undefined {
  const value = getString(values, name);
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new Error(`--${name} must be an integer`);
  }

  return parsed;
}

function getRequiredString(values: Map<string, string | true>, name: string): string {
  const value = getString(values, name);
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`--${name} is required`);
  }

  return value;
}

function getString(values: Map<string, string | true>, name: string): string | undefined {
  const value = values.get(name);
  if (value === undefined || value === true) {
    return undefined;
  }

  return value;
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

function writeJson(stream: Pick<NodeJS.WriteStream, "write">, value: CliSuccess | CliFailure): void {
  stream.write(`${JSON.stringify(value)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runImagemonCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
