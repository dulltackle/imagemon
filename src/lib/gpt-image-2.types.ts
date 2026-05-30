import type { Uploadable } from "openai";

export type GptImage2Size =
  | "auto"
  | "1024x1024"
  | "1536x1024"
  | "1024x1536"
  | "2048x2048"
  | "2048x1152"
  | "3840x2160"
  | "2160x3840"
  | (string & {});

export type GptImage2Quality = "auto" | "low" | "medium" | "high";
export type GptImage2OutputFormat = "png" | "jpeg" | "webp";
export type GptImage2Background = "auto" | "opaque";
export type GptImage2Moderation = "auto" | "low";

export interface GptImage2ClientOptions {
  apiKey?: string;
  baseURL?: string;
  timeout?: number;
  maxRetries?: number;
  fetch?: typeof fetch;
}

export interface CommonGptImage2Options {
  prompt: string;
  size?: GptImage2Size;
  quality?: GptImage2Quality;
  n?: number;
  output_format?: GptImage2OutputFormat;
  output_compression?: number;
  background?: GptImage2Background;
  stream?: boolean;
  partial_images?: number;
  user?: string;
}

export interface GenerateGptImage2Options extends CommonGptImage2Options {
  moderation?: GptImage2Moderation;
}

export interface EditGptImage2Options extends CommonGptImage2Options {
  image: Uploadable | Uploadable[];
  mask?: Uploadable;
}

export interface GptImage2Image {
  b64_json: string;
}

export interface GptImage2Usage {
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

export interface GptImage2Result {
  created: number;
  images: GptImage2Image[];
  usage?: GptImage2Usage;
  size?: string;
  quality?: string;
  output_format?: string;
  background?: string;
}

export type GptImage2StreamEvent =
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
      usage?: GptImage2Usage;
      size?: string;
      quality?: string;
      output_format?: string;
      background?: string;
    };
