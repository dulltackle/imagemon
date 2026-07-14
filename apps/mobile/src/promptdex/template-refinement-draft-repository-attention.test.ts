import { describe, expect, it, vi } from "vitest";

import {
  createMemoryBusinessCallAttentionStore,
  type BusinessCallAttentionStore,
} from "../business-call-attentions/repository";
import {
  createMemoryTemplateRefinementDraftStore,
  createTemplateRefinementDraftRepository,
  type TemplateRefinementDraftStore,
  type TemplateRefinementProposal,
} from "./template-refinement-draft-repository";

const input = {
  externalPrompt: "外部完整提示词",
  plannedUse: "计划用途",
};

describe("TemplateRefinementDraftRepository 业务调用提示集成", () => {
  it("生成成功或失败时写入最终提示，审阅元数据修改不重复标记", async () => {
    const attentionStore = createMemoryBusinessCallAttentionStore();
    const timestamps = createTimestampSequence();
    const repository = createTemplateRefinementDraftRepository({
      store: createMemoryTemplateRefinementDraftStore(),
      attentionStore,
      now: timestamps.next,
    });

    await repository.startGenerating(input);
    await repository.saveProposal(createProposal());
    await expect(attentionStore.listAttentions()).resolves.toEqual([
      {
        subjectType: "template_refinement",
        subjectId: "template_refinement",
        kind: "succeeded",
        createdAt: "2026-07-13T00:00:02.000Z",
      },
    ]);

    await repository.updateReviewProposal(
      createProposal({ name: "renamed-template" }),
    );
    await expect(attentionStore.listAttentions()).resolves.toEqual([
      {
        subjectType: "template_refinement",
        subjectId: "template_refinement",
        kind: "succeeded",
        createdAt: "2026-07-13T00:00:02.000Z",
      },
    ]);

    await repository.saveFailure({
      reason: "network_error",
      occurredAt: "2026-07-13T00:01:00.000Z",
    });
    await expect(attentionStore.listAttentions()).resolves.toEqual([
      {
        subjectType: "template_refinement",
        subjectId: "template_refinement",
        kind: "failed",
        createdAt: "2026-07-13T00:00:04.000Z",
      },
    ]);
  });

  it("新一轮生成和清除草稿会同步清理旧提示", async () => {
    const attentionStore = createMemoryBusinessCallAttentionStore();
    const repository = createTemplateRefinementDraftRepository({
      store: createMemoryTemplateRefinementDraftStore(),
      attentionStore,
    });

    await repository.startGenerating(input);
    await repository.saveProposal(createProposal());
    await repository.startGenerating({
      externalPrompt: "下一轮外部提示词",
      plannedUse: "下一轮用途",
    });
    await expect(attentionStore.listAttentions()).resolves.toEqual([]);

    await repository.saveFailure({
      reason: "offline",
      occurredAt: "2026-07-13T00:01:00.000Z",
    });
    await repository.clear();
    await expect(attentionStore.listAttentions()).resolves.toEqual([]);
    await expect(repository.get()).resolves.toBeNull();
  });

  it("启动恢复只为遗留 generating 草稿标记结果不确定并保留输入", async () => {
    const attentionStore = createMemoryBusinessCallAttentionStore();
    const timestamps = createTimestampSequence();
    const repository = createTemplateRefinementDraftRepository({
      store: createMemoryTemplateRefinementDraftStore(),
      attentionStore,
      now: timestamps.next,
    });
    const generatingDraft = await repository.startGenerating(input);

    await expect(repository.markInterruptedGenerationUncertain()).resolves.toBe(true);

    await expect(repository.get()).resolves.toEqual(generatingDraft);
    await expect(attentionStore.listAttentions()).resolves.toEqual([
      {
        subjectType: "template_refinement",
        subjectId: "template_refinement",
        kind: "uncertain",
        createdAt: "2026-07-13T00:00:02.000Z",
      },
    ]);

    await repository.saveProposal(createProposal());
    await expect(repository.markInterruptedGenerationUncertain()).resolves.toBe(false);
    await expect(attentionStore.listAttentions()).resolves.toMatchObject([
      { kind: "succeeded" },
    ]);
  });

  it("草稿状态写入失败时不会留下孤立提示", async () => {
    const attentionStore = createMemoryBusinessCallAttentionStore();
    const memoryStore = createMemoryTemplateRefinementDraftStore();
    const repository = createTemplateRefinementDraftRepository({
      store: memoryStore,
      attentionStore,
    });
    await repository.startGenerating(input);

    const failingStore: TemplateRefinementDraftStore = {
      ...memoryStore,
      async upsertDraft() {
        throw new Error("draft update failed");
      },
    };
    const failingRepository = createTemplateRefinementDraftRepository({
      store: failingStore,
      attentionStore,
    });

    await expect(
      failingRepository.saveProposal(createProposal()),
    ).rejects.toThrow("draft update failed");

    await expect(repository.get()).resolves.toMatchObject({ status: "generating" });
    await expect(attentionStore.listAttentions()).resolves.toEqual([]);
  });

  it("只在草稿事务提交后发布提示变更", async () => {
    const memoryStore = createMemoryTemplateRefinementDraftStore();
    let transactionOpen = false;
    const store: TemplateRefinementDraftStore = {
      ...memoryStore,
      async withTransaction<T>(task: () => Promise<T>) {
        return memoryStore.withTransaction(async () => {
          transactionOpen = true;
          try {
            return await task();
          } finally {
            transactionOpen = false;
          }
        });
      },
    };
    const baseAttentionStore = createMemoryBusinessCallAttentionStore();
    const publish = vi.fn(() => {
      expect(transactionOpen).toBe(false);
      baseAttentionStore.publish();
    });
    const attentionStore: BusinessCallAttentionStore = {
      ...baseAttentionStore,
      publish,
    };
    const repository = createTemplateRefinementDraftRepository({
      store,
      attentionStore,
    });

    await repository.startGenerating(input);
    publish.mockClear();
    await repository.saveProposal(createProposal());

    expect(publish).toHaveBeenCalledTimes(1);
  });
});

function createProposal(
  templateOverrides: Partial<TemplateRefinementProposal["template"]> = {},
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
      body: "# 模板正文\n\n生成一张清晰图片。",
      ...templateOverrides,
    },
    taskTypeRationale: "未声明 image 输入，因此是生成任务。",
    retainedRules: ["保留构图规则"],
    removedRules: [],
    additions: [],
  };
}

function createTimestampSequence() {
  let counter = 0;
  return {
    next: () =>
      `2026-07-13T00:00:${String(++counter).padStart(2, "0")}.000Z`,
  };
}
