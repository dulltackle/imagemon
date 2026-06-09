import type { Uploadable } from "openai";
import type {
  ImageEditParams,
  ImageGenerateParams,
  ImageModel as OpenAIImageModel,
} from "openai/resources/images";

export type ImageModel = OpenAIImageModel | "gpt-image-3" | (string & {});

export const GPT_IMAGE_2_UNIQUE_SIZES = Object.freeze([
  "2048x2048",
  "2048x1152",
  "3840x2160",
  "2160x3840",
] as const);

export type GptImage2UniqueSize = (typeof GPT_IMAGE_2_UNIQUE_SIZES)[number];

export type ImageSize =
  | NonNullable<ImageGenerateParams["size"]>
  | GptImage2UniqueSize
  | (string & {});

export type ImageQuality = Exclude<NonNullable<ImageGenerateParams["quality"]>, "standard" | "hd">;
export type ImageOutputFormat = NonNullable<ImageGenerateParams["output_format"]>;
export type ImageBackground = NonNullable<ImageGenerateParams["background"]>;
export type ImageModeration = NonNullable<ImageGenerateParams["moderation"]>;
export type ImageInputFidelity = NonNullable<ImageEditParams["input_fidelity"]>;

export interface ImageClientOptions {
  apiKey?: string;
  baseURL?: string;
  configPath?: string;
  timeout?: number;
  maxRetries?: number;
  fetch?: typeof fetch;
}

export interface CommonImageOptions {
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
