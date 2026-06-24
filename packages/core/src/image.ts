export const DEFAULT_IMAGE_MODEL = "gpt-image-2" as const;

export const GPT_IMAGE_2_UNIQUE_SIZES = Object.freeze([
  "2048x2048",
  "2048x1152",
  "3840x2160",
  "2160x3840",
] as const);

const COMMON_IMAGE_PRESET_SIZES = Object.freeze(["auto", "1024x1024", "1536x1024", "1024x1536"] as const);
const GPT_IMAGE_2_MODELS = new Set<string>([DEFAULT_IMAGE_MODEL, "gpt-image-2-2026-04-21"]);
const GPT_IMAGE_2_PRESET_SIZES: readonly ImageSize[] = Object.freeze([
  ...COMMON_IMAGE_PRESET_SIZES,
  ...GPT_IMAGE_2_UNIQUE_SIZES,
]);
const STANDARD_IMAGE_SIZES = new Set<ImageSize>(COMMON_IMAGE_PRESET_SIZES);

export type GptImage2UniqueSize = (typeof GPT_IMAGE_2_UNIQUE_SIZES)[number];
export type ImageModel =
  | "gpt-image-1"
  | "gpt-image-1-mini"
  | "gpt-image-1.5"
  | typeof DEFAULT_IMAGE_MODEL
  | "gpt-image-2-2026-04-21"
  | "gpt-image-3"
  | (string & {});
export type ImageSize = (typeof COMMON_IMAGE_PRESET_SIZES)[number] | GptImage2UniqueSize | (string & {});
export type ImageQuality = "auto" | "low" | "medium" | "high";
export type ImageOutputFormat = "png" | "jpeg" | "webp";
export type ImageBackground = "auto" | "transparent" | "opaque";
export type ImageInputFidelity = "low" | "high";
export type ImageTaskType = "generate" | "edit";

export interface ImageSpec {
  size?: ImageSize;
  quality?: ImageQuality;
  n?: number;
  output_format?: ImageOutputFormat;
  output_compression?: number;
  background?: ImageBackground;
  input_fidelity?: ImageInputFidelity;
}

export interface CommonImageValidationOptions {
  model?: ImageModel;
  prompt: string;
  size?: ImageSize;
  quality?: ImageQuality;
  n?: number;
  output_format?: ImageOutputFormat;
  output_compression?: number;
  background?: ImageBackground;
  stream?: boolean;
  partial_images?: number;
  user?: string;
}

export interface GenerateImageValidationOptions extends CommonImageValidationOptions {
  moderation?: string;
}

export interface EditImageValidationOptions extends CommonImageValidationOptions {
  image?: unknown | unknown[];
  input_fidelity?: ImageInputFidelity;
}

interface ImageModelCapabilities {
  transparentBackground: boolean;
  inputFidelity: boolean;
  customSize: boolean;
}

const IMAGE_MODEL_CAPABILITIES: Readonly<Record<string, ImageModelCapabilities>> = {
  "gpt-image-1": {
    transparentBackground: true,
    inputFidelity: true,
    customSize: false,
  },
  "gpt-image-1-mini": {
    transparentBackground: true,
    inputFidelity: false,
    customSize: false,
  },
  "gpt-image-1.5": {
    transparentBackground: true,
    inputFidelity: true,
    customSize: false,
  },
  [DEFAULT_IMAGE_MODEL]: {
    transparentBackground: false,
    inputFidelity: true,
    customSize: true,
  },
  "gpt-image-2-2026-04-21": {
    transparentBackground: false,
    inputFidelity: true,
    customSize: true,
  },
  "gpt-image-3": {
    transparentBackground: true,
    inputFidelity: true,
    customSize: true,
  },
};

export function getImageModelPresetSizes(model?: ImageModel): readonly ImageSize[] | undefined {
  const resolvedModel = getModel(model);
  if (!IMAGE_MODEL_CAPABILITIES[resolvedModel]) {
    return undefined;
  }

  return GPT_IMAGE_2_MODELS.has(resolvedModel) ? GPT_IMAGE_2_PRESET_SIZES : COMMON_IMAGE_PRESET_SIZES;
}

