import { describe, expect, it } from "vitest";
import { createImageTaskErrorSummary } from "../src/index.js";

describe("图片任务错误摘要核心规则", () => {
  it("按 HTTP 状态和平台错误码归类", () => {
    expect(createImageTaskErrorSummary({ status: 401 }, "2026-06-24T01:02:03.000Z")).toMatchObject({
      category: "auth",
      occurredAt: "2026-06-24T01:02:03.000Z",
      httpStatus: 401,
    });
    expect(createImageTaskErrorSummary({ status: 429, code: "rate_limit_exceeded" }).category).toBe("rate_limit");
    expect(createImageTaskErrorSummary({ status: 503 }).category).toBe("server");
    expect(createImageTaskErrorSummary({ status: 400 }).category).toBe("invalid_request");
    expect(createImageTaskErrorSummary({ error: { code: "content_policy_violation" } }).category).toBe(
      "content_rejected",
    );
  });

  it("只保存非敏感字段", () => {
    const error = Object.assign(new Error("server response includes sk-secret and stack details"), {
      status: 500,
      code: "server_error",
      headers: { authorization: "Bearer sk-secret" },
      response: { body: "完整响应体" },
      stack: "stack with sk-secret",
    });
    const summary = createImageTaskErrorSummary(error, new Date("2026-06-24T01:02:03.000Z"));
    const serialized = JSON.stringify(summary);

    expect(summary).toEqual({
      category: "server",
      message: "模型服务暂时不可用，请稍后重试。",
      occurredAt: "2026-06-24T01:02:03.000Z",
      httpStatus: 500,
      platformCode: "server_error",
    });
    expect(serialized).not.toContain("sk-secret");
    expect(serialized).not.toContain("authorization");
    expect(serialized).not.toContain("完整响应体");
    expect(serialized).not.toContain("stack");
  });
});
