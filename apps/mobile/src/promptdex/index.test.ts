import { describe, expect, it } from "vitest";

import {
  findBuiltInPromptdexTemplate,
  getTextPromptdexInputs,
  isBuiltInPromptdexEntryExecutable,
  loadBuiltInPromptdexCatalog,
} from "./index";

describe("Built-in Promptdex catalog", () => {
  it("加载应用包内置图鉴条目并区分生成和编辑任务", () => {
    const catalog = loadBuiltInPromptdexCatalog();

    expect(catalog.sourceType).toBe("built-in");
    expect(catalog.entries).toHaveLength(9);
    expect(catalog.templates).toHaveLength(9);

    const generateEntry = catalog.entries.find(
      (entry) => entry.name === "light-infographic",
    );
    expect(generateEntry).toMatchObject({
      sourceType: "built-in",
      name: "light-infographic",
      taskType: "generate",
      executionState: "executable",
      inputs: [
        {
          name: "content",
          required: true,
          description: "需要转换为单张配图的一段文字",
        },
        {
          name: "title",
          required: false,
          description: "帮助理解内容的辅助标题",
        },
      ],
    });
    expect(
      isBuiltInPromptdexEntryExecutable(generateEntry ?? { taskType: "edit" }),
    ).toBe(true);

    const editEntry = catalog.entries.find(
      (entry) => entry.name === "american-university-graduation-portrait",
    );
    expect(editEntry).toMatchObject({
      sourceType: "built-in",
      taskType: "edit",
      executionState: "unsupported_edit_task",
    });
    expect(isBuiltInPromptdexEntryExecutable(editEntry ?? { taskType: "edit" })).toBe(
      false,
    );
  });

  it("按名称读取内置模板正文", () => {
    const template = findBuiltInPromptdexTemplate("light-infographic");

    expect(template).toMatchObject({
      name: "light-infographic",
      taskType: "generate",
    });
    expect(template?.body).toContain("# 浅色解释性信息图");
  });

  it("只返回文本类模板输入", () => {
    const template = findBuiltInPromptdexTemplate(
      "american-university-graduation-portrait",
    );

    expect(template).not.toBeNull();
    expect(getTextPromptdexInputs(template?.inputs ?? {})).toEqual([
      {
        name: "university",
        required: false,
        description: "希望参考其毕业服风格的大学名称",
      },
      {
        name: "degree_level",
        required: false,
        description: "学历层级，例如本科、硕士或博士",
      },
      {
        name: "major",
        required: false,
        description: "希望参考其常见毕业服细节的专业名称",
      },
      {
        name: "gender_expression",
        required: false,
        description: "人物的性别气质偏好，例如男生、女生或中性",
      },
    ]);
  });

  it("使用 core 解析规则拒绝无效模板源", () => {
    expect(() =>
      loadBuiltInPromptdexCatalog([
        {
          fileName: "broken.md",
          source: "name: broken",
        },
      ]),
    ).toThrow("文件必须以 YAML frontmatter 开始");
  });
});
