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
import { buildBackupBindingMarkerField } from "./table-binding-marker";
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

function backupFields(
  entry: PersonalPromptdexEntry,
  displayImageId = "",
): Record<string, string> {
  return entryToBackupFields({ ...entry, displayImageId });
}

function legacyBackupFields(entry: PersonalPromptdexEntry): Record<string, string> {
  const { 来源类型: _sourceType, 展示图标识: _displayImageId, ...legacy } =
    backupFields(entry);
  return legacy;
}

describe("classifyRestoreRecords", () => {
  it("按本机是否已有区分新增与覆盖", () => {
    const records = [
      record(backupFields(makeEntry("alpha")), "r1"),
      record(backupFields(makeEntry("beta")), "r2"),
    ];
    const result = classifyRestoreRecords(records, new Set(["beta"]));
    expect(result.additions.map((r) => r.name)).toEqual(["alpha"]);
    expect(result.overwrites.map((r) => r.name)).toEqual(["beta"]);
    expect(result.invalid).toEqual([]);
    expect(result.builtInRecords).toEqual([]);
  });

  it("保留表格记录的时间戳", () => {
    const records = [record(backupFields(makeEntry("alpha")), "r1")];
    const { additions } = classifyRestoreRecords(records, new Set());
    expect(additions[0].createdAt).toBe("2026-07-01T00:00:00.000Z");
    expect(additions[0].updatedAt).toBe("2026-07-02T00:00:00.000Z");
  });

  it("校验失败的记录列入非法并附原因", () => {
    const broken = { ...backupFields(makeEntry("alpha")), 输入声明JSON: "{坏" };
    const result = classifyRestoreRecords([record(broken, "r1")], new Set());
    expect(result.additions).toEqual([]);
    expect(result.invalid).toHaveLength(1);
    expect(result.invalid[0].reason).toContain("输入声明JSON");
  });

  it("名称格式非法列入非法", () => {
    const bad = { ...backupFields(makeEntry("alpha")), 名称: "小恐龙" };
    const result = classifyRestoreRecords([record(bad, "r1")], new Set());
    expect(result.invalid).toHaveLength(1);
    expect(result.additions).toEqual([]);
  });

  it("同名多条记录全部列入非法", () => {
    const records = [
      record(backupFields(makeEntry("alpha")), "r1"),
      record(backupFields(makeEntry("alpha", { body: "另一份" })), "r2"),
    ];
    const result = classifyRestoreRecords(records, new Set());
    expect(result.additions).toEqual([]);
    expect(result.overwrites).toEqual([]);
    expect(result.invalid).toHaveLength(2);
    expect(result.invalid.every((r) => r.reason.includes("同名多条"))).toBe(true);
  });

  it("内置记录独立分类，不与同名 personal 记录互相判重", () => {
    const personal = backupFields(makeEntry("alpha"));
    const builtIn = { ...backupFields(makeEntry("alpha")), 来源类型: "built-in" };
    const result = classifyRestoreRecords(
      [record(personal, "personal"), record(builtIn, "built-in")],
      new Set(),
    );

    expect(result.additions.map((item) => item.name)).toEqual(["alpha"]);
    expect(result.overwrites).toEqual([]);
    expect(result.invalid).toEqual([]);
    expect(result.builtInRecords).toEqual([{ name: "alpha" }]);
  });

  it("空串或未知来源类型列入非法并明示原因", () => {
    const result = classifyRestoreRecords(
      [
        record({ ...backupFields(makeEntry("alpha")), 来源类型: "" }, "r1"),
        record(
          { ...backupFields(makeEntry("beta")), 来源类型: "external" },
          "r2",
        ),
      ],
      new Set(),
    );

    expect(result.additions).toEqual([]);
    expect(result.overwrites).toEqual([]);
    expect(result.builtInRecords).toEqual([]);
    expect(result.invalid.map((item) => item.reason)).toEqual([
      "来源类型无法识别。",
      "来源类型无法识别。",
    ]);
  });

  it("旧契约表缺少来源类型时整表按 personal 处理", () => {
    const result = classifyRestoreRecords(
      [record(legacyBackupFields(makeEntry("alpha")), "r1")],
      new Set(),
      { sourceTypeFieldPresent: false },
    );

    expect(result.additions.map((item) => item.name)).toEqual(["alpha"]);
    expect(result.invalid).toEqual([]);
    expect(result.builtInRecords).toEqual([]);
  });
});

