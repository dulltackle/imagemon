import { describe, expect, it } from "vitest";
import {
  buildImageTaskSnapshot,
  parsePromptdexTemplate,
  type ModelConfigurationSnapshot,
} from "../src/index.js";

describe("图片任务快照核心规则", () => {
  it("构建执行时快照并保存完整提示词", () => {
    const entry = parsePromptdexTemplate(templateSource, "light-card.md");
    const modelConfiguration = {
      name: "默认图片模型",
      baseURL: "https://api.example/v1",
      model: "gpt-image-2",
      apiKey: "sk-secret",
      parameters: {
        timeout: 30_000,
        apiKey: "sk-parameter-secret",
      },
    } as unknown as ModelConfigurationSnapshot;

    const snapshot = buildImageTaskSnapshot({
      entry,
      sourceType: "personal",
      displayInfo: {
        title: "浅色卡片",
        purpose: "生成说明卡片",
        category: "信息图",
        searchTags: ["浅色", "卡片"],
        taskType: "generate",
      },
      taskInputs: {
        content: "核心内容",
        extra: "不属于模板的额外输入",
      },
      imageSpec: {
        size: "2048x2048",
        quality: "high",
        output_format: "png",
        n: 1,
      },
      modelConfiguration,
      capturedAt: "2026-06-24T01:02:03.000Z",
    });

    expect(snapshot).toMatchObject({
      capturedAt: "2026-06-24T01:02:03.000Z",
      taskType: "generate",
      entry: {
        name: "light-card",
        sourceType: "personal",
        displayInfo: {
          title: "浅色卡片",
          taskType: "generate",
        },
      },
      taskInputs: {
        content: "核心内容",
      },
      modelConfiguration: {
        name: "默认图片模型",
        baseURL: "https://api.example/v1",
        model: "gpt-image-2",
        parameters: {
          timeout: 30_000,
        },
      },
    });
    expect(snapshot.fullPrompt).toContain("### content\n核心内容");
    expect(JSON.stringify(snapshot)).not.toContain("sk-secret");
    expect(JSON.stringify(snapshot)).not.toContain("sk-parameter-secret");
    expect(snapshot).not.toHaveProperty("coverExample");
  });

  it("使用模型能力校验最终图片规格", () => {
    const entry = parsePromptdexTemplate(templateSource, "light-card.md");

    expect(() =>
      buildImageTaskSnapshot({
        entry,
        sourceType: "built-in",
        displayInfo: {
          title: "浅色卡片",
          purpose: "生成说明卡片",
          category: "信息图",
          searchTags: [],
          taskType: "generate",
        },
        taskInputs: { content: "核心内容" },
        imageSpec: { background: "transparent", output_format: "png" },
        modelConfiguration: {
          name: "默认图片模型",
          baseURL: "https://api.example/v1",
          model: "gpt-image-2",
        },
      }),
    ).toThrow("transparent background");
  });
});

const templateSource = `---
name: light-card
description: 浅色卡片
inputs:
  content:
    required: true
    description: 主要内容
---

# 浅色卡片

保持简洁。
`;
