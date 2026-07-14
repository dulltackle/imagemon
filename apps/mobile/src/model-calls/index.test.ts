import { describe, expect, it } from "vitest";

import {
  TEMPLATE_REFINEMENT_MODEL_CALL_OWNER_KEY,
  createModelCallLockStore,
  getFirstRunModelCallOwnerKey,
  getModelConfigurationModelCallOwnerKey,
  getModelCallStatusLabel,
  getNewModelConfigurationModelCallOwnerKey,
  getPromptdexEntryModelCallOwnerKey,
  type BeginModelCallInput,
  type ModelCallType,
} from "./model-call-lock";

const FIRST_CALL: BeginModelCallInput = {
  type: "imageGeneration",
  returnHref: "/promptdex/内置条目?from=catalog",
  ownerKey: "promptdex-entry:内置条目",
  context: {
    promptdexEntryName: "内置条目",
  },
};

describe("model call status helpers", () => {
  it("为五类模型调用返回固定中文文案", () => {
    const labels: Record<ModelCallType, string> = {
      modelConfigurationTest: "测试连接进行中",
      modelListFetch: "拉取模型列表进行中",
      imageGeneration: "图片任务进行中",
      imageEdit: "图片任务进行中",
      templateRefinement: "模板提炼进行中",
    };

    for (const [type, label] of Object.entries(labels) as Array<
      [ModelCallType, string]
    >) {
      expect(getModelCallStatusLabel(type)).toBe(label);
    }
  });

  it("为各发起页面生成稳定且互不混淆的 owner key", () => {
    expect(getPromptdexEntryModelCallOwnerKey("内置条目")).toBe(
      "promptdex-entry:内置条目",
    );
    expect(TEMPLATE_REFINEMENT_MODEL_CALL_OWNER_KEY).toBe(
      "template-refinement",
    );
    expect(getModelConfigurationModelCallOwnerKey("configuration-id")).toBe(
      "model-configuration:configuration-id",
    );
    expect(getNewModelConfigurationModelCallOwnerKey("image")).toBe(
      "model-configuration-new:image",
    );
    expect(getNewModelConfigurationModelCallOwnerKey("text")).toBe(
      "model-configuration-new:text",
    );
    expect(getFirstRunModelCallOwnerKey("image")).toBe("first-run:image");
    expect(getFirstRunModelCallOwnerKey("text")).toBe("first-run:text");
  });
});

describe("model call lock store", () => {
  it("同步占用锁并把第二次调用阻塞在原调用上", () => {
    let generatedIdCount = 0;
    const store = createModelCallLockStore({
      generateId: () => {
        generatedIdCount += 1;
        return `call-${generatedIdCount}`;
      },
      now: () => "2026-07-13T12:34:56.000Z",
    });

    const first = store.beginModelCall(FIRST_CALL);
    const second = store.beginModelCall({
      type: "templateRefinement",
      returnHref: "/promptdex/refine",
      ownerKey: TEMPLATE_REFINEMENT_MODEL_CALL_OWNER_KEY,
    });

    expect(first).toEqual({
      status: "started",
      call: {
        id: "call-1",
        startedAt: "2026-07-13T12:34:56.000Z",
        ...FIRST_CALL,
      },
    });
    expect(second).toEqual({
      status: "blocked",
      activeCall: first.status === "started" ? first.call : null,
    });
    expect(generatedIdCount).toBe(1);
  });

  it("原样保存精确返回地址，不再按调用类型推断目标", () => {
    const store = createTestStore();
    const result = store.beginModelCall({
      type: "modelConfigurationTest",
      returnHref: "/model-configurations/new?type=text&from=first-run",
      ownerKey: getNewModelConfigurationModelCallOwnerKey("text"),
    });

    expect(result.status).toBe("started");
    expect(store.getSnapshot()?.returnHref).toBe(
      "/model-configurations/new?type=text&from=first-run",
    );
  });

  it("只允许当前 id 更新，并在补充 context 时保留已有上下文", () => {
    const store = createTestStore();
    const result = store.beginModelCall(FIRST_CALL);
    if (result.status !== "started") {
      throw new Error("测试前置调用应成功取得锁。");
    }
    const original = store.getSnapshot();

    store.updateModelCall("another-call", {
      returnHref: "/history/wrong",
      context: { historyId: "wrong" },
    });
    expect(store.getSnapshot()).toBe(original);

    store.updateModelCall(result.call.id, {
      returnHref: "/history/history-1",
      context: { historyId: "history-1" },
    });
    expect(store.getSnapshot()).toEqual({
      ...result.call,
      returnHref: "/history/history-1",
      context: {
        promptdexEntryName: "内置条目",
        historyId: "history-1",
      },
    });
  });

  it("只允许当前 id 结束，不会误释放别人的调用", () => {
    const store = createTestStore();
    const result = store.beginModelCall(FIRST_CALL);
    if (result.status !== "started") {
      throw new Error("测试前置调用应成功取得锁。");
    }
    const original = store.getSnapshot();

    store.endModelCall("another-call");
    expect(store.getSnapshot()).toBe(original);

    store.endModelCall(result.call.id);
    expect(store.getSnapshot()).toBeNull();
  });

  it("只在实际状态变化时通知订阅者，取消订阅后停止通知", () => {
    const store = createTestStore();
    let notificationCount = 0;
    const unsubscribe = store.subscribe(() => {
      notificationCount += 1;
    });

    const result = store.beginModelCall(FIRST_CALL);
    expect(notificationCount).toBe(1);
    if (result.status !== "started") {
      throw new Error("测试前置调用应成功取得锁。");
    }

    store.updateModelCall("another-call", { returnHref: "/wrong" });
    store.endModelCall("another-call");
    expect(notificationCount).toBe(1);

    store.updateModelCall(result.call.id, { ownerKey: "updated-owner" });
    expect(notificationCount).toBe(2);

    unsubscribe();
    store.endModelCall(result.call.id);
    expect(notificationCount).toBe(2);
  });
});

function createTestStore() {
  return createModelCallLockStore({
    generateId: () => "call-1",
    now: () => "2026-07-13T12:34:56.000Z",
  });
}
