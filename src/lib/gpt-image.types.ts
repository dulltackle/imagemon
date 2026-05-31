import type { Uploadable } from "openai";

export type GptImageModel = "gpt-image-2" | "gpt-image-3" | (string & {});

export type GptImageSize =
  | "auto"
  | "1024x1024"
  | "1536x1024"
  | "1024x1536"
  | "2048x2048"
  | "2048x1152"
  | "3840x2160"
  | "2160x3840"
  | (string & {});

export type GptImageQuality = "auto" | "low" | "medium" | "high";
export type GptImageOutputFormat = "png" | "jpeg" | "webp";
export type GptImageBackground = "auto" | "opaque";
export type GptImageModeration = "auto" | "low";

export interface GptImageClientOptions {
  apiKey?: string;
  baseURL?: string;
  timeout?: number;
  maxRetries?: number;
  fetch?: typeof fetch;
}

export interface CommonGptImageOptions {
  model?: GptImageModel;
  prompt: string;
  size?: GptImageSize;
  quality?: GptImageQuality;
  n?: number;
  output_format?: GptImageOutputFormat;
  output_compression?: number;
  background?: GptImageBackground;
  stream?: boolean;
  partial_images?: number;
  user?: string;
}

export interface GenerateGptImageOptions extends CommonGptImageOptions {
  moderation?: GptImageModeration;
}

export interface EditGptImageOptions extends CommonGptImageOptions {
  image: Uploadable | Uploadable[];
  mask?: Uploadable;
}

export interface GptImageImage {
  b64_json: string;
}

export interface GptImageUsage {
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

export interface GptImageResult {
  created: number;
  images: GptImageImage[];
  usage?: GptImageUsage;
  size?: string;
  quality?: string;
  output_format?: string;
  background?: string;
}

export type GptImageStreamEvent =
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
      usage?: GptImageUsage;
      size?: string;
      quality?: string;
      output_format?: string;
      background?: string;
    };
