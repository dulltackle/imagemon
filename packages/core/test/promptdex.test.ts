import { describe, expect, it } from "vitest";
import {
  parsePromptdexTemplate,
  renderPromptdexTemplate,
  toPublicPromptdexTemplate,
  validatePromptdexTemplate,
  validateUniquePromptdexTemplateNames,
} from "../src/index.js";

describe("Promptdex 模板核心规则", () => {
  it("解析合法生成模板并返回公开模板形态", () => {
    const template = parsePromptdexTemplate(generateTemplate, "light-card.md");

    expect(template).toMatchObject({
      name: "light-card",
      description: "浅色卡片",
      taskType: "generate",
      inputs: {
        content: { required: true, description: "主要内容" },
        title: { required: false, description: "标题" },
      },
    });
    expect(toPublicPromptdexTemplate(template)).toMatchObject({
      name: "light-card",
      taskType: "generate",
      body: "# 浅色卡片\n\n保持简洁。",
    });
  });

  it("拒绝契约外 YAML 和模板结构", () => {
    expect(() => parsePromptdexTemplate("content", "x.md")).toThrow("frontmatter");
    expect(() => parsePromptdexTemplate("---\nname: x\n", "x.md")).toThrow("缺少结束分隔符");
    expect(() => parsePromptdexTemplate(generateTemplate.replace("description: 浅色卡片", "description: [bad]"), "light-card.md"))
      .toThrow("不支持的 YAML 特性");
    expect(() =>
      validatePromptdexTemplate(
        {
          name: "wrong",
          description: "说明",
          inputs: { content: { required: true, description: "内容" } },
          body: "正文",
          fileName: "right.md",
        },
        "right.md",
      ),
    ).toThrow("文件名必须为 wrong.md");
  });

  it("校验编辑模板中的 image 和 mask 关系", () => {
    const template = parsePromptdexTemplate(editTemplate, "edit-card.md");

    expect(template.taskType).toBe("edit");
    expect(() =>
      validatePromptdexTemplate(
        {
          name: "mask-only",
          description: "说明",
          inputs: { mask: { required: false, description: "蒙版" } },
          body: "正文",
          fileName: "mask-only.md",
        },
        "mask-only.md",
      ),
    ).toThrow("声明 mask 时必须同时声明 image");
  });

  it("渲染完整提示词并保留普通输入原始值", () => {
    const template = parsePromptdexTemplate(generateTemplate, "light-card.md");
    const rendered = renderPromptdexTemplate(template, {
      title: "标题",
      content: "第一行\n第二行\n",
    });

    expect(rendered.taskType).toBe("generate");
    expect(rendered.prompt).toContain("### content\n第一行\n第二行\n");
    expect(rendered.prompt.indexOf("### content")).toBeLessThan(rendered.prompt.indexOf("### title"));
  });

  it("文件输入只作为路径返回，不写入完整提示词", () => {
    const template = parsePromptdexTemplate(editTemplate, "edit-card.md");
    const rendered = renderPromptdexTemplate(template, {
      image: "  ./input.png\n",
      mask: "\t./mask.png\r\n",
      instruction: "改成蓝色",
    });

    expect(rendered).toMatchObject({
      taskType: "edit",
      image: "./input.png",
      mask: "./mask.png",
    });
    expect(rendered.prompt).toContain("### instruction\n改成蓝色");
    expect(rendered.prompt).not.toContain("./input.png");
    expect(rendered.prompt).not.toContain("./mask.png");
  });

  it("缺少必需输入和重复模板名时失败", () => {
    const template = parsePromptdexTemplate(generateTemplate, "light-card.md");

    const missing = captureError(() => renderPromptdexTemplate(template, {}));
    expect(missing.message).toContain("缺少必需输入：content");
    expect((missing as Error & { code?: string }).code).toBe("MISSING_INPUT");

    expect(() => validateUniquePromptdexTemplateNames([template, { ...template, fileName: "copy.md" }])).toThrow(
      '模板名 "light-card" 与 light-card.md 重复',
    );
  });
});

function captureError(action: () => unknown): Error {
  try {
    action();
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected action to throw");
}

const generateTemplate = `---
name: light-card
description: 浅色卡片
inputs:
  content:
    required: true
    description: 主要内容
  title:
    required: false
    description: 标题
---

# 浅色卡片

保持简洁。
`;

const editTemplate = `---
name: edit-card
description: 编辑卡片
inputs:
  image:
    required: true
    description: 原图
  mask:
    required: false
    description: 蒙版
  instruction:
    required: true
    description: 编辑要求
---

# 编辑卡片

按要求编辑卡片。
`;
