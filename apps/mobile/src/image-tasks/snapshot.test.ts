import { describe, expect, it } from "vitest";

import {
  cloneImageTaskSnapshot,
  parseImageTaskSnapshotJson,
  serializeImageTaskSnapshot,
} from "./snapshot";
import type { PromptdexImageTaskSnapshot } from "./types";

const promptdexSnapshot: PromptdexImageTaskSnapshot = {
  source: "promptdex",
  promptdexEntry: {
    name: "light-infographic",
    description: "将一段文字转换为浅色信息图",
    version: "1",
    sourceType: "built-in",
    taskType: "generate",
    inputs: {
      content: {
        required: true,
        description: "主要内容",
      },
      title: {
        required: false,
        description: "可选标题",
      },
    },
    body: "模板正文",
  },
  taskInputs: {
    content: "本次任务输入",
    title: "可选标题",
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

describe("ImageTaskSnapshot", () => {
  it("兼容读取没有 source 字段的旧 manual 快照", () => {
    const parsed = parseImageTaskSnapshotJson(
      JSON.stringify({
        prompt: "一只蓝色玻璃花瓶",
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
      }),
    );

    expect(parsed).toEqual({
      source: "manual",
      prompt: "一只蓝色玻璃花瓶",
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
    });
  });

  it("序列化和解析 Promptdex 快照", () => {
    const serialized = serializeImageTaskSnapshot(promptdexSnapshot);

    expect(parseImageTaskSnapshotJson(serialized)).toEqual(promptdexSnapshot);
  });

  it("深拷贝 Promptdex 快照", () => {
    const cloned = cloneImageTaskSnapshot(promptdexSnapshot);
    expect(cloned).toEqual(promptdexSnapshot);

    if (cloned.source !== "promptdex") {
      throw new Error("测试快照应为 Promptdex 快照");
    }
    cloned.promptdexEntry.inputs.content.description = "已修改";
    cloned.taskInputs.content = "已修改";
    cloned.imageSpec.size = "1536x1024";
    cloned.modelConfiguration.modelName = "other-model";

    expect(promptdexSnapshot.promptdexEntry.inputs.content.description).toBe(
      "主要内容",
    );
    expect(promptdexSnapshot.taskInputs.content).toBe("本次任务输入");
    expect(promptdexSnapshot.imageSpec.size).toBe("1024x1024");
    expect(promptdexSnapshot.modelConfiguration.modelName).toBe("gpt-image-2");
  });

  it("拒绝不受支持的快照 source", () => {
    expect(() =>
      parseImageTaskSnapshotJson(
        JSON.stringify({
          source: "unknown",
        }),
      ),
    ).toThrow("snapshot_json 不是有效图片任务快照");
  });
});
