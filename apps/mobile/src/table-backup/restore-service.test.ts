import { describe, expect, it } from "vitest";

import { createMemoryFeishuPersonalBaseTokenCredentialAdapter } from "../storage";
import type { PersonalPromptdexEntry } from "../promptdex/personal-entry-repository";
import type { BaseRecord } from "./base-api-client";
import {
  createMemoryTableBackupStateStore,
  createTableBackupConnectionRepository,
} from "./connection-repository";
import {
  createMemoryPersonalPromptdexEntryStore,
  createPersonalPromptdexEntryRepository,
} from "../promptdex/personal-entry-repository";
import { createInMemoryBase } from "./fake-base-api";
import { buildBackupTableFields, entryToBackupFields } from "./field-contract";
import { createMigrationLockStore } from "./migration-lock";
import {
  classifyRestoreRecords,
  runRestoreCommit,
  runRestorePreflight,
  type RestoreValidRecord,
} from "./restore-service";

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
    updatedAt: "2026-07-02T00:00:00.000Z",
    ...overrides,
  };
}

function record(fields: Record<string, unknown>, id = "rec"): BaseRecord {
  return { record_id: id, fields };
}

describe("classifyRestoreRecords", () => {
  it("按本机是否已有区分新增与覆盖", () => {
    const records = [
      record(entryToBackupFields(makeEntry("alpha")), "r1"),
      record(entryToBackupFields(makeEntry("beta")), "r2"),
    ];
    const result = classifyRestoreRecords(records, new Set(["beta"]));
    expect(result.additions.map((r) => r.name)).toEqual(["alpha"]);
    expect(result.overwrites.map((r) => r.name)).toEqual(["beta"]);
    expect(result.invalid).toEqual([]);
  });

  it("保留表格记录的时间戳", () => {
    const records = [record(entryToBackupFields(makeEntry("alpha")), "r1")];
    const { additions } = classifyRestoreRecords(records, new Set());
    expect(additions[0].createdAt).toBe("2026-07-01T00:00:00.000Z");
    expect(additions[0].updatedAt).toBe("2026-07-02T00:00:00.000Z");
  });

  it("校验失败的记录列入非法并附原因", () => {
    const broken = { ...entryToBackupFields(makeEntry("alpha")), 输入声明JSON: "{坏" };
    const result = classifyRestoreRecords([record(broken, "r1")], new Set());
    expect(result.additions).toEqual([]);
    expect(result.invalid).toHaveLength(1);
    expect(result.invalid[0].reason).toContain("输入声明JSON");
  });

  it("名称格式非法列入非法", () => {
    const bad = { ...entryToBackupFields(makeEntry("alpha")), 名称: "小恐龙" };
    const result = classifyRestoreRecords([record(bad, "r1")], new Set());
    expect(result.invalid).toHaveLength(1);
    expect(result.additions).toEqual([]);
  });

  it("同名多条记录全部列入非法", () => {
    const records = [
      record(entryToBackupFields(makeEntry("alpha")), "r1"),
      record(entryToBackupFields(makeEntry("alpha", { body: "另一份" })), "r2"),
    ];
    const result = classifyRestoreRecords(records, new Set());
    expect(result.additions).toEqual([]);
    expect(result.overwrites).toEqual([]);
    expect(result.invalid).toHaveLength(2);
    expect(result.invalid.every((r) => r.reason.includes("同名多条"))).toBe(true);
  });
});

