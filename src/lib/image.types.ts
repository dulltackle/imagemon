import type { Uploadable } from "openai";

export type ImageModel = "gpt-image-2" | "gpt-image-3" | (string & {});

export type ImageSize =
  | "auto"
  | "1024x1024"
  | "1536x1024"
  | "1024x1536"
  | "2048x2048"
  | "2048x1152"
  | "3840x2160"
  | "2160x3840"
  | (string & {});

export type ImageQuality = "auto" | "low" | "medium" | "high";
export type ImageOutputFormat = "png" | "jpeg" | "webp";
export type ImageBackground = "auto" | "opaque";
export type ImageModeration = "auto" | "low";

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
