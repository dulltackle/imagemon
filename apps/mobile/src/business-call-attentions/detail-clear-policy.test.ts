import { describe, expect, it } from "vitest";

import {
  shouldClearHistoryDetailAttention,
  shouldClearImageDetailAttention,
  shouldClearRenderedEntryTaskAttention,
  shouldClearTemplateRefinementAttention,
} from "./detail-clear-policy";
import {
  getImageTaskAttentionLabel,
  getTemplateRefinementAttentionLabel,
} from "./presentation";

describe("详情提示清除策略", () => {
  it("只在聚焦的历史详情渲染最终状态后清除", () => {
    const base = {
      isFocused: true,
      routeHistoryId: "history-1",
      loadedHistoryId: "history-1",
      loadStatus: "ready" as const,
      taskStatus: "completed" as const,
      hasActiveCall: false,
      attentionKind: "succeeded" as const,
    };

    expect(shouldClearHistoryDetailAttention(base)).toBe(true);
    expect(
      shouldClearHistoryDetailAttention({ ...base, isFocused: false }),
    ).toBe(false);
    expect(
      shouldClearHistoryDetailAttention({
        ...base,
        taskStatus: "running",
      }),
    ).toBe(false);
    expect(
      shouldClearHistoryDetailAttention({ ...base, hasActiveCall: true }),
    ).toBe(false);
    expect(
      shouldClearHistoryDetailAttention({
        ...base,
        loadedHistoryId: "history-old",
      }),
    ).toBe(false);
    expect(
      shouldClearHistoryDetailAttention({
        ...base,
        loadStatus: "missing",
      }),
    ).toBe(false);
  });

  it("图片详情只清除关联任务的成功提示", () => {
    const base = {
      isFocused: true,
      routeImageResultId: "image-1",
      loadedImageResultId: "image-1",
      loadStatus: "ready" as const,
      taskHistoryId: "history-1",
      attentionKind: "succeeded" as const,
    };

    expect(shouldClearImageDetailAttention(base)).toBe(true);
    expect(
      shouldClearImageDetailAttention({ ...base, attentionKind: "failed" }),
    ).toBe(false);
    expect(
      shouldClearImageDetailAttention({ ...base, attentionKind: "uncertain" }),
    ).toBe(false);
    expect(
      shouldClearImageDetailAttention({ ...base, taskHistoryId: null }),
    ).toBe(false);
    expect(
      shouldClearImageDetailAttention({ ...base, isFocused: false }),
    ).toBe(false);
  });

  it("模板处理页须成功读取且没有进行中的提炼调用", () => {
    const base = {
      isFocused: true,
      loadStatus: "ready" as const,
      hasActiveCall: false,
      attentionKind: "uncertain" as const,
    };

    expect(shouldClearTemplateRefinementAttention(base)).toBe(true);
    expect(
      shouldClearTemplateRefinementAttention({
        ...base,
        hasActiveCall: true,
      }),
    ).toBe(false);
    expect(
      shouldClearTemplateRefinementAttention({
        ...base,
        loadStatus: "failed",
      }),
    ).toBe(false);
  });

  it("条目页只清除本页本次已经渲染的同类结果", () => {
    const base = {
      isFocused: true,
      routeEntryName: "portrait",
      loadedEntryName: "portrait",
      loadedEntryKey: "personal:portrait",
      resultEntryKey: "personal:portrait",
      resultHistoryId: "history-1",
      isResultRendered: true,
      resultKind: "failed" as const,
      attentionKind: "failed" as const,
    };

    expect(shouldClearRenderedEntryTaskAttention(base)).toBe(true);
    expect(
      shouldClearRenderedEntryTaskAttention({
        ...base,
        routeEntryName: "landscape",
      }),
    ).toBe(false);
    expect(
      shouldClearRenderedEntryTaskAttention({
        ...base,
        loadedEntryKey: "built-in:portrait",
      }),
    ).toBe(false);
    expect(
      shouldClearRenderedEntryTaskAttention({
        ...base,
        resultHistoryId: null,
      }),
    ).toBe(false);
    expect(
      shouldClearRenderedEntryTaskAttention({
        ...base,
        isResultRendered: false,
      }),
    ).toBe(false);
    expect(
      shouldClearRenderedEntryTaskAttention({
        ...base,
        attentionKind: "succeeded",
      }),
    ).toBe(false);
  });
});

describe("提示标签", () => {
  it("图片与模板按结果种类映射定位文案", () => {
    expect(getImageTaskAttentionLabel("succeeded")).toBe("待查看");
    expect(getImageTaskAttentionLabel("failed")).toBe("待处理");
    expect(getImageTaskAttentionLabel("uncertain")).toBe("待处理");
    expect(getTemplateRefinementAttentionLabel("succeeded")).toBe("待确认");
    expect(getTemplateRefinementAttentionLabel("failed")).toBe("待处理");
  });
});