describe("runRestorePreflight", () => {
  async function createHarness() {
    const base = createInMemoryBase();
    const tableId = base.seedTable("Imagemon 图鉴备份", buildBackupTableFields());
    const connection = createTableBackupConnectionRepository({
      store: createMemoryTableBackupStateStore(),
      credentials: createMemoryFeishuPersonalBaseTokenCredentialAdapter(),
      now: () => "2026-07-15T00:00:00.000Z",
    });
    await connection.save({ appToken: "bascnApp", token: "pt-secret" });
    await connection.setBackupTableId(tableId);
    return { base, tableId, connection };
  }

  it("拉取记录并生成新增/覆盖/非法预检", async () => {
    const { base, tableId, connection } = await createHarness();
    base.seedRecord(tableId, entryToBackupFields(makeEntry("alpha")));
    base.seedRecord(tableId, entryToBackupFields(makeEntry("beta")));
    base.seedRecord(tableId, {
      ...entryToBackupFields(makeEntry("gamma")),
      输入声明JSON: "{坏",
    });

    const result = await runRestorePreflight({
      connection,
      existingNames: async () => new Set(["beta"]),
      createClient: () => base.client,
      migrationLock: createMigrationLockStore(),
    });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.preflight.additions.map((r) => r.name)).toEqual(["alpha"]);
    expect(result.preflight.overwrites.map((r) => r.name)).toEqual(["beta"]);
    expect(result.preflight.invalid).toHaveLength(1);
  });

  it("未配置备份表时返回 not_configured", async () => {
    const base = createInMemoryBase();
    const connection = createTableBackupConnectionRepository({
      store: createMemoryTableBackupStateStore(),
      credentials: createMemoryFeishuPersonalBaseTokenCredentialAdapter(),
    });
    await connection.save({ appToken: "bascnApp", token: "pt" });
    const result = await runRestorePreflight({
      connection,
      existingNames: async () => new Set(),
      createClient: () => base.client,
      migrationLock: createMigrationLockStore(),
    });
    expect(result.status).toBe("not_configured");
  });

  it("字段契约不满足时失败", async () => {
    const { base, tableId, connection } = await createHarness();
    base.removeField(tableId, "模板正文");
    const result = await runRestorePreflight({
      connection,
      existingNames: async () => new Set(),
      createClient: () => base.client,
      migrationLock: createMigrationLockStore(),
    });
    expect(result.status).toBe("failed");
    if (result.status !== "failed") return;
    expect(result.message).toContain("模板正文");
  });

  it("迁移锁被占用时返回 blocked", async () => {
    const { base, connection } = await createHarness();
    const lock = createMigrationLockStore();
    lock.beginMigrationOperation("table_backup");
    const result = await runRestorePreflight({
      connection,
      existingNames: async () => new Set(),
      createClient: () => base.client,
      migrationLock: lock,
    });
    expect(result).toEqual({ status: "blocked", reason: "migration" });
  });
});

describe("runRestoreCommit", () => {
  function validRecord(
    name: string,
    kind: RestoreValidRecord["kind"],
  ): RestoreValidRecord {
    const entry = makeEntry(name);
    return {
      name,
      template: {
        name: entry.name,
        description: entry.description,
        inputs: entry.inputs,
        body: entry.body,
        fileName: entry.fileName,
        taskType: entry.taskType,
      },
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      kind,
    };
  }

  it("确认后单事务写入并返回写入条数", async () => {
    const repo = createPersonalPromptdexEntryRepository({
      store: createMemoryPersonalPromptdexEntryStore(),
    });
    const result = await runRestoreCommit({
      entries: repo,
      records: [validRecord("alpha", "addition"), validRecord("beta", "addition")],
      migrationLock: createMigrationLockStore(),
    });
    expect(result).toEqual({ status: "succeeded", restored: 2 });
    await expect(repo.get("alpha")).resolves.not.toBeNull();
    expect((await repo.get("alpha"))?.createdAt).toBe("2026-07-01T00:00:00.000Z");
  });

  it("迁移锁被占用时返回 blocked 且不写入", async () => {
    const repo = createPersonalPromptdexEntryRepository({
      store: createMemoryPersonalPromptdexEntryStore(),
    });
    const lock = createMigrationLockStore();
    lock.beginMigrationOperation("table_backup");
    const result = await runRestoreCommit({
      entries: repo,
      records: [validRecord("alpha", "addition")],
      migrationLock: lock,
    });
    expect(result).toEqual({ status: "blocked", reason: "migration" });
    await expect(repo.get("alpha")).resolves.toBeNull();
  });

  it("写入抛错时归一为 failed", async () => {
    const result = await runRestoreCommit({
      entries: {
        async replaceFromRestore() {
          throw new Error("事务失败");
        },
      },
      records: [validRecord("alpha", "addition")],
      migrationLock: createMigrationLockStore(),
    });
    expect(result).toEqual({ status: "failed", message: "事务失败" });
  });
});
