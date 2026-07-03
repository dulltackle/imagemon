import { describe, expect, it } from "vitest";

import {
  ImageTaskExecutionError,
  createFetchImageModelClient,
  type ImageGenerationFetchLike,
} from "./index";

describe("createFetchImageModelClient", () => {
  it("使用移动端 fetch 调用图片生成接口并归一化 base64 图片", async () => {
    const calls: Array<{ url: string; init: Parameters<ImageGenerationFetchLike>[1] }> =
      [];
    const client = createFetchImageModelClient({
      fetch: async (url, init) => {
        calls.push({ url, init });
        return {
          status: 200,
          async json() {
            return { data: [{ b64_json: "aW1hZ2U=" }] };
          },
        };
      },
    });

    const result = await client.generate({
      baseUrl: "https://api.openai.com/v1/",
      apiKey: "sk-test",
      modelName: "gpt-image-2",
      prompt: "一张方图",
      size: "1024x1024",
      quality: "auto",
      format: "png",
      n: 1,
    });

    expect(result).toEqual({
      base64: "aW1hZ2U=",
      width: 1024,
      height: 1024,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.openai.com/v1/images/generations");
    expect(calls[0].init.headers).toMatchObject({
      Accept: "application/json",
      Authorization: "Bearer sk-test",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(calls[0].init.body)).toEqual({
      model: "gpt-image-2",
      prompt: "一张方图",
      size: "1024x1024",
      quality: "auto",
      output_format: "png",
      n: 1,
    });
  });

  it("将鉴权失败映射为安全错误并保留平台错误码", async () => {
    const client = createFetchImageModelClient({
      fetch: async () => ({
        status: 401,
        async json() {
          return { error: { code: "invalid_api_key", message: "secret detail" } };
        },
      }),
    });

    await expect(
      client.generate({
        baseUrl: "https://example.com/v1",
        apiKey: "sk-test",
        modelName: "gpt-image-2",
        prompt: "一张方图",
        size: "1024x1024",
        quality: "auto",
        format: "png",
        n: 1,
      }),
    ).rejects.toMatchObject({
      reason: "unauthorized",
      statusCode: 401,
      providerCode: "invalid_api_key",
    } satisfies Partial<ImageTaskExecutionError>);
  });

  it("响应缺少可保存图片时映射为 invalid_response", async () => {
    const client = createFetchImageModelClient({
      fetch: async () => ({
        status: 200,
        async json() {
          return { data: [{ url: "https://example.com/image.png" }] };
        },
      }),
    });

    await expect(
      client.generate({
        baseUrl: "https://example.com/v1",
        apiKey: "sk-test",
        modelName: "gpt-image-2",
        prompt: "一张方图",
        size: "1024x1024",
        quality: "auto",
        format: "png",
        n: 1,
      }),
    ).rejects.toMatchObject({
      reason: "invalid_response",
    } satisfies Partial<ImageTaskExecutionError>);
  });

  it("网络异常映射为 network_error", async () => {
    const client = createFetchImageModelClient({
      fetch: async () => {
        throw new TypeError("Failed to fetch");
      },
    });

    await expect(
      client.generate({
        baseUrl: "https://example.com/v1",
        apiKey: "sk-test",
        modelName: "gpt-image-2",
        prompt: "一张方图",
        size: "1024x1024",
        quality: "auto",
        format: "png",
        n: 1,
      }),
    ).rejects.toMatchObject({
      reason: "network_error",
    } satisfies Partial<ImageTaskExecutionError>);
  });
});
