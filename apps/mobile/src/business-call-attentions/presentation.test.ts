import { describe, expect, it } from "vitest";

import {
  createBusinessCallAttentionSnapshot,
  getBusinessCallTabBadgeVisibility,
  getImageTaskAttentionLabel,
  getTemplateRefinementAttentionLabel,
  hasSucceededImageTaskAttention,
} from "./presentation";

describe("createBusinessCallAttentionSnapshot", () => {
  it("成功图片任务同时提示图鉴与历史入口", () => {
    const snapshot = createBusinessCallAttentionSnapshot([
      {
        subjectType: "image_task",
        subjectId: "history-success",
        kind: "succeeded",
        createdAt: "2026-07-13T01:00:00.000Z",
      },
    ]);

    expect(snapshot.hasCatalogAttention).toBe(true);
    expect(snapshot.hasHistoryAttention).toBe(true);
    expect(snapshot.imageTasks.get("history-success")?.kind).toBe("succeeded");
    expect(snapshot.templateRefinement).toBeNull();
  });

  it("失败与结果不确定图片任务只提示历史入口", () => {
    for (const kind of ["failed", "uncertain"] as const) {
      const snapshot = createBusinessCallAttentionSnapshot([
        {
          subjectType: "image_task",
          subjectId: `history-${kind}`,
          kind,
          createdAt: "2026-07-13T01:00:00.000Z",
        },
      ]);

      expect(snapshot.hasCatalogAttention).toBe(false);
      expect(snapshot.hasHistoryAttention).toBe(true);
    }
  });

  it("任意模板提炼结果只提示图鉴入口并保留只读快照", () => {
    const snapshot = createBusinessCallAttentionSnapshot([
      {
        subjectType: "template_refinement",
        subjectId: "template_refinement",
        kind: "uncertain",
        createdAt: "2026-07-13T01:00:00.000Z",
      },
    ]);

    expect(snapshot.hasCatalogAttention).toBe(true);
    expect(snapshot.hasHistoryAttention).toBe(false);
    expect(snapshot.templateRefinement?.kind).toBe("uncertain");
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.attentions)).toBe(true);
    expect(Object.isFrozen(snapshot.attentions[0])).toBe(true);
  });
});

describe("业务调用 Tab 标记", () => {
  const persistentSnapshot = createBusinessCallAttentionSnapshot([
    {
      subjectType: "image_task",
      subjectId: "history-success",
      kind: "succeeded",
      createdAt: "2026-07-13T01:00:00.000Z",
    },
  ]);

  it("图片调用进行中同时标记图鉴和历史", () => {
    expect(
      getBusinessCallTabBadgeVisibility(
        EMPTY_SNAPSHOT,
        "imageGeneration",
      ),
    ).toEqual({ catalog: true, history: true });
    expect(
      getBusinessCallTabBadgeVisibility(EMPTY_SNAPSHOT, "imageEdit"),
    ).toEqual({ catalog: true, history: true });
  });

  it("模板提炼进行中只标记图鉴", () => {
    expect(
      getBusinessCallTabBadgeVisibility(
        EMPTY_SNAPSHOT,
        "templateRefinement",
      ),
    ).toEqual({ catalog: true, history: false });
  });

  it("诊断调用不制造业务标记，持久提示仍保留", () => {
    expect(
      getBusinessCallTabBadgeVisibility(
        EMPTY_SNAPSHOT,
        "modelConfigurationTest",
      ),
    ).toEqual({ catalog: false, history: false });
    expect(
      getBusinessCallTabBadgeVisibility(
        persistentSnapshot,
        "modelListFetch",
      ),
    ).toEqual({ catalog: true, history: true });
  });
});

describe("图片任务提示聚合", () => {
  const snapshot = createBusinessCallAttentionSnapshot([
    {
      subjectType: "image_task",
      subjectId: "history-old",
      kind: "succeeded",
      createdAt: "2026-07-13T01:00:00.000Z",
    },
    {
      subjectType: "image_task",
      subjectId: "history-failed",
      kind: "failed",
      createdAt: "2026-07-13T02:00:00.000Z",
    },
  ]);

  it("任一关联历史成功即标记条目，不依赖代表图", () => {
    expect(
      hasSucceededImageTaskAttention(snapshot, [
        "history-representative",
        "history-old",
      ]),
    ).toBe(true);
  });

  it("失败、未知或无关联历史不进入图片提示", () => {
    expect(
      hasSucceededImageTaskAttention(snapshot, ["history-failed"]),
    ).toBe(false);
    expect(hasSucceededImageTaskAttention(snapshot, [])).toBe(false);
  });
});

describe("业务调用提示文案", () => {
  it("区分成功结果与需要处理的结果", () => {
    expect(getImageTaskAttentionLabel("succeeded")).toBe("待查看");
    expect(getImageTaskAttentionLabel("failed")).toBe("待处理");
    expect(getImageTaskAttentionLabel("uncertain")).toBe("待处理");
    expect(getTemplateRefinementAttentionLabel("succeeded")).toBe("待确认");
    expect(getTemplateRefinementAttentionLabel("failed")).toBe("待处理");
    expect(getTemplateRefinementAttentionLabel("uncertain")).toBe("待处理");
  });
});

const EMPTY_SNAPSHOT = createBusinessCallAttentionSnapshot([]);
