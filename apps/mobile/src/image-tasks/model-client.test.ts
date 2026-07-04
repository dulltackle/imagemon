import { describe, expect, it, vi } from "vitest";

import {
  ImageTaskExecutionError,
  createFetchImageModelClient,
  type ImageDownloadFetchLike,
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

  it("将普通 4xx 服务端拒绝映射为 invalid_request 并保留状态码和平台码", async () => {
    const client = createFetchImageModelClient({
      fetch: async () => ({
        status: 422,
        async json() {
          return { error: { code: "invalid_size", message: "secret detail" } };
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
      reason: "invalid_request",
      statusCode: 422,
      providerCode: "invalid_size",
    } satisfies Partial<ImageTaskExecutionError>);
  });

  it("将内容安全平台码映射为 content_rejected", async () => {
    const client = createFetchImageModelClient({
      fetch: async () => ({
        status: 400,
        async json() {
          return { error: { code: "content_policy_violation" } };
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
      reason: "content_rejected",
      statusCode: 400,
      providerCode: "content_policy_violation",
    } satisfies Partial<ImageTaskExecutionError>);
  });

  it("平台错误码分类不使用宽泛子串误判", async () => {
    for (const providerCode of [
      "generate_limit_exceeded",
      "author_not_found",
      "content_type_invalid",
    ]) {
      const client = createFetchImageModelClient({
        fetch: async () => ({
          status: 400,
          async json() {
            return { error: { code: providerCode } };
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
        reason: "invalid_request",
        statusCode: 400,
        providerCode,
      } satisfies Partial<ImageTaskExecutionError>);
    }
  });

  it("瞬时 5xx 失败自动重试并在成功后返回结果", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const client = createFetchImageModelClient({
      fetch: async () => {
        calls += 1;
        if (calls === 1) {
          return {
            status: 503,
            async json() {
              return { error: { code: "upstream_error" } };
            },
          };
        }
        return {
          status: 200,
          async json() {
            return { data: [{ b64_json: "aW1hZ2U=" }] };
          },
        };
      },
    });

    try {
      const generation = client.generate({
        baseUrl: "https://example.com/v1",
        apiKey: "sk-test",
        modelName: "gpt-image-2",
        prompt: "一张方图",
        size: "1024x1024",
        quality: "auto",
        format: "png",
        n: 1,
      });
      const assertion = expect(generation).resolves.toEqual({
        base64: "aW1hZ2U=",
        width: 1024,
        height: 1024,
      });

      await vi.advanceTimersByTimeAsync(500);
      await assertion;
      expect(calls).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("瞬时失败重试次数用尽后映射为 server_error 并保留状态码与平台码", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const client = createFetchImageModelClient({
      fetch: async () => {
        calls += 1;
        return {
          status: 503,
          async json() {
            return { error: { code: "upstream_saturated" } };
          },
        };
      },
    });

    try {
      const generation = client.generate({
        baseUrl: "https://example.com/v1",
        apiKey: "sk-test",
        modelName: "gpt-image-2",
        prompt: "一张方图",
        size: "1024x1024",
        quality: "auto",
        format: "png",
        n: 1,
      });
      const assertion = expect(generation).rejects.toMatchObject({
        reason: "server_error",
        statusCode: 503,
        providerCode: "upstream_saturated",
      } satisfies Partial<ImageTaskExecutionError>);

      await vi.advanceTimersByTimeAsync(500);
      await vi.advanceTimersByTimeAsync(1000);
      await assertion;
      expect(calls).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("非瞬时 4xx 拒绝不触发重试", async () => {
    let calls = 0;
    const client = createFetchImageModelClient({
      fetch: async () => {
        calls += 1;
        return {
          status: 422,
          async json() {
            return { error: { code: "invalid_size" } };
          },
        };
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
      reason: "invalid_request",
    } satisfies Partial<ImageTaskExecutionError>);
    expect(calls).toBe(1);
  });

  it("响应返回图片 URL 时下载并归一化为二进制图片", async () => {
    const downloadCalls: Array<{
      url: string;
      init: Parameters<ImageDownloadFetchLike>[1];
    }> = [];
    const client = createFetchImageModelClient({
      fetch: async () => ({
        status: 200,
        async json() {
          return { data: [{ url: "https://example.com/image.png" }] };
        },
      }),
      downloadFetch: async (url, init) => {
        downloadCalls.push({ url, init });
        return {
          status: 200,
          headers: new Headers({
            "content-length": "3",
            "content-type": "image/png",
          }),
          async arrayBuffer() {
            return new Uint8Array([1, 2, 3]).buffer;
          },
        };
      },
    });

    const result = await client.generate({
      baseUrl: "https://example.com/v1",
      apiKey: "sk-test",
      modelName: "gpt-image-2",
      prompt: "一张方图",
      size: "1024x1024",
      quality: "auto",
      format: "png",
      n: 1,
    });

    expect(result).toEqual({
      bytes: new Uint8Array([1, 2, 3]),
      width: 1024,
      height: 1024,
    });
    expect(downloadCalls).toHaveLength(1);
    expect(downloadCalls[0].url).toBe("https://example.com/image.png");
    expect(downloadCalls[0].init).toMatchObject({
      method: "GET",
      headers: {
        Accept: "image/*",
      },
    });
  });

  it("响应返回 HTTP 图片 URL 时映射为 invalid_response", async () => {
    const downloadFetch = vi.fn<ImageDownloadFetchLike>();
    const client = createFetchImageModelClient({
      fetch: async () => ({
        status: 200,
        async json() {
          return { data: [{ url: "http://example.com/image.png" }] };
        },
      }),
      downloadFetch,
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
    expect(downloadFetch).not.toHaveBeenCalled();
  });

  it("图片 URL 下载响应缺少内容长度时映射为 invalid_response", async () => {
    const client = createFetchImageModelClient({
      fetch: async () => ({
        status: 200,
        async json() {
          return { data: [{ url: "https://example.com/image.png" }] };
        },
      }),
      downloadFetch: async () => ({
        status: 200,
        headers: new Headers({
          "content-type": "image/png",
        }),
        async arrayBuffer() {
          return new Uint8Array([1, 2, 3]).buffer;
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

  it("图片 URL 下载响应不是图片类型时映射为 invalid_response", async () => {
    const client = createFetchImageModelClient({
      fetch: async () => ({
        status: 200,
        async json() {
          return { data: [{ url: "https://example.com/image.txt" }] };
        },
      }),
      downloadFetch: async () => ({
        status: 200,
        headers: new Headers({
          "content-length": "3",
          "content-type": "text/plain",
        }),
        async arrayBuffer() {
          return new Uint8Array([1, 2, 3]).buffer;
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

  it("图片 URL 下载响应过大时映射为 invalid_response 且不读取响应体", async () => {
    const arrayBuffer = vi.fn(async () => new Uint8Array([1, 2, 3]).buffer);
    const client = createFetchImageModelClient({
      fetch: async () => ({
        status: 200,
        async json() {
          return { data: [{ url: "https://example.com/image.png" }] };
        },
      }),
      downloadFetch: async () => ({
        status: 200,
        headers: new Headers({
          "content-length": String(20 * 1024 * 1024 + 1),
          "content-type": "image/png",
        }),
        arrayBuffer,
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
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it("响应缺少可保存图片数据时映射为 invalid_response", async () => {
    const client = createFetchImageModelClient({
      fetch: async () => ({
        status: 200,
        async json() {
          return { data: [{}] };
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

  it("普通 Error 形式的原生网络失败映射为 network_error", async () => {
    const client = createFetchImageModelClient({
      fetch: async () => {
        throw Object.assign(new Error("Network request failed"), {
          code: "ENETUNREACH",
        });
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

  it("原生请求超时错误映射为 timeout", async () => {
    const client = createFetchImageModelClient({
      fetch: async () => {
        throw Object.assign(new Error("The request timed out."), {
          code: "NSURLErrorTimedOut",
        });
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
      reason: "timeout",
    } satisfies Partial<ImageTaskExecutionError>);
  });

  it("AbortError 携带超时特征时映射为 timeout", async () => {
    const client = createFetchImageModelClient({
      fetch: async () => {
        const error = Object.assign(new Error("The request timed out."), {
          code: "NSURLErrorTimedOut",
        });
        error.name = "AbortError";
        throw error;
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
      reason: "timeout",
    } satisfies Partial<ImageTaskExecutionError>);
  });

  it("默认路径中的 AbortError 映射为 network_error", async () => {
    const client = createFetchImageModelClient({
      fetch: async () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        throw error;
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

  it("默认不为图片生成设置应用侧超时", async () => {
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

    await client.generate({
      baseUrl: "https://example.com/v1",
      apiKey: "sk-test",
      modelName: "gpt-image-2",
      prompt: "一张方图",
      size: "1024x1024",
      quality: "auto",
      format: "png",
      n: 1,
    });

    expect(calls[0].init.signal).toBeUndefined();
  });

  it("显式生成超时映射为 timeout", async () => {
    vi.useFakeTimers();
    const client = createFetchImageModelClient({
      timeoutMs: 10,
      fetch: async (_url, init) =>
        await new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        }),
    });

    try {
      const generation = client.generate({
        baseUrl: "https://example.com/v1",
        apiKey: "sk-test",
        modelName: "gpt-image-2",
        prompt: "一张方图",
        size: "1024x1024",
        quality: "auto",
        format: "png",
        n: 1,
      });
      const assertion = expect(generation).rejects.toMatchObject({
        reason: "timeout",
      } satisfies Partial<ImageTaskExecutionError>);

      await vi.advanceTimersByTimeAsync(10);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});
