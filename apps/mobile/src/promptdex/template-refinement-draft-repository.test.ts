import { beforeEach, describe, expect, it } from "vitest";

import {
  TemplateRefinementDraftRepositoryError,
  type TemplateRefinementErrorSummary,
  type TemplateRefinementProposal,
  createMemoryTemplateRefinementDraftStore,
  createTemplateRefinementDraftRepository,
} from "./template-refinement-draft-repository";

function createProposal(
  overrides: Partial<TemplateRefinementProposal> = {},
): TemplateRefinementProposal {
  return {
    template: {
      name: "refined-template",
      description: "适合复用的模板",
      inputs: {
        subject: {
          required: true,
          description: "画面主体",
        },
      },
      body: "# 可复用规则\n\n生成清晰图片。",
    },
    taskTypeRationale: "未声明 image 输入，因此是生成任务。",
    retainedRules: ["保留构图规则"],
    removedRules: [
      {
        summary: "移除一次性主体",
        reason: "主体应由模板输入提供。",
      },
    ],
    additions: [
      {
        summary: "补充输出质量要求",
        reason: "原提示词未明确质量边界。",
        impactIfRejected: "生成稳定性降低。",
      },
    ],
    ...overrides,
  };
}

function createErrorSummary(
  overrides: Partial<TemplateRefinementErrorSummary> = {},
): TemplateRefinementErrorSummary {
  return {
    reason: "invalid_response",
    occurredAt: "2026-07-01T00:00:30.000Z",
    ...overrides,
  };
}

describe("TemplateRefinementDraftRepository", () => {
  let timeCounter: number;

  beforeEach(() => {
    timeCounter = 0;
  });

  function repository() {
    return createTemplateRefinementDraftRepository({
      store: createMemoryTemplateRefinementDraftStore(),
      now: () => `2026-07-01T00:00:0${++timeCounter}.000Z`,
    });
  }

  it("初始状态没有提炼草稿", async () => {
    const repo = repository();

    await expect(repo.get()).resolves.toBeNull();
  });

  it("开始生成时创建唯一草稿并清空旧方案和错误", async () => {
    const repo = repository();
    await repo.startGenerating({
      externalPrompt: "完整提示词 A",
      plannedUse: "用途 A",
    });
    await repo.saveProposal(createProposal());

    const next = await repo.startGenerating({
      externalPrompt: "完整提示词 B",
      plannedUse: "用途 B",
    });

    expect(next).toMatchObject({
      status: "generating",
      externalPrompt: "完整提示词 B",
      plannedUse: "用途 B",
      proposal: null,
      errorSummary: null,
      createdAt: "2026-07-01T00:00:01.000Z",
      updatedAt: "2026-07-01T00:00:03.000Z",
    });
    await expect(repo.get()).resolves.toEqual(next);
  });

  it("保存方案后进入审阅状态并保留输入", async () => {
    const repo = repository();
    await repo.startGenerating({
      externalPrompt: "外部完整提示词",
      plannedUse: "计划用途",
    });

    const proposal = createProposal();
    const draft = await repo.saveProposal(proposal);
    proposal.template.inputs.subject.description = "被调用方后续修改";

    expect(draft).toMatchObject({
      status: "ready_for_review",
      externalPrompt: "外部完整提示词",
      plannedUse: "计划用途",
      proposal: {
        template: {
          name: "refined-template",
          body: "# 可复用规则\n\n生成清晰图片。",
          inputs: {
            subject: {
              description: "画面主体",
            },
          },
        },
      },
      errorSummary: null,
      updatedAt: "2026-07-01T00:00:02.000Z",
    });
    await expect(repo.get()).resolves.toEqual(draft);
  });

  it("保存失败摘要后进入失败状态且不保留方案", async () => {
    const repo = repository();
    await repo.startGenerating({
      externalPrompt: "外部完整提示词",
      plannedUse: "计划用途",
    });
    await repo.saveProposal(createProposal());

    const draft = await repo.saveFailure(
      createErrorSummary({
        reason: "rate_limited",
        statusCode: 429,
        providerCode: "rate_limit",
      }),
    );

    expect(draft).toMatchObject({
      status: "failed",
      proposal: null,
      errorSummary: {
        reason: "rate_limited",
        occurredAt: "2026-07-01T00:00:30.000Z",
        statusCode: 429,
        providerCode: "rate_limit",
      },
    });
    expect(JSON.stringify(draft)).not.toContain("模型原始响应");
  });

  it("修改输入会回到可编辑状态并使原方案失效", async () => {
    const repo = repository();
    await repo.startGenerating({
      externalPrompt: "旧提示词",
      plannedUse: "旧用途",
    });
    await repo.saveProposal(createProposal());

    const draft = await repo.saveEditingInput({
      externalPrompt: "新提示词",
      plannedUse: "新用途",
    });

    expect(draft).toMatchObject({
      status: "editing_input",
      externalPrompt: "新提示词",
      plannedUse: "新用途",
      proposal: null,
      errorSummary: null,
    });
  });

  it("没有草稿时不能保存方案或失败摘要", async () => {
    const repo = repository();

    await expect(repo.saveProposal(createProposal())).rejects.toBeInstanceOf(
      TemplateRefinementDraftRepositoryError,
    );
    await expect(repo.saveFailure(createErrorSummary())).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("可以清除唯一提炼草稿", async () => {
    const repo = repository();
    await repo.startGenerating({
      externalPrompt: "外部完整提示词",
      plannedUse: "计划用途",
    });

    await repo.clear();

    await expect(repo.get()).resolves.toBeNull();
  });
});
