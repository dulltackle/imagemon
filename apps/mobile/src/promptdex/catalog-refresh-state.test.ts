import { describe, expect, it } from "vitest";

import {
  beginPromptdexCatalogRefresh,
  failPromptdexCatalogRefresh,
  getPromptdexCatalogRefreshFailureMessage,
  type PromptdexCatalogRefreshState,
} from "./catalog-refresh-state";

interface ReadyCatalogFields {
  value: string;
}

type TestCatalogState = PromptdexCatalogRefreshState<ReadyCatalogFields>;

describe("Promptdex catalog refresh state", () => {
  it("首次 loading 开始加载后仍保持 loading", () => {
    const state: TestCatalogState = { status: "loading" };

    expect(beginPromptdexCatalogRefresh(state)).toEqual({ status: "loading" });
  });

  it("failed 重新加载时进入 loading", () => {
    const state: TestCatalogState = {
      status: "failed",
      message: "network unavailable",
    };

    expect(beginPromptdexCatalogRefresh(state)).toEqual({ status: "loading" });
  });

  it("ready 后台刷新开始时保持同一个 ready 内容", () => {
    const state: TestCatalogState = { status: "ready", value: "current" };

    expect(beginPromptdexCatalogRefresh(state)).toBe(state);
  });

  it("ready 后台刷新失败时保持旧 ready 内容", () => {
    const state: TestCatalogState = { status: "ready", value: "current" };

    expect(failPromptdexCatalogRefresh(state, "refresh failed")).toBe(state);
  });

  it("非 ready 刷新失败时进入 failed 并展示错误消息", () => {
    const state: TestCatalogState = { status: "loading" };

    expect(failPromptdexCatalogRefresh(state, "refresh failed")).toEqual({
      status: "failed",
      message: "refresh failed",
    });
  });

  it("从 Error 提取刷新失败消息", () => {
    expect(
      getPromptdexCatalogRefreshFailureMessage(new Error("database failed")),
    ).toBe("database failed");
  });
});
