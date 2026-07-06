import { describe, expect, it } from "vitest";

import {
  getImageTaskSnapshotFullPrompt,
  getImageTaskSnapshotSummary,
  getPromptdexSourceTypeLabel,
  getPromptdexTaskInputRows,
  getPromptdexTaskTypeLabel,
} from "./snapshot-display";
import type { ImageTaskSnapshot, PromptdexImageTaskSnapshot } from "./types";

describe("ImageTaskSnapshot display helpers", () => {
  it("为 manual 快照返回完整提示词摘要", () => {
    const snapshot: ImageTaskSnapshot = {
      source: "manual",
      prompt: "一张浅色信息图",
      imageSpec: {
        size: "1024x1024",
        quality: "auto",
        format: "png",
        n: 1,
      },
      modelConfiguration: {
        type: "image",
        baseUrl: "https://api.openai.com/v1",
        modelName: "gpt-image-2",
      },
    };

    expect(getImageTaskSnapshotSummary(snapshot)).toBe("一张浅色信息图");
    expect(getImageTaskSnapshotFullPrompt(snapshot)).toBe("一张浅色信息图");
  });

  it("为 Promptdex 快照返回图鉴条目摘要和任务输入行", () => {
    const snapshot: PromptdexImageTaskSnapshot = {
      source: "promptdex",
      promptdexEntry: {
        name: "light-infographic",
        description: "浅色信息图",
        sourceType: "built-in",
        taskType: "generate",
        inputs: {
          content: {
            required: true,
            description: "主要内容",
          },
        },
        body: "模板正文",
      },
      taskInputs: {
        content: "核心内容",
      },
      imageSpec: {
        size: "1024x1024",
        quality: "auto",
        format: "png",
        n: 1,
      },
      modelConfiguration: {
        type: "image",
        baseUrl: "https://api.openai.com/v1",
        modelName: "gpt-image-2",
      },
      fullPrompt: "渲染后的完整提示词",
    };

    expect(getImageTaskSnapshotSummary(snapshot)).toBe("light-infographic");
    expect(getImageTaskSnapshotFullPrompt(snapshot)).toBe("渲染后的完整提示词");
    expect(getPromptdexSourceTypeLabel("built-in")).toBe("内置");
    expect(getPromptdexTaskTypeLabel("generate")).toBe("生成");
    expect(getPromptdexTaskTypeLabel("edit")).toBe("编辑");
    expect(getPromptdexTaskInputRows(snapshot)).toEqual([
      {
        name: "content",
        value: "核心内容",
      },
    ]);
  });
});