describe("runRestorePreflight", () => {
  const bindingId = "550e8400-e29b-41d4-a716-446655440000";

  async function createHarness(
    options: { legacyContract?: boolean; bindTable?: boolean } = {},
  ) {
    const base = createInMemoryBase();
    const fields = buildBackupTableFields();
    const tableId = base.seedTable(
      "Imagemon 图鉴备份",
      options.legacyContract ? fields.slice(0, 7) : fields,
    );
    const connection = createTableBackupConnectionRepository({
      store: createMemoryTableBackupStateStore(),
      credentials: createMemoryFeishuPersonalBaseTokenCredentialAdapter(),
      now: () => "2026-07-15T00:00:00.000Z",
      generateBindingId: () => bindingId,
    });
    await connection.save({ appToken: "bascnApp", token: "pt-secret" });
    if (options.bindTable !== false) {
      await connection.setBackupTableId(tableId);
    }
    return { base, tableId, connection };
  }

  it("拉取记录并生成新增/覆盖/非法/内置四类预检", async () => {
    const { base, tableId, connection } = await createHarness();
    base.seedRecord(tableId, backupFields(makeEntry("alpha")));
    base.seedRecord(tableId, backupFields(makeEntry("beta")));
    base.seedRecord(tableId, {
      ...backupFields(makeEntry("gamma")),
      输入声明JSON: "{坏",
    });
    base.seedRecord(tableId, {
      ...backupFields(makeEntry("built-in-entry")),
      来源类型: "built-in",
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
    expect(result.preflight.builtInRecords).toEqual([{ name: "built-in-entry" }]);
  });

  it("旧七字段契约表可恢复且全部按 personal 处理", async () => {
    const { base, tableId, connection } = await createHarness({
      legacyContract: true,
    });
    base.seedRecord(tableId, legacyBackupFields(makeEntry("alpha")));

    const result = await runRestorePreflight({
      connection,
      existingNames: async () => new Set(),
      createClient: () => base.client,
      migrationLock: createMigrationLockStore(),
    });

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.preflight.additions.map((item) => item.name)).toEqual(["alpha"]);
    expect(result.preflight.invalid).toEqual([]);
    expect(result.preflight.builtInRecords).toEqual([]);
  });

  it("已配置连接但未发现远端目标时返回 not_found", async () => {
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
    expect(result.status).toBe("not_found");
  });

  it("只有连接或凭据缺失时返回 not_configured", async () => {
    const base = createInMemoryBase();
    const connection = createTableBackupConnectionRepository({
      store: createMemoryTableBackupStateStore(),
      credentials: createMemoryFeishuPersonalBaseTokenCredentialAdapter(),
    });

    const result = await runRestorePreflight({
      connection,
      existingNames: async () => new Set(),
      createClient: () => base.client,
      migrationLock: createMigrationLockStore(),
    });

    expect(result).toEqual({ status: "not_configured" });
  });

  it("新设备发现旧表时返回候选且不读取记录或本机名称", async () => {
    const { base, connection } = await createHarness({
      legacyContract: true,
      bindTable: false,
    });
    let existingNameReads = 0;

    const result = await runRestorePreflight({
      connection,
      existingNames: async () => {
        existingNameReads += 1;
        return new Set();
      },
      createClient: () => base.client,
      migrationLock: createMigrationLockStore(),
    });

    expect(result).toMatchObject({
      status: "needs_table_choice",
      appToken: "bascnApp",
    });
    expect(existingNameReads).toBe(0);
    expect(base.callCounts.listRecords).toBe(0);
    expect(base.callCounts.createField).toBe(0);
  });

  it("显式选择旧表后生成预检但不保存为备份目标", async () => {
    const { base, tableId, connection } = await createHarness({
      legacyContract: true,
      bindTable: false,
    });
    base.seedRecord(tableId, legacyBackupFields(makeEntry("alpha")));

    const result = await runRestorePreflight({
      connection,
      existingNames: async () => new Set(),
      createClient: () => base.client,
      migrationLock: createMigrationLockStore(),
      selection: { expectedAppToken: "bascnApp", tableId },
    });

    expect(result).toMatchObject({
      status: "ready",
      tableId,
      preflight: { additions: [{ name: "alpha" }] },
    });
    expect(await connection.get()).toMatchObject({
      backupTableId: null,
      backupBindingId: null,
    });
    expect(base.callCounts.createField).toBe(0);
    expect(base.callCounts.createTable).toBe(0);
  });

  it("唯一 matching marker 可找回 table ID 后继续只读预检", async () => {
    const base = createInMemoryBase();
    const tableId = base.seedTable("renamed", [
      ...buildBackupTableFields(),
      buildBackupBindingMarkerField(bindingId),
    ]);
    base.seedRecord(tableId, backupFields(makeEntry("alpha")));
    const connection = createTableBackupConnectionRepository({
      store: createMemoryTableBackupStateStore(),
      credentials: createMemoryFeishuPersonalBaseTokenCredentialAdapter(),
      generateBindingId: () => bindingId,
    });
    await connection.save({ appToken: "bascnApp", token: "pt-secret" });
    await connection.ensureBackupBindingId("bascnApp");

    const result = await runRestorePreflight({
      connection,
      existingNames: async () => new Set(),
      createClient: () => base.client,
      migrationLock: createMigrationLockStore(),
    });

    expect(result).toMatchObject({ status: "ready", tableId });
    expect((await connection.get())?.backupTableId).toBe(tableId);
    expect(base.callCounts.createField).toBe(0);
  });

  it("显式候选在选择后变为不兼容时不读记录", async () => {
    const { base, tableId, connection } = await createHarness({ bindTable: false });
    base.removeField(tableId, "模板正文");
    let existingNameReads = 0;

    const result = await runRestorePreflight({
      connection,
      existingNames: async () => {
        existingNameReads += 1;
        return new Set();
      },
      createClient: () => base.client,
      migrationLock: createMigrationLockStore(),
      selection: { expectedAppToken: "bascnApp", tableId },
    });

    expect(result).toMatchObject({ status: "failed" });
    expect(existingNameReads).toBe(0);
    expect(base.callCounts.listRecords).toBe(0);
    expect(base.callCounts.createField).toBe(0);
  });

  it("解析候选期间取消时返回 cancelled", async () => {
    const { base, connection } = await createHarness({ bindTable: false });
    const controller = new AbortController();
    controller.abort();

    const result = await runRestorePreflight({
      connection,
      existingNames: async () => new Set(),
      createClient: () => base.client,
      migrationLock: createMigrationLockStore(),
      signal: controller.signal,
    });

    expect(result).toEqual({ status: "cancelled" });
    expect(base.callCounts.listTables).toBe(0);
    expect(base.callCounts.listRecords).toBe(0);
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

  it("只写入预检有效记录，内置记录不进入个人图鉴", async () => {
    const preflight = classifyRestoreRecords(
      [
        record(backupFields(makeEntry("personal-entry")), "personal"),
        record(
          {
            ...backupFields(makeEntry("built-in-entry")),
            来源类型: "built-in",
          },
          "built-in",
        ),
      ],
      new Set(),
    );
    const repo = createPersonalPromptdexEntryRepository({
      store: createMemoryPersonalPromptdexEntryStore(),
    });

    const result = await runRestoreCommit({
      entries: repo,
      records: [...preflight.additions, ...preflight.overwrites],
      migrationLock: createMigrationLockStore(),
    });

    expect(result).toEqual({ status: "succeeded", restored: 1 });
    await expect(repo.get("personal-entry")).resolves.not.toBeNull();
    await expect(repo.get("built-in-entry")).resolves.toBeNull();
    expect(preflight.builtInRecords).toEqual([{ name: "built-in-entry" }]);
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
