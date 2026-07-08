import { afterEach, describe, expect, it, vi } from "vitest";

import type { FetchLike } from "./test-connection";
import { testModelConnection } from "./test-connection";

const testedAt = "2026-06-25T00:00:00.000Z";

function now() {
  return testedAt;
}

describe("testModelConnection", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("使用规范化 base URL 请求 /models 并发送认证头", async () => {
    const calls: Array<{ url: string; init: Parameters<FetchLike>[1] }> = [];
    const fetch: FetchLike = async (url, init) => {
      calls.push({ url, init });
      return response(200, { data: [{ id: "gpt-5.4-mini" }] });
    };

    const result = await testModelConnection({
      baseUrl: "https://api.openai.com/v1/",
      apiKey: " sk-test ",
      modelName: "gpt-5.4-mini",
      fetch,
      now,
    });

    expect(result).toEqual({ status: "succeeded", testedAt });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      url: "https://api.openai.com/v1/models",
      init: {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: "Bearer sk-test",
        },
      },
    });
  });

  it.each([
    [400],
    [404],
    [418],
  ])("%s 等非鉴权 4xx 按响应无效处理", async (status) => {
    await expect(
      testModelConnection({
        baseUrl: "https://example.com/v1",
        apiKey: "sk-test",
        modelName: "gpt-5.4-mini",
        fetch: async () => response(status, { error: { message: "bad request" } }),
        now,
      }),
    ).resolves.toMatchObject({
      status: "failed",
      failure: {
        reason: "invalid_response",
      },
    });
  });

  it.each([
    [401, "unauthorized"],
    [403, "forbidden"],
    [429, "rate_limited"],
    [500, "server_error"],
    [302, "invalid_response"],
  ])("将 HTTP %s 映射为 %s", async (status, reason) => {
    const result = await testModelConnection({
      baseUrl: "https://example.com/v1",
      apiKey: "sk-test",
      modelName: "gpt-5.4-mini",
      fetch: async () => response(status, { error: { message: "failed" } }),
      now,
    });

    expect(result).toMatchObject({
      status: "failed",
      failure: {
        reason,
        occurredAt: testedAt,
      },
    });
  });

  it("缺少 API Key 时不发起请求", async () => {
    const fetch = vi.fn<FetchLike>();

    const result = await testModelConnection({
      baseUrl: "https://example.com/v1",
      apiKey: " ",
      modelName: "gpt-5.4-mini",
      fetch,
      now,
    });

    expect(fetch).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: "failed",
      failure: {
        reason: "missing_credential",
      },
    });
  });

  it("网络失败映射为 network_error", async () => {
    const result = await testModelConnection({
      baseUrl: "https://example.com/v1",
      apiKey: "sk-test",
      modelName: "gpt-5.4-mini",
      fetch: async () => {
        throw new TypeError("Failed to fetch");
      },
      now,
    });

    expect(result).toMatchObject({
      status: "failed",
      failure: {
        reason: "network_error",
      },
    });
  });

  it("超时映射为 timeout", async () => {
    vi.useFakeTimers();
    const fetch: FetchLike = async (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          const error = new Error("Aborted");
          error.name = "AbortError";
          reject(error);
        });
      });

    const promise = testModelConnection({
      baseUrl: "https://example.com/v1",
      apiKey: "sk-test",
      modelName: "gpt-5.4-mini",
      fetch,
      now,
      timeoutMs: 10,
    });

    await vi.advanceTimersByTimeAsync(10);

    await expect(promise).resolves.toMatchObject({
      status: "failed",
      failure: {
        reason: "timeout",
      },
    });
  });

  it("HTTP 200 但不是模型列表时按响应无效处理", async () => {
    await expect(
      testModelConnection({
        baseUrl: "https://api.tu-zi.com",
        apiKey: "sk-test",
        modelName: "gpt-5.4-mini",
        fetch: async () => ({
          status: 200,
          async json() {
            throw new SyntaxError("Unexpected token '<'");
          },
        }),
        now,
      }),
    ).resolves.toMatchObject({
      status: "failed",
      failure: {
        reason: "invalid_response",
      },
    });
  });

  it("模型列表不包含当前模型名时按模型不存在处理", async () => {
    await expect(
      testModelConnection({
        baseUrl: "https://example.com/v1",
        apiKey: "sk-test",
        modelName: "gpt-5.4-mini",
        fetch: async () => response(200, { data: [{ id: "gpt-5.5" }] }),
        now,
      }),
    ).resolves.toMatchObject({
      status: "failed",
      failure: {
        reason: "model_not_found",
        message: "模型服务返回的模型列表不包含 “gpt-5.4-mini”。",
      },
    });
  });
});

function response(status: number, body: unknown) {
  return {
    status,
    async json() {
      return body;
    },
  };
}
