import { describe, expect, it, vi } from "vitest";

import { createBackupSessionStore } from "./backup-session";

const SUMMARY = {
  created: 1,
  updated: 2,
  deleted: 0,
  skipped: 3,
  uploadedImages: 1,
};

describe("createBackupSessionStore", () => {
  it("初始为 idle", () => {
    const store = createBackupSessionStore();
    expect(store.getSnapshot()).toEqual({ status: "idle" });
  });

  it("start 进入 running 并返回未中断信号", () => {
    const store = createBackupSessionStore();
    const started = store.start();
    expect(started.status).toBe("started");
    const signal = started.signal;
    expect(store.getSnapshot().status).toBe("running");
    expect(signal.aborted).toBe(false);
  });

  it("requestCancel 中断信号并进入 cancelling", () => {
    const store = createBackupSessionStore();
    const signal = store.start().signal;
    store.requestCancel();
    expect(signal.aborted).toBe(true);
    expect(store.getSnapshot().status).toBe("cancelling");
  });

  it("非运行态 requestCancel 无操作", () => {
    const store = createBackupSessionStore();
    store.requestCancel();
    expect(store.getSnapshot().status).toBe("idle");
  });

  it("running 状态二次 start 返回原信号且不重复通知", () => {
    const store = createBackupSessionStore();
    const listener = vi.fn();
    store.subscribe(listener);
    const first = store.start();
    const second = store.start();

    expect(first.status).toBe("started");
    expect(second.status).toBe("already_running");
    expect(second.signal).toBe(first.signal);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("cancelling 状态二次 start 返回同一个已中断信号", () => {
    const store = createBackupSessionStore();
    const first = store.start();
    store.requestCancel();
    const second = store.start();

    expect(second.status).toBe("already_running");
    expect(second.signal).toBe(first.signal);
    expect(second.signal.aborted).toBe(true);
    expect(store.getSnapshot().status).toBe("cancelling");
  });

  it("会话结束后下一次 start 才创建新信号", () => {
    const store = createBackupSessionStore();
    const first = store.start();
    store.settle({ status: "cancelled" });
    const second = store.start();

    expect(second.status).toBe("started");
    expect(second.signal).not.toBe(first.signal);
  });

  it("settle succeeded 展示成功时间与摘要", () => {
    const store = createBackupSessionStore();
    store.start();
    store.settle({ status: "succeeded", succeededAt: "2026-07-15T12:00:00.000Z", summary: SUMMARY });
    expect(store.getSnapshot()).toEqual({
      status: "succeeded",
      succeededAt: "2026-07-15T12:00:00.000Z",
      summary: SUMMARY,
    });
  });

  it("settle cancelled 回到 idle 不留信息", () => {
    const store = createBackupSessionStore();
    store.start();
    store.requestCancel();
    store.settle({ status: "cancelled" });
    expect(store.getSnapshot()).toEqual({ status: "idle" });
  });

  it("settle failed 展示会话级失败说明", () => {
    const store = createBackupSessionStore();
    store.start();
    store.settle({ status: "failed", message: "字段类型不符：模板正文。" });
    expect(store.getSnapshot()).toEqual({
      status: "failed",
      message: "字段类型不符：模板正文。",
    });
  });

  it("settle blocked 归为失败展示并区分原因", () => {
    const migration = createBackupSessionStore();
    migration.start();
    migration.settle({ status: "blocked", reason: "migration" });
    expect(migration.getSnapshot()).toMatchObject({ status: "failed" });

    const modelCall = createBackupSessionStore();
    modelCall.start();
    modelCall.settle({ status: "blocked", reason: "model_call" });
    expect(modelCall.getSnapshot()).toMatchObject({ status: "failed" });
  });

  it("settle not_configured 归为失败展示", () => {
    const store = createBackupSessionStore();
    store.start();
    store.settle({ status: "not_configured" });
    expect(store.getSnapshot()).toMatchObject({ status: "failed" });
  });

  it("reset 回到 idle", () => {
    const store = createBackupSessionStore();
    store.start();
    store.settle({ status: "failed", message: "x" });
    store.reset();
    expect(store.getSnapshot()).toEqual({ status: "idle" });
  });

  it("状态变化通知订阅者", () => {
    const store = createBackupSessionStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.start();
    store.settle({ status: "succeeded", succeededAt: "t", summary: SUMMARY });
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
