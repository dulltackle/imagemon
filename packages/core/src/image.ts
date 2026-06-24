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
  validateCommonOptions(options);
  validateModelCapabilities(options);
}

export function validateEditImageOptions(options: EditImageValidationOptions): void {
  validateCommonOptions(options);
  validateModelCapabilities(options);

  if (Array.isArray(options.image) && options.image.length === 0) {
    throw new Error("image must contain at least one input image");
  }

  const capabilities = getModelCapabilities(options.model);
  if (options.input_fidelity !== undefined && capabilities && !capabilities.inputFidelity) {
    throw new Error(`model ${getModel(options.model)} does not support input_fidelity`);
  }
}

function validateCommonOptions(options: CommonImageValidationOptions): void {
  if (!options.prompt || options.prompt.trim().length === 0) {
    throw new Error("prompt is required");
  }

  if (options.n !== undefined && (!Number.isInteger(options.n) || options.n < 1 || options.n > 10)) {
    throw new Error("n must be an integer between 1 and 10");
  }

  if (
    options.partial_images !== undefined &&
    (!Number.isInteger(options.partial_images) || options.partial_images < 0 || options.partial_images > 3)
  ) {
    throw new Error("partial_images must be an integer between 0 and 3");
  }

  if (
    options.output_compression !== undefined &&
    (!Number.isInteger(options.output_compression) ||
      options.output_compression < 0 ||
      options.output_compression > 100)
  ) {
    throw new Error("output_compression must be an integer between 0 and 100");
  }

  if (options.background === "transparent" && options.output_format === "jpeg") {
    throw new Error('transparent background requires output_format "png" or "webp"');
  }
}

function validateModelCapabilities(options: CommonImageValidationOptions): void {
  const capabilities = getModelCapabilities(options.model);
  if (!capabilities) {
    return;
  }

  if (options.background === "transparent" && !capabilities.transparentBackground) {
    throw new Error(`model ${getModel(options.model)} does not support transparent background`);
  }

  if (options.size !== undefined && isCustomSize(options.size)) {
    if (!capabilities.customSize) {
      throw new Error(`model ${getModel(options.model)} does not support custom size`);
    }
    validateSize(options.size);
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
