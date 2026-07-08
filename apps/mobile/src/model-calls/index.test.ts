import { describe, expect, it } from "vitest";

import {
  getModelCallReturnHref,
  getModelCallStatusLabel,
  type ModelCallType,
} from "./index";

describe("model call status helpers", () => {
  it("按调用类型返回全局状态文案", () => {
    const labels: Record<ModelCallType, string> = {
      modelConfigurationTest: "测试连接进行中",
      imageGeneration: "图片任务进行中",
      imageEdit: "图片任务进行中",
      templateRefinement: "模板提炼进行中",
    };

    for (const [type, label] of Object.entries(labels) as Array<
      [ModelCallType, string]
    >) {
      expect(getModelCallStatusLabel(type)).toBe(label);
    }
  });

  it("模板提炼调用的返回入口指向提炼页", () => {
    expect(getModelCallReturnHref("templateRefinement")).toBe("/promptdex/refine");
  });
});
