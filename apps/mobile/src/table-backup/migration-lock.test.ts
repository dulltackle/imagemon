import { describe, expect, it, vi } from "vitest";

import {
  createModelCallLockStore,
  type ModelCallLockStore,
} from "../model-calls/model-call-lock";
import {
  createMigrationLockStore,
  getMigrationOperationStatusLabel,
  type MigrationLockStore,
} from "./migration-lock";

function createMigrationStore(overrides: {
  generateId?: () => string;
  now?: () => string;
} = {}): MigrationLockStore {
  let counter = 0;
  return createMigrationLockStore({
    generateId: overrides.generateId ?? (() => `op-${(counter += 1)}`),
    now: overrides.now ?? (() => "2026-07-15T00:00:00.000Z"),
  });
}

// 仿 ModelCallLockProvider 的交叉引用，得到一对互斥的锁。
function createLinkedStores(): {
  modelCall: ModelCallLockStore;
  migration: MigrationLockStore;
} {
  const stores = {} as {
    modelCall: ModelCallLockStore;
    migration: MigrationLockStore;
  };
  stores.modelCall = createModelCallLockStore({
    generateId: () => "call-1",
    now: () => "2026-07-15T00:00:00.000Z",
    migrationLock: {
      isMigrationActive: () => stores.migration.getSnapshot() !== null,
    },
  });
  stores.migration = createMigrationLockStore({
    generateId: () => "op-1",
    now: () => "2026-07-15T00:00:00.000Z",
    modelCallLock: {
      isModelCallActive: () => stores.modelCall.getSnapshot() !== null,
    },
  });
  return stores;
}

const REFINEMENT_CALL = {
  type: "templateRefinement",
  returnHref: "/promptdex/refine",
  ownerKey: "template-refinement",
} as const;

describe("createMigrationLockStore", () => {
  it("空闲时可获取操作锁", () => {
    const store = createMigrationStore();
    const result = store.beginMigrationOperation("table_backup");
    expect(result).toEqual({
      status: "acquired",
      operation: {
        id: "op-1",
        kind: "table_backup",
        startedAt: "2026-07-15T00:00:00.000Z",
      },
    });
    expect(store.getSnapshot()?.kind).toBe("table_backup");
  });

  it("已有迁移在进行时再次 begin 被自身占用阻塞", () => {
    const store = createMigrationStore();
    store.beginMigrationOperation("table_backup");
    const second = store.beginMigrationOperation("table_restore");
    expect(second.status).toBe("blocked");
    if (second.status === "blocked") {
      expect(second.reason).toBe("migration");
    }
  });

  it("end 释放锁后可再次获取", () => {
    const store = createMigrationStore();
    const first = store.beginMigrationOperation("table_backup");
    if (first.status !== "acquired") {
      throw new Error("expected acquired");
    }
    store.endMigrationOperation(first.operation.id);
    expect(store.getSnapshot()).toBeNull();
    expect(store.beginMigrationOperation("table_restore").status).toBe("acquired");
  });

  it("非当前操作 id 的 end 被忽略", () => {
    const store = createMigrationStore();
    store.beginMigrationOperation("table_backup");
    store.endMigrationOperation("op-other");
    expect(store.getSnapshot()).not.toBeNull();
  });

  it("订阅者在状态变化时收到通知", () => {
    const store = createMigrationStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    const result = store.beginMigrationOperation("table_backup");
    expect(listener).toHaveBeenCalledTimes(1);
    if (result.status === "acquired") {
      store.endMigrationOperation(result.operation.id);
    }
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("状态文案覆盖全部 kind", () => {
    expect(getMigrationOperationStatusLabel("table_backup")).toBe("表格备份进行中");
    expect(getMigrationOperationStatusLabel("table_restore")).toBe("表格恢复进行中");
    expect(getMigrationOperationStatusLabel("zip_export")).toBe("导出进行中");
    expect(getMigrationOperationStatusLabel("zip_import")).toBe("恢复进行中");
  });
});

describe("迁移锁与模型调用锁双向互斥", () => {
  it("模型调用进行中时迁移 begin 被阻塞", () => {
    const { modelCall, migration } = createLinkedStores();
    modelCall.beginModelCall(REFINEMENT_CALL);

    const result = migration.beginMigrationOperation("table_backup");
    expect(result.status).toBe("blocked");
    if (result.status === "blocked") {
      expect(result.reason).toBe("model_call");
    }
    expect(migration.getSnapshot()).toBeNull();
  });

  it("迁移进行中时模型调用 begin 被阻塞", () => {
    const { modelCall, migration } = createLinkedStores();
    migration.beginMigrationOperation("table_backup");

    const result = modelCall.beginModelCall(REFINEMENT_CALL);
    expect(result.status).toBe("blocked");
    if (result.status === "blocked") {
      expect(result.reason).toBe("migration");
    }
    expect(modelCall.getSnapshot()).toBeNull();
  });

  it("一方释放后另一方可获取", () => {
    const { modelCall, migration } = createLinkedStores();
    const acquired = migration.beginMigrationOperation("table_backup");
    if (acquired.status !== "acquired") {
      throw new Error("expected acquired");
    }
    // 迁移占用期间模型调用被挡
    expect(modelCall.beginModelCall(REFINEMENT_CALL).status).toBe("blocked");

    migration.endMigrationOperation(acquired.operation.id);
    expect(modelCall.beginModelCall(REFINEMENT_CALL).status).toBe("started");
  });
});
