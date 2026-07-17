import { describe, expect, it } from "vitest";

import { createMemoryFeishuPersonalBaseTokenCredentialAdapter } from "../storage";
import {
  BASE_FIELD_TYPE_TEXT,
  BaseApiError,
  type BaseApiClient,
  type BaseTableSummary,
  type CreateTableFieldSpec,
} from "./base-api-client";
import { createInMemoryBase, type InMemoryBase } from "./fake-base-api";
import {
  createMemoryTableBackupStateStore,
  createTableBackupConnectionRepository,
} from "./connection-repository";
import { buildBackupTableFields } from "./field-contract";
import {
  BACKUP_BINDING_MARKER_PREFIX,
  buildBackupBindingMarkerField,
} from "./table-binding-marker";
import {
  inspectTableCandidate,
  listTablesForResolution,
  resolveTableForBackup,
} from "./table-resolver";

const BINDING_ID = "550e8400-e29b-41d4-a716-446655440000";
const OTHER_BINDING_ID = "018f47a5-4f45-7bb1-8000-123456789abc";

function seedCandidate(
  base: InMemoryBase,
  name: string,
  fields: CreateTableFieldSpec[],
): BaseTableSummary {
  return { table_id: base.seedTable(name, fields), name };
}

async function createConnection(tableId: string | null) {
  const repository = createTableBackupConnectionRepository({
    store: createMemoryTableBackupStateStore(),
    credentials: createMemoryFeishuPersonalBaseTokenCredentialAdapter(),
    now: () => "2026-07-17T00:00:00.000Z",
    generateBindingId: () => BINDING_ID,
  });
  await repository.save({ appToken: "bascnApp", token: "pt-secret" });
  if (tableId) {
    await repository.setBackupTableId(tableId);
  }
  return repository;
}

describe("inspectTableCandidate", () => {
  it.each([
    { count: 7, kind: "legacy7" },
    { count: 8, kind: "partial8_9" },
    { count: 9, kind: "partial8_9" },
    { count: 10, kind: "current10" },
  ] as const)("将 $count 字段旧表分类为 $kind", async ({ count, kind }) => {
    const base = createInMemoryBase();
    const table = seedCandidate(
      base,
      `candidate-${count}`,
      buildBackupTableFields().slice(0, count),
    );

    await expect(inspectTableCandidate(base.client, table)).resolves.toMatchObject({
      kind,
      bindingId: null,
      mismatchedFieldNames: [],
    });
    expect(base.callCounts.createField).toBe(0);
  });

  it("忽略额外用户字段，仍把完整无 marker 表视为 current10", async () => {
    const base = createInMemoryBase();
    const table = seedCandidate(base, "with-extra", [
      ...buildBackupTableFields(),
      { field_name: "分类", type: BASE_FIELD_TYPE_TEXT },
    ]);

    await expect(inspectTableCandidate(base.client, table)).resolves.toMatchObject({
      kind: "current10",
      missingFieldNames: [],
      mismatchedFieldNames: [],
    });
  });

  it("原七字段缺失或任一契约字段类型错误时不认领", async () => {
    const base = createInMemoryBase();
    const missingRequired = seedCandidate(
      base,
      "missing-required",
      buildBackupTableFields().filter((field) => field.field_name !== "模板正文"),
    );
    const wrongType = seedCandidate(base, "wrong-type", buildBackupTableFields());
    base.setFieldType(wrongType.table_id, "版本", 99);

    await expect(
      inspectTableCandidate(base.client, missingRequired),
    ).resolves.toMatchObject({
      kind: "incompatible",
      missingFieldNames: ["模板正文"],
    });
    await expect(inspectTableCandidate(base.client, wrongType)).resolves.toMatchObject({
      kind: "incompatible",
      mismatchedFieldNames: ["版本"],
    });
    expect(base.callCounts.createField).toBe(0);
  });

  it("区分 matching 与 other v1 binding", async () => {
    const base = createInMemoryBase();
    const matching = seedCandidate(base, "matching", [
      ...buildBackupTableFields(),
      buildBackupBindingMarkerField(BINDING_ID),
    ]);
    const other = seedCandidate(base, "other", [
      ...buildBackupTableFields(),
      buildBackupBindingMarkerField(OTHER_BINDING_ID),
    ]);

    await expect(
      inspectTableCandidate(base.client, matching, {
        expectedBindingId: BINDING_ID,
      }),
    ).resolves.toMatchObject({ kind: "managed_matching", bindingId: BINDING_ID });
    await expect(
      inspectTableCandidate(base.client, other, {
        expectedBindingId: BINDING_ID,
      }),
    ).resolves.toMatchObject({ kind: "managed_other", bindingId: OTHER_BINDING_ID });
  });

  it("未来 marker 阻止写入，多 marker 返回歧义", async () => {
    const base = createInMemoryBase();
    const future = seedCandidate(base, "future", [
      ...buildBackupTableFields(),
      {
        field_name: `${BACKUP_BINDING_MARKER_PREFIX}2__${BINDING_ID}`,
        type: BASE_FIELD_TYPE_TEXT,
      },
    ]);
    const ambiguous = seedCandidate(base, "ambiguous", [
      ...buildBackupTableFields(),
      buildBackupBindingMarkerField(BINDING_ID),
      buildBackupBindingMarkerField(OTHER_BINDING_ID),
    ]);

    await expect(inspectTableCandidate(base.client, future)).resolves.toMatchObject({
      kind: "future_managed",
      bindingId: BINDING_ID,
    });
    await expect(
      inspectTableCandidate(base.client, ambiguous),
    ).resolves.toMatchObject({ kind: "ambiguous" });
  });

  it("分页读取全部数据表和字段", async () => {
    const base = createInMemoryBase({ tablePageSize: 1, fieldPageSize: 2 });
    const first = seedCandidate(base, "first", buildBackupTableFields());
    seedCandidate(base, "second", buildBackupTableFields());

    const tables = await listTablesForResolution(base.client);
    const inspection = await inspectTableCandidate(base.client, first);

    expect(tables.map((table) => table.name)).toEqual(["first", "second"]);
    expect(inspection.fields).toHaveLength(10);
    expect(base.callCounts.listTables).toBe(2);
    expect(base.callCounts.listFields).toBe(5);
  });

  it("分页缺 token 或重复 token 时 fail closed", async () => {
    const missingTokenClient: Pick<BaseApiClient, "listTables"> = {
      async listTables() {
        return { items: [], pageToken: null, hasMore: true };
      },
    };
    let calls = 0;
    const repeatedTokenClient: Pick<BaseApiClient, "listTables"> = {
      async listTables() {
        calls += 1;
        return { items: [], pageToken: "same", hasMore: true };
      },
    };

    await expect(listTablesForResolution(missingTokenClient)).rejects.toMatchObject({
      kind: "invalid_response",
    } satisfies Partial<BaseApiError>);
    await expect(listTablesForResolution(repeatedTokenClient)).rejects.toMatchObject({
      kind: "invalid_response",
    } satisfies Partial<BaseApiError>);
    expect(calls).toBe(2);
  });
});

