import { beforeEach, describe, expect, it } from "vitest";
import type { PromptdexTemplate } from "@imagemon/core";

import {
  PersonalPromptdexEntryRepositoryError,
  createMemoryPersonalPromptdexEntryStore,
  createPersonalPromptdexEntryRepository,
} from "./personal-entry-repository";

function createTemplate(
  overrides: Partial<PromptdexTemplate> = {},
): PromptdexTemplate {
  const name = overrides.name ?? "personal-entry";
  const inputs = overrides.inputs ?? {
    subject: {
      required: true,
      description: "画面主体",
    },
  };
  return {
    name,
    description: overrides.description ?? "个人图鉴条目",
    inputs,
    body: overrides.body ?? "# 个人图鉴条目\n\n生成一张清晰图片。",
    fileName: overrides.fileName ?? `${name}.md`,
    taskType: Object.hasOwn(inputs, "image") ? "edit" : "generate",
    ...(Object.hasOwn(overrides, "version")
      ? { version: overrides.version }
      : {}),
  };
}

describe("PersonalPromptdexEntryRepository", () => {
  let timeCounter: number;

  beforeEach(() => {
    timeCounter = 0;
  });

  function repository() {
    return createPersonalPromptdexEntryRepository({
      store: createMemoryPersonalPromptdexEntryStore(),
      now: () => `2026-07-01T00:00:0${++timeCounter}.000Z`,
    });
  }

  it("从 PromptdexTemplate 写入并按名称读取个人图鉴条目", async () => {
    const repo = repository();
    const template = createTemplate({ version: "1.0.0" });

    const saved = await repo.saveFromTemplate(template);

    expect(saved).toMatchObject({
      sourceType: "personal",
      name: "personal-entry",
      description: "个人图鉴条目",
      version: "1.0.0",
      fileName: "personal-entry.md",
      taskType: "generate",
      createdAt: "2026-07-01T00:00:01.000Z",
      updatedAt: "2026-07-01T00:00:01.000Z",
    });
    await expect(repo.get("personal-entry")).resolves.toEqual(saved);
  });

  it("列表按名称升序返回", async () => {
    const repo = repository();

    await repo.saveFromTemplate(createTemplate({ name: "zebra-entry" }));
    await repo.saveFromTemplate(createTemplate({ name: "alpha-entry" }));

    await expect(repo.list()).resolves.toMatchObject([
      { name: "alpha-entry" },
      { name: "zebra-entry" },
    ]);
  });

  it("重复名称拒绝写入", async () => {
    const repo = repository();

    await repo.saveFromTemplate(createTemplate());

    await expect(repo.saveFromTemplate(createTemplate())).rejects.toMatchObject({
      code: "duplicate_name",
    });
  });

  it("无效模板不会写入", async () => {
    const repo = repository();
    const invalidTemplate = {
      ...createTemplate(),
      fileName: "wrong.md",
    } as PromptdexTemplate;

    await expect(repo.saveFromTemplate(invalidTemplate)).rejects.toBeInstanceOf(
      PersonalPromptdexEntryRepositoryError,
    );
    await expect(repo.list()).resolves.toEqual([]);
  });

  it("删除是硬删除", async () => {
    const repo = repository();
    await repo.saveFromTemplate(createTemplate());

    await repo.delete("personal-entry");

    await expect(repo.get("personal-entry")).resolves.toBeNull();
    await expect(repo.list()).resolves.toEqual([]);
  });

  it("不保存模板契约外的提炼过程和展示信息", async () => {
    const repo = repository();
    const templateWithExtraFields = {
      ...createTemplate(),
      originalFullPrompt: "用户粘贴的完整外部提示词",
      refinementResponse: { raw: "模型原始响应" },
      displayTitle: "展示标题",
    } as PromptdexTemplate;

    const saved = await repo.saveFromTemplate(templateWithExtraFields);

    expect(saved).not.toHaveProperty("originalFullPrompt");
    expect(saved).not.toHaveProperty("refinementResponse");
    expect(saved).not.toHaveProperty("displayTitle");
    await expect(repo.get(saved.name)).resolves.toEqual(saved);
  });
});
