import { describe, expect, it } from "vitest";
import {
  parsePromptdexTemplate,
  serializePromptdexTemplateMarkdown,
} from "@imagemon/core";

import {
  createMemoryPersonalPromptdexEntryStore,
  createMergedPromptdexCatalogService,
  createPersonalPromptdexEntryRepository,
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
      isBuiltInPromptdexEntryExecutable(
        generateEntry ?? { taskType: "edit", inputs: [] },
      ),
    ).toBe(true);

    const editEntry = catalog.entries.find(
      (entry) => entry.name === "american-university-graduation-portrait",
    );
    expect(editEntry).toMatchObject({
      sourceType: "built-in",
      taskType: "edit",
      executionState: "executable",
    });
    expect(
      isBuiltInPromptdexEntryExecutable(editEntry ?? { taskType: "edit", inputs: [] }),
    ).toBe(true);
  });

  it("含 mask 的编辑条目标记为暂不可执行", () => {
    const catalog = loadBuiltInPromptdexCatalog([
      {
        fileName: "mask-edit.md",
        source: `---
name: mask-edit
description: 蒙版编辑
inputs:
  image:
    required: true
    description: 原图
  mask:
    required: true
    description: 蒙版
---

# 蒙版编辑`,
      },
    ]);

    expect(catalog.entries[0]).toMatchObject(
      {
        taskType: "edit",
        executionState: "unsupported_edit_mask",
      },
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

  it("内置图鉴条目可序列化为可复制的 Promptdex Markdown", () => {
    const template = findBuiltInPromptdexTemplate("light-infographic");

    expect(template).not.toBeNull();
    if (!template) {
      return;
    }

    const markdown = serializePromptdexTemplateMarkdown(template);

    expect(markdown).toContain("name: light-infographic");
    expect(markdown).toContain("description: 将一段文字转换为浅色、清爽、结构清晰的解释性信息图");
    expect(markdown).toContain("# 浅色解释性信息图");
    expect(markdown).not.toContain("当前任务输入");
    expect(markdown).not.toContain("1024x1024");
    expect(markdown.endsWith("\n")).toBe(true);
    expect(parsePromptdexTemplate(markdown, template.fileName)).toEqual(template);
  });

  it("暂不可执行的 mask 图鉴条目仍可序列化为 Promptdex Markdown", () => {
    const catalog = loadBuiltInPromptdexCatalog([
      {
        fileName: "mask-edit.md",
        source: `---
name: mask-edit
description: 蒙版编辑
inputs:
  image:
    required: true
    description: 原图
  mask:
    required: true
    description: 蒙版
  instruction:
    required: false
    description: 编辑要求
---

# 蒙版编辑`,
      },
    ]);
    const template = catalog.templates[0];

    expect(catalog.entries[0].executionState).toBe("unsupported_edit_mask");
    expect(parsePromptdexTemplate(
      serializePromptdexTemplateMarkdown(template),
      template.fileName,
    )).toEqual(template);
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

describe("Merged Promptdex catalog", () => {
  it("个人条目排在内置条目前，组内按名称升序并带来源徽标字段", async () => {
    const personalRepository = createPersonalRepository();
    await personalRepository.saveFromTemplate(createTemplate("z-personal"));
    await personalRepository.saveFromTemplate(createTemplate("alpha-personal"));
    const service = createMergedPromptdexCatalogService({
      personalRepository,
      builtInSources: [
        createTemplateSource("z-built-in"),
        createTemplateSource("alpha-built-in"),
      ],
    });

    const entries = await service.list();

    expect(
      entries.map((entry) => ({
        sourceType: entry.sourceType,
        sourceLabel: entry.sourceLabel,
        name: entry.name,
        executionState: entry.executionState,
      })),
    ).toEqual([
      {
        sourceType: "personal",
        sourceLabel: "个人",
        name: "alpha-personal",
        executionState: "executable",
      },
      {
        sourceType: "personal",
        sourceLabel: "个人",
        name: "z-personal",
        executionState: "executable",
      },
      {
        sourceType: "built-in",
        sourceLabel: "内置",
        name: "alpha-built-in",
        executionState: "executable",
      },
      {
        sourceType: "built-in",
        sourceLabel: "内置",
        name: "z-built-in",
        executionState: "executable",
      },
    ]);
  });

  it("同名冲突时保留个人条目并按名称唯一查找", async () => {
    const personalRepository = createPersonalRepository();
    await personalRepository.saveFromTemplate(
      createTemplate("shared-entry", "个人模板正文"),
    );
    const service = createMergedPromptdexCatalogService({
      personalRepository,
      builtInSources: [
        createTemplateSource("shared-entry", "内置模板正文"),
        createTemplateSource("built-in-only", "内置专属正文"),
      ],
    });

    const entries = await service.list();
    const shared = await service.get("shared-entry");
    const builtInOnly = await service.get("built-in-only");

    expect(entries.map((entry) => `${entry.sourceType}:${entry.name}`)).toEqual([
      "personal:shared-entry",
      "built-in:built-in-only",
    ]);
    expect(shared).toMatchObject({
      sourceType: "personal",
      sourceLabel: "个人",
      template: {
        name: "shared-entry",
        body: "个人模板正文",
      },
    });
    expect(builtInOnly).toMatchObject({
      sourceType: "built-in",
      sourceLabel: "内置",
      template: {
        name: "built-in-only",
        body: "内置专属正文",
      },
    });
  });
});

function createPersonalRepository() {
  return createPersonalPromptdexEntryRepository({
    store: createMemoryPersonalPromptdexEntryStore(),
    now: () => "2026-07-01T00:00:00.000Z",
  });
}

function createTemplate(name: string, body = "模板正文") {
  return parsePromptdexTemplate(
    createTemplateSource(name, body).source,
    `${name}.md`,
  );
}

function createTemplateSource(name: string, body = "模板正文") {
  return {
    fileName: `${name}.md`,
    source: `---
name: ${name}
description: ${name} 描述
inputs:
  subject:
    required: true
    description: 画面主体
---

${body}`,
  };
}