describe("resolveTableForBackup 已保存 ID", () => {
  it("有效 ID 直接使用，不扫描数据表也不建表，远端重命名不影响", async () => {
    const base = createInMemoryBase();
    const tableId = base.seedTable("before", buildBackupTableFields());
    const connection = await createConnection(tableId);
    base.renameTable(tableId, "renamed");

    await expect(
      resolveTableForBackup({ client: base.client, connection }),
    ).resolves.toEqual({ status: "ready", tableId, recovered: false });
    expect(base.callCounts.listFields).toBe(1);
    expect(base.callCounts.listTables).toBe(0);
    expect(base.callCounts.createTable).toBe(0);
  });

  it("仅明确 1254041 返回 not_found，且保留本地 ID、不立即建表", async () => {
    const base = createInMemoryBase();
    const tableId = base.seedTable("gone", buildBackupTableFields());
    const connection = await createConnection(tableId);
    base.dropTable(tableId);

    await expect(
      resolveTableForBackup({ client: base.client, connection }),
    ).resolves.toEqual({ status: "not_found" });
    expect((await connection.get())?.backupTableId).toBe(tableId);
    expect(base.callCounts.listTables).toBe(0);
    expect(base.callCounts.createTable).toBe(0);
  });

  it.each([
    { kind: "timeout", code: null },
    { kind: "forbidden", code: null },
    { kind: "not_ready", code: 1254607 },
    { kind: "field_not_found", code: 1254045 },
  ] as const)(
    "$kind 不清 ID、不扫描且不建新表",
    async ({ kind, code }) => {
      const base = createInMemoryBase();
      const tableId = base.seedTable("stored", buildBackupTableFields());
      const connection = await createConnection(tableId);
      const client: BaseApiClient = {
        ...base.client,
        async listFields() {
          throw new BaseApiError(kind, code, `模拟 ${kind}`);
        },
      };

      const result = await resolveTableForBackup({ client, connection });

      expect(result).toMatchObject({
        status: "failed",
        error: { kind: "stored_table_unavailable" },
      });
      expect((await connection.get())?.backupTableId).toBe(tableId);
      expect(base.callCounts.listTables).toBe(0);
      expect(base.callCounts.createTable).toBe(0);
    },
  );
});
