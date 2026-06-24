import type { Uploadable } from "openai";
import type { ImageGenerateParams } from "openai/resources/images";
import type { CommonImageValidationOptions, ImageInputFidelity } from "@imagemon/core";

export { DEFAULT_IMAGE_MODEL, GPT_IMAGE_2_UNIQUE_SIZES } from "@imagemon/core";
export type {
  GptImage2UniqueSize,
  ImageBackground,
  ImageInputFidelity,
  ImageModel,
  ImageOutputFormat,
  ImageQuality,
  ImageSize,
} from "@imagemon/core";

export type ImageModeration = NonNullable<ImageGenerateParams["moderation"]>;

export interface ImageClientOptions {
  apiKey?: string;
  baseURL?: string;
  configPath?: string;
  timeout?: number;
  maxRetries?: number;
  fetch?: typeof fetch;
}

export interface CommonImageOptions extends CommonImageValidationOptions {}

export interface GenerateImageOptions extends CommonImageOptions {
  moderation?: ImageModeration;
}

export interface EditImageOptions extends CommonImageOptions {
  image: Uploadable | Uploadable[];
  mask?: Uploadable;
  input_fidelity?: ImageInputFidelity;
}

export interface ImageImage {
  b64_json?: string;
  url?: string;
}

export interface ImageUsage {
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  input_tokens_details?: {
    text_tokens?: number;
    image_tokens?: number;
  };
  output_tokens_details?: {
    text_tokens?: number;
    image_tokens?: number;
  };
}

export interface ImageResult {
  created: number;
  images: ImageImage[];
  usage?: ImageUsage;
  size?: string;
  quality?: string;
  output_format?: string;
  background?: string;
}

export type ImageStreamEvent =
  | {
      type: "image_generation.partial_image" | "image_edit.partial_image";
      b64_json: string;
      created_at: number;
      partial_image_index: number;
      size?: string;
      quality?: string;
      output_format?: string;
      background?: string;
    }
  | {
      type: "image_generation.completed" | "image_edit.completed";
      b64_json: string;
      created_at: number;
      usage?: ImageUsage;
      size?: string;
      quality?: string;
      output_format?: string;
      background?: string;
    };
