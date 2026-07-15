import { describe, expect, it } from "vitest";

import { createMemoryFeishuPersonalBaseTokenCredentialAdapter } from "../storage";
import type { PersonalPromptdexEntry } from "../promptdex/personal-entry-repository";
import { runBackup, type RunBackupOptions } from "./backup-service";
import {
  createMemoryTableBackupStateStore,
  createTableBackupConnectionRepository,
  type TableBackupConnectionRepository,
} from "./connection-repository";
import { createInMemoryBase, type InMemoryBase } from "./fake-base-api";
import { entryToBackupFields } from "./field-contract";
import { createMigrationLockStore } from "./migration-lock";

function makeEntry(
  name: string,
  overrides: Partial<PersonalPromptdexEntry> = {},
): PersonalPromptdexEntry {
  return {
    name,
    description: "示例",
    inputs: { subject: { required: true, description: "主体" } },
    body: `body-${name}`,
    fileName: `${name}.md`,
    taskType: "generate",
    sourceType: "personal",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

interface Harness {
  base: InMemoryBase;
  connection: TableBackupConnectionRepository;
  entries: PersonalPromptdexEntry[];
  run: (extra?: Partial<RunBackupOptions>) => ReturnType<typeof runBackup>;
}

async function createHarness(): Promise<Harness> {
  const base = createInMemoryBase();
  const connection = createTableBackupConnectionRepository({
    store: createMemoryTableBackupStateStore(),
    credentials: createMemoryFeishuPersonalBaseTokenCredentialAdapter(),
    now: () => "2026-07-15T00:00:00.000Z",
  });
  await connection.save({ appToken: "bascnApp", token: "pt-secret" });

  const harness: Harness = {
    base,
    connection,
    entries: [],
    run: (extra = {}) =>
      runBackup({
        connection,
        entries: { list: async () => harness.entries },
        createClient: () => base.client,
        migrationLock: createMigrationLockStore(),
        now: () => "2026-07-15T12:00:00.000Z",
        ...extra,
      }),
  };
  return harness;
}

describe("runBackup 镜像引擎", () => {
  it("首次备份建表并写入全部条目", async () => {
    const harness = await createHarness();
    harness.entries = [makeEntry("alpha"), makeEntry("beta")];

    const result = await harness.run();
    expect(result.status).toBe("succeeded");
    if (result.status !== "succeeded") return;
    expect(result.summary).toEqual({ created: 2, updated: 0, deleted: 0, skipped: 0 });
    expect(result.succeededAt).toBe("2026-07-15T12:00:00.000Z");

    const connection = await harness.connection.get();
    expect(connection?.backupTableId).toBeTruthy();
    expect(connection?.lastBackupSucceededAt).toBe("2026-07-15T12:00:00.000Z");

    const tableId = connection!.backupTableId!;
    const stored = harness.base.listRecordFields(tableId);
    expect(stored).toContainEqual(entryToBackupFields(makeEntry("alpha")));
    expect(stored).toContainEqual(entryToBackupFields(makeEntry("beta")));
  });

  it("无改动再备份幂等不产生写调用", async () => {
    const harness = await createHarness();
    harness.entries = [makeEntry("alpha"), makeEntry("beta")];
    await harness.run();
    const createsBefore = harness.base.callCounts.batchCreate;

    const result = await harness.run();
    expect(result.status).toBe("succeeded");
    if (result.status !== "succeeded") return;
    expect(result.summary).toEqual({ created: 0, updated: 0, deleted: 0, skipped: 2 });
    expect(harness.base.callCounts.batchCreate).toBe(createsBefore);
    expect(harness.base.callCounts.batchUpdate).toBe(0);
    expect(harness.base.callCounts.batchDelete).toBe(0);
  });

  it("本机改动触发 update", async () => {
    const harness = await createHarness();
    harness.entries = [makeEntry("alpha")];
    await harness.run();

    harness.entries = [makeEntry("alpha", { body: "改过的正文" })];
    const result = await harness.run();
    expect(result.status).toBe("succeeded");
    if (result.status !== "succeeded") return;
    expect(result.summary).toEqual({ created: 0, updated: 1, deleted: 0, skipped: 0 });

    const tableId = (await harness.connection.get())!.backupTableId!;
    expect(harness.base.listRecordFields(tableId)[0]["模板正文"]).toBe("改过的正文");
  });

  it("本机删除触发 delete", async () => {
    const harness = await createHarness();
    harness.entries = [makeEntry("alpha"), makeEntry("beta")];
    await harness.run();

    harness.entries = [makeEntry("alpha")];
    const result = await harness.run();
    expect(result.status).toBe("succeeded");
    if (result.status !== "succeeded") return;
    expect(result.summary).toEqual({ created: 0, updated: 0, deleted: 1, skipped: 1 });

    const tableId = (await harness.connection.get())!.backupTableId!;
    expect(harness.base.listRecordFields(tableId)).toHaveLength(1);
  });

  it("表格同名多条记录仅保留第一条其余删除", async () => {
    const harness = await createHarness();
    harness.entries = [makeEntry("alpha"), makeEntry("beta")];
    await harness.run();
    const tableId = (await harness.connection.get())!.backupTableId!;
    harness.base.seedRecord(tableId, entryToBackupFields(makeEntry("alpha")));

    const result = await harness.run();
    expect(result.status).toBe("succeeded");
    if (result.status !== "succeeded") return;
    expect(result.summary.deleted).toBe(1);
    expect(harness.base.listRecordFields(tableId)).toHaveLength(2);
  });

  it("契约字段类型不符时失败", async () => {
    const harness = await createHarness();
    harness.entries = [makeEntry("alpha")];
    await harness.run();
    const tableId = (await harness.connection.get())!.backupTableId!;
    harness.base.setFieldType(tableId, "模板正文", 99);

    const result = await harness.run();
    expect(result.status).toBe("failed");
    if (result.status !== "failed") return;
    expect(result.message).toContain("模板正文");
  });

  it("表格被删后自动重建", async () => {
    const harness = await createHarness();
    harness.entries = [makeEntry("alpha")];
    await harness.run();
    const oldTableId = (await harness.connection.get())!.backupTableId!;
    harness.base.dropTable(oldTableId);

    const result = await harness.run();
    expect(result.status).toBe("succeeded");
    const newTableId = (await harness.connection.get())!.backupTableId!;
    expect(newTableId).not.toBe(oldTableId);
    expect(harness.base.listRecordFields(newTableId)).toHaveLength(1);
  });

  it("未配置连接时返回 not_configured", async () => {
    const base = createInMemoryBase();
    const connection = createTableBackupConnectionRepository({
      store: createMemoryTableBackupStateStore(),
      credentials: createMemoryFeishuPersonalBaseTokenCredentialAdapter(),
    });
    const result = await runBackup({
      connection,
      entries: { list: async () => [] },
      createClient: () => base.client,
      migrationLock: createMigrationLockStore(),
    });
    expect(result.status).toBe("not_configured");
  });

  it("迁移锁被占用时返回 blocked", async () => {
    const harness = await createHarness();
    harness.entries = [makeEntry("alpha")];
    const lock = createMigrationLockStore();
    lock.beginMigrationOperation("table_restore");

    const result = await harness.run({ migrationLock: lock });
    expect(result).toEqual({ status: "blocked", reason: "migration" });
  });

  it("信号取消时返回 cancelled 且不更新成功时间", async () => {
    const harness = await createHarness();
    harness.entries = [makeEntry("alpha")];
    await harness.run();

    const controller = new AbortController();
    controller.abort();
    const result = await harness.run({ signal: controller.signal });
    expect(result.status).toBe("cancelled");
    // 上次成功时间保留，本次取消不刷新（时间戳仍为首次成功值）
    expect((await harness.connection.get())?.lastBackupSucceededAt).toBe(
      "2026-07-15T12:00:00.000Z",
    );
  });
});
