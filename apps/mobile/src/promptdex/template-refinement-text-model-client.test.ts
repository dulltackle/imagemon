import { describe, expect, it } from "vitest";

import {
  TemplateRefinementTextModelClientError,
  createFetchTemplateRefinementTextModelClient,
  type TemplateRefinementTextModelFetchLike,
} from "./template-refinement-text-model-client";

describe("TemplateRefinementTextModelClient", () => {
  it("调用 Chat Completions 并要求 JSON 对象输出", async () => {
    const calls: Array<{
      url: string;
      init: Parameters<TemplateRefinementTextModelFetchLike>[1];
    }> = [];
    const content = JSON.stringify({
      template: {
        name: "refined-template",
      },
    });
    const client = createFetchTemplateRefinementTextModelClient({
      fetch: async (url, init) => {
        calls.push({ url, init });
        return {
          status: 200,
          async json() {
            return {
              choices: [
                {
                  message: {
                    role: "assistant",
                    content,
                  },
                },
              ],
            };
          },
        };
      },
    });

    await expect(
      client.generateProposalJson({
        baseUrl: "https://api.example.com/v1/",
        apiKey: "sk-test",
        modelName: "gpt-5-mini",
        externalPrompt: "完整外部提示词",
        plannedUse: "生成可复用海报模板",
      }),
    ).resolves.toEqual(JSON.parse(content));

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.example.com/v1/chat/completions");
    expect(calls[0].init.headers).toMatchObject({
      Accept: "application/json",
      Authorization: "Bearer sk-test",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(calls[0].init.body)).toMatchObject({
      model: "gpt-5-mini",
      messages: [
        {
          role: "system",
        },
        {
          role: "user",
          content: expect.stringContaining("完整外部提示词"),
        },
      ],
      response_format: { type: "json_object" },
    });
    expect(JSON.parse(calls[0].init.body).messages[1].content).toContain(
      "生成可复用海报模板",
    );
  });

  it("401 和 403 鉴权失败映射为 unauthorized", async () => {
    for (const status of [401, 403]) {
      const client = createFetchTemplateRefinementTextModelClient({
        fetch: async () => ({
          status,
          async json() {
            return { error: { code: "invalid_api_key", message: "secret" } };
          },
        }),
      });

      await expect(client.generateProposalJson(input())).rejects.toMatchObject({
        reason: "unauthorized",
        statusCode: status,
        providerCode: "invalid_api_key",
      } satisfies Partial<TemplateRefinementTextModelClientError>);
    }
  });

  it("429 限流映射为 rate_limited", async () => {
    const client = createFetchTemplateRefinementTextModelClient({
      fetch: async () => ({
        status: 429,
        async json() {
          return { error: { code: "rate_limit_exceeded" } };
        },
      }),
    });

    await expect(client.generateProposalJson(input())).rejects.toMatchObject({
      reason: "rate_limited",
      statusCode: 429,
      providerCode: "rate_limit_exceeded",
    } satisfies Partial<TemplateRefinementTextModelClientError>);
  });

  it("5xx 服务端错误映射为 server_error 且不自动重试", async () => {
    let calls = 0;
    const client = createFetchTemplateRefinementTextModelClient({
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

    await expect(client.generateProposalJson(input())).rejects.toMatchObject({
      reason: "server_error",
      statusCode: 503,
      providerCode: "upstream_saturated",
    } satisfies Partial<TemplateRefinementTextModelClientError>);
    expect(calls).toBe(1);
  });

  it("网络失败映射为 network_error", async () => {
    const client = createFetchTemplateRefinementTextModelClient({
      fetch: async () => {
        throw new TypeError("Failed to fetch");
      },
    });

    await expect(client.generateProposalJson(input())).rejects.toMatchObject({
      reason: "network_error",
    } satisfies Partial<TemplateRefinementTextModelClientError>);
  });

  it("2xx 非 JSON 对象输出映射为 invalid_response", async () => {
    const client = createFetchTemplateRefinementTextModelClient({
      fetch: async () => ({
        status: 200,
        async json() {
          return {
            choices: [
              {
                message: {
                  content: "这不是 JSON",
                },
              },
            ],
          };
        },
      }),
    });

    await expect(client.generateProposalJson(input())).rejects.toMatchObject({
      reason: "invalid_response",
      statusCode: 200,
    } satisfies Partial<TemplateRefinementTextModelClientError>);
  });
});

function input() {
  return {
    baseUrl: "https://api.example.com/v1",
    apiKey: "sk-test",
    modelName: "gpt-5-mini",
    externalPrompt: "完整外部提示词",
    plannedUse: "生成可复用海报模板",
  };
}
