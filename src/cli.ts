#!/usr/bin/env node
import { createReadStream } from "node:fs";
import { basename, resolve } from "node:path";
import { toFile, type Uploadable } from "openai";
import { DEFAULT_IMAGE_MODEL, editImage, generateImage } from "./lib/image.js";
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
const CLI_VERSION = "0.1.0";
const CLI_HELP = `Usage: imagemon <generate|edit> --prompt <text> [options]

Commands:
  generate                 Generate an image
  edit                     Edit an image; requires --image

Options:
  --prompt <text>          Image prompt
  --model <name>           Image model
  --size <size>            auto or WIDTHxHEIGHT
  --quality <quality>      auto, low, medium, or high
  --format <format>        png, jpeg, or webp
  --n <integer>            Number of images
  --out <directory>        Output directory
  --image <path>           Input image for edit
  --mask <path>            Mask image for edit
  --api-key <key>          API key
  --base-url <url>         API base URL
  --config <path>          Config file path
  --json                   Compatibility flag; stdout is always JSON
  --help                   Show help
  --version                Show version
`;
const OUTPUT_FORMATS = new Set<ImageOutputFormat>(["png", "jpeg", "webp"]);
const IMAGE_QUALITIES = new Set<ImageQuality>(["auto", "low", "medium", "high"]);
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
    code: CliErrorCode;
    message: string;
  };
}

type CliErrorCode = "INVALID_OPTION" | "EXECUTION_ERROR";

class CliError extends Error {
  constructor(
    readonly code: CliErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CliError";
  }
}

export async function runImagemonCli(argv: string[], options: RunImagemonCliOptions = {}): Promise<number> {
  const streams = options.streams ?? { stdout: process.stdout, stderr: process.stderr };

  try {
    if (writeInformationalOutput(argv, streams.stderr)) {
      return 0;
    }

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
      download: {
        fetch: options.fetch,
      },
      request: {
        command: parsed.command,
        model: parsed.model ?? DEFAULT_IMAGE_MODEL,
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
    const cliError = toCliError(error);
    writeJson(streams.stdout, {
      ok: false,
      files: [],
      metadataPath: null,
      error: {
        code: cliError.code,
        message: cliError.message,
      },
    } satisfies CliFailure);
    return 1;
  }
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command, ...rest] = argv;
  if (command !== "generate" && command !== "edit") {
    throw invalidOption("Usage: imagemon <generate|edit> --prompt <text> [options]");
  }

  const values = readOptions(rest);
  const prompt = getRequiredString(values, "prompt");
  const outDir = getString(values, "out") ?? DEFAULT_OUT_DIR;
  const outputFormat = parseOutputFormat(getString(values, "format"));

  const parsed: ParsedArgs = {
    command,
    prompt,
    model: getString(values, "model"),
    size: parseSize(getString(values, "size")),
    quality: parseQuality(getString(values, "quality")),
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
    throw invalidOption("--image is required for edit");
  }

  return parsed;
}

function readOptions(args: string[]): Map<string, string | true> {
  const values = new Map<string, string | true>();

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      throw invalidOption(`Unexpected argument: ${arg}`);
    }

    const withoutPrefix = arg.slice(2);
    const equalIndex = withoutPrefix.indexOf("=");
    if (equalIndex >= 0) {
      const name = withoutPrefix.slice(0, equalIndex);
      assertKnownOption(name);
      if (name === "json") {
        throw invalidOption("--json does not accept a value");
      }
      setOption(values, name, withoutPrefix.slice(equalIndex + 1));
      continue;
    }

    assertKnownOption(withoutPrefix);
    if (withoutPrefix === "json") {
      setOption(values, withoutPrefix, true);
      continue;
    }

    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw invalidOption(`Missing value for --${withoutPrefix}`);
    }

    setOption(values, withoutPrefix, value);
    index += 1;
  }

  return values;
}

function assertKnownOption(name: string): void {
  if (!ALLOWED_OPTIONS.has(name)) {
    throw invalidOption(`Unknown option: --${name}`);
  }
}

function setOption(values: Map<string, string | true>, name: string, value: string | true): void {
  if (values.has(name)) {
    throw invalidOption(`Duplicate option: --${name}`);
  }

  if (typeof value === "string" && value.trim().length === 0) {
    throw invalidOption(`--${name} must not be empty`);
  }

  values.set(name, value);
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
    throw invalidOption('--format must be one of "png", "jpeg", or "webp"');
  }

  return value as ImageOutputFormat;
}

function parseQuality(value: string | undefined): ImageQuality | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!IMAGE_QUALITIES.has(value as ImageQuality)) {
    throw invalidOption("--quality must be one of auto, low, medium, or high");
  }

  return value as ImageQuality;
}

function parseSize(value: string | undefined): ImageSize | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value !== "auto" && !/^\d+x\d+$/.test(value)) {
    throw invalidOption("--size must be auto or a WIDTHxHEIGHT string");
  }

  return value as ImageSize;
}

function parseIntegerOption(values: Map<string, string | true>, name: string): number | undefined {
  const value = getString(values, name);
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);
  if (!/^-?\d+$/.test(value) || !Number.isInteger(parsed)) {
    throw invalidOption(`--${name} must be an integer`);
  }

  return parsed;
}

function getRequiredString(values: Map<string, string | true>, name: string): string {
  const value = getString(values, name);
  if (value === undefined || value.trim().length === 0) {
    throw invalidOption(`--${name} is required`);
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

function writeInformationalOutput(argv: string[], stderr: Pick<NodeJS.WriteStream, "write">): boolean {
  if (argv.length === 1 && argv[0] === "--version") {
    stderr.write(`imagemon ${CLI_VERSION}\n`);
    return true;
  }

  if (
    (argv.length === 1 && (argv[0] === "--help" || argv[0] === "help")) ||
    (argv.length === 2 && (argv[0] === "generate" || argv[0] === "edit") && argv[1] === "--help")
  ) {
    stderr.write(CLI_HELP);
    return true;
  }

  return false;
}

function invalidOption(message: string): CliError {
  return new CliError("INVALID_OPTION", message);
}

function toCliError(error: unknown): CliError {
  if (error instanceof CliError) {
    return error;
  }

  return new CliError("EXECUTION_ERROR", error instanceof Error ? error.message : String(error));
}

function writeJson(stream: Pick<NodeJS.WriteStream, "write">, value: CliSuccess | CliFailure): void {
  stream.write(`${JSON.stringify(value)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runImagemonCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
