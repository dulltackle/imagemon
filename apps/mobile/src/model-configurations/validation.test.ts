import { describe, expect, it } from "vitest";

import {
  normalizeBaseUrl,
  validateModelConfigurationInput,
} from "./validation";

function validInput() {
  return {
    type: "image" as const,
    name: "默认图片模型",
    baseUrl: "https://api.openai.com/v1",
    modelName: "gpt-image-2",
  };
}

describe("validateModelConfigurationInput", () => {
  it("接受基础合法配置", () => {
    expect(validateModelConfigurationInput(validInput())).toEqual([]);
  });

  it("要求名称和模型名非空", () => {
    const issues = validateModelConfigurationInput({
      ...validInput(),
      name: "  ",
      modelName: "",
    });

    expect(issues.map((issue) => [issue.field, issue.code])).toEqual([
      ["name", "required"],
      ["modelName", "required"],
    ]);
  });

  it("只接受 https base URL", () => {
    expect(
      validateModelConfigurationInput({
        ...validInput(),
        baseUrl: "http://api.openai.com/v1",
      }),
    ).toMatchObject([{ field: "baseUrl", code: "unsupported_protocol" }]);
  });

  it("允许 API 版本路径和 query/userinfo", () => {
    expect(
      validateModelConfigurationInput({
        ...validInput(),
        baseUrl: "https://user:pass@example.com/v1?tenant=1",
      }),
    ).toEqual([]);
  });

  it("拒绝具体图片接口路径", () => {
    expect(
      validateModelConfigurationInput({
        ...validInput(),
        baseUrl: "https://api.openai.com/v1/images/generations",
      }),
    ).toMatchObject([{ field: "baseUrl", code: "endpoint_path" }]);
  });
});

describe("normalizeBaseUrl", () => {
  it("去掉首尾空白和末尾斜杠", () => {
    expect(normalizeBaseUrl(" https://api.openai.com/v1/ ")).toBe(
      "https://api.openai.com/v1",
    );
  });
});
