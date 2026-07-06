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

const editPromptdexSnapshot: PromptdexImageTaskSnapshot = {
  source: "promptdex",
  promptdexEntry: {
    name: "cute-paper-craft-isometric-character",
    description: "把输入图片改造成纸艺角色",
    version: "2",
    sourceType: "built-in",
    taskType: "edit",
    inputs: {
      image: {
        required: true,
        description: "输入图片",
      },
      style: {
        required: true,
        description: "风格要求",
      },
    },
    body: "模板正文",
  },
  taskInputs: {
    style: "暖色纸艺",
  },
  inputAttachments: {
    image: {
      role: "image",
      filePath: "task-history-attachments/history-1/image.png",
      mimeType: "image/png",
      originalFileName: "input.png",
      width: 1200,
      height: 800,
      byteSize: 123456,
    },
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
  fullPrompt: "渲染后的编辑完整提示词",
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

  it("解析包含编辑输入附件的 Promptdex 编辑快照", () => {
    const serialized = serializeImageTaskSnapshot(editPromptdexSnapshot);

    expect(parseImageTaskSnapshotJson(serialized)).toEqual(editPromptdexSnapshot);
  });

  it("兼容读取没有 inputAttachments 的旧 Promptdex 编辑快照", () => {
    const legacyEditSnapshot: PromptdexImageTaskSnapshot = {
      ...editPromptdexSnapshot,
      inputAttachments: undefined,
    };
    delete legacyEditSnapshot.inputAttachments;

    expect(
      parseImageTaskSnapshotJson(JSON.stringify(legacyEditSnapshot)),
    ).toEqual(legacyEditSnapshot);
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

  it("深拷贝 Promptdex 编辑输入附件", () => {
    const cloned = cloneImageTaskSnapshot(editPromptdexSnapshot);
    expect(cloned).toEqual(editPromptdexSnapshot);

    if (
      cloned.source !== "promptdex" ||
      cloned.inputAttachments?.image === undefined
    ) {
      throw new Error("测试快照应为带输入附件的 Promptdex 快照");
    }
    cloned.inputAttachments.image.filePath =
      "task-history-attachments/history-2/image.png";

    expect(editPromptdexSnapshot.inputAttachments?.image?.filePath).toBe(
      "task-history-attachments/history-1/image.png",
    );
  });

  it("拒绝缺少 image 附件的新 Promptdex 编辑快照", () => {
    expect(() =>
      parseImageTaskSnapshotJson(
        JSON.stringify({
          ...editPromptdexSnapshot,
          inputAttachments: {},
        }),
      ),
    ).toThrow("snapshot_json 不是有效图片任务快照");
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
