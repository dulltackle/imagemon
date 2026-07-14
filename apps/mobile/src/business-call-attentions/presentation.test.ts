import { describe, expect, it } from "vitest";

import {
  createBusinessCallAttentionSnapshot,
  getImageTaskAttentionLabel,
  getTemplateRefinementAttentionLabel,
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