export function validateGenerateImageOptions(options: GenerateImageValidationOptions): void {
  validatePrompt(options.prompt);
  validateImageSpecForModel(options, "generate", options.model);
}

export function validateEditImageOptions(options: EditImageValidationOptions): void {
  validatePrompt(options.prompt);
  validateImageSpecForModel(options, "edit", options.model);

  if (Array.isArray(options.image) && options.image.length === 0) {
    throw new Error("image must contain at least one input image");
  }
}

export function validateImageSpec(spec: ImageSpec): void {
  validateCommonSpec(spec);
}

export function validateImageSpecForModel(spec: ImageSpec, taskType: ImageTaskType, model?: ImageModel): void {
  validateImageSpec(spec);
  validateModelCapabilities(spec, model);

  if (taskType !== "edit") {
    return;
  }

  const capabilities = getModelCapabilities(model);
  if (spec.input_fidelity !== undefined && capabilities && !capabilities.inputFidelity) {
    throw new Error(`model ${getModel(model)} does not support input_fidelity`);
  }
}

function validatePrompt(prompt: string): void {
  if (!prompt || prompt.trim().length === 0) {
    throw new Error("prompt is required");
  }
}

function validateCommonSpec(spec: ImageSpec): void {
  if (spec.n !== undefined && (!Number.isInteger(spec.n) || spec.n < 1 || spec.n > 10)) {
    throw new Error("n must be an integer between 1 and 10");
  }

  const partialImages = (spec as ImageSpec & { partial_images?: number }).partial_images;
  if (
    partialImages !== undefined &&
    (!Number.isInteger(partialImages) || partialImages < 0 || partialImages > 3)
  ) {
    throw new Error("partial_images must be an integer between 0 and 3");
  }

  if (
    spec.output_compression !== undefined &&
    (!Number.isInteger(spec.output_compression) || spec.output_compression < 0 || spec.output_compression > 100)
  ) {
    throw new Error("output_compression must be an integer between 0 and 100");
  }

  if (spec.background === "transparent" && spec.output_format === "jpeg") {
    throw new Error('transparent background requires output_format "png" or "webp"');
  }
}

function validateModelCapabilities(spec: ImageSpec, model: ImageModel | undefined): void {
  const capabilities = getModelCapabilities(model);
  if (!capabilities) {
    return;
  }

  if (spec.background === "transparent" && !capabilities.transparentBackground) {
    throw new Error(`model ${getModel(model)} does not support transparent background`);
  }

  if (spec.size !== undefined && isCustomSize(spec.size)) {
    if (!capabilities.customSize) {
      throw new Error(`model ${getModel(model)} does not support custom size`);
    }
    validateSize(spec.size);
  }
}

function getModelCapabilities(model: ImageModel | undefined): ImageModelCapabilities | undefined {
  return IMAGE_MODEL_CAPABILITIES[getModel(model)];
}

function getModel(model: ImageModel | undefined): string {
  return model ?? DEFAULT_IMAGE_MODEL;
}

function isCustomSize(size: ImageSize): boolean {
  return !STANDARD_IMAGE_SIZES.has(size);
}

function validateSize(size: ImageSize): void {
  const match = /^(\d+)x(\d+)$/.exec(size);
  if (!match) {
    throw new Error('size must be "auto", a standard size, or a WIDTHxHEIGHT string');
  }

  const width = Number(match[1]);
  const height = Number(match[2]);
  if (width % 16 !== 0 || height % 16 !== 0) {
    throw new Error("custom size width and height must both be divisible by 16");
  }

  if (width > 3840 || height > 3840) {
    throw new Error("custom size width and height must not exceed 3840px");
  }

  const ratio = width / height;
  if (ratio < 1 / 3 || ratio > 3) {
    throw new Error("custom size aspect ratio must be between 1:3 and 3:1");
  }

  const pixels = width * height;
  if (pixels < 655_360 || pixels > 8_294_400) {
    throw new Error("custom size total pixels must be between 655,360 and 8,294,400");
  }
}
