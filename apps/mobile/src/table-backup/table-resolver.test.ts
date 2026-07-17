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
  TableBackupConnectionError,
  createMemoryTableBackupStateStore,
  createTableBackupConnectionRepository,
  type TableBackupConnectionRepository,
} from "./connection-repository";
import { BACKUP_TABLE_NAME, buildBackupTableFields } from "./field-contract";
import {
  BACKUP_BINDING_MARKER_PREFIX,
  buildBackupBindingMarkerField,
} from "./table-binding-marker";
import {
  adoptExistingTable,
  createIndependentManagedTable,
  inspectTableCandidate,
  listTablesForResolution,
  resolveTableForBackup as resolveTableForExpectedBase,
  type ResolveTableOptions,
} from "./table-resolver";

const BINDING_ID = "550e8400-e29b-41d4-a716-446655440000";
const OTHER_BINDING_ID = "018f47a5-4f45-7bb1-8000-123456789abc";

function resolveTableForBackup(
  options: Omit<ResolveTableOptions, "expectedAppToken">,
) {
  return resolveTableForExpectedBase({
    ...options,
    expectedAppToken: "bascnApp",
  });
}

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

async function createBoundConnection(tableId: string | null) {
  const repository = await createConnection(null);
  const bindingId = await repository.ensureBackupBindingId("bascnApp");
  if (tableId) {
    await repository.bindBackupTable({
      expectedAppToken: "bascnApp",
      expectedBindingId: bindingId,
      tableId,
    });
  }
  return { repository, bindingId };
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
  it("client 对应的 Base 与当前连接不一致时零远端调用", async () => {
    const base = createInMemoryBase();
    const connection = await createConnection(null);
    await connection.save({ appToken: "bascnOther", token: "pt-other" });

    const result = await resolveTableForExpectedBase({
      client: base.client,
      connection,
      expectedAppToken: "bascnApp",
    });

    expect(result).toMatchObject({
      status: "failed",
      error: { kind: "binding_conflict" },
    });
    expect(base.callCounts.listTables).toBe(0);
    expect(base.callCounts.listFields).toBe(0);
    expect(base.callCounts.createTable).toBe(0);
    expect(base.callCounts.createField).toBe(0);
  });

  it("有效 ID 不扫描或建表，远端重命名不影响，并补本机 binding marker", async () => {
    const base = createInMemoryBase();
    const tableId = base.seedTable("before", buildBackupTableFields());
    const connection = await createConnection(tableId);
    base.renameTable(tableId, "renamed");

    await expect(
      resolveTableForBackup({ client: base.client, connection }),
    ).resolves.toEqual({ status: "ready", tableId, recovered: false });
    expect(base.callCounts.listFields).toBe(2);
    expect(base.callCounts.listTables).toBe(0);
    expect(base.callCounts.createTable).toBe(0);
    expect(base.callCounts.createField).toBe(1);
    expect((await connection.get())?.backupBindingId).toBe(BINDING_ID);
  });

  it("仅明确 1254041 才扫描旧 binding 并创建新目标", async () => {
    const base = createInMemoryBase();
    const tableId = base.seedTable("gone", buildBackupTableFields());
    const connection = await createConnection(tableId);
    base.dropTable(tableId);

    const result = await resolveTableForBackup({ client: base.client, connection });

    expect(result).toMatchObject({ status: "ready", recovered: false });
    expect((await connection.get())?.backupTableId).not.toBe(tableId);
    expect((await connection.get())?.backupBindingId).toBe(BINDING_ID);
    expect(base.callCounts.listTables).toBe(2);
    expect(base.callCounts.createTable).toBe(1);
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

describe("resolveTableForBackup binding 发现", () => {
  it("已知 ID 明确失效后按 marker 找回被重命名的数据表并 CAS 回绑", async () => {
    const base = createInMemoryBase({ tablePageSize: 1, fieldPageSize: 3 });
    const { repository, bindingId } = await createBoundConnection("tbl-missing");
    const recoveredId = base.seedTable("Imagemon 图鉴备份", [
      ...buildBackupTableFields(),
      buildBackupBindingMarkerField(bindingId),
    ]);
    base.renameTable(recoveredId, "使用者改过的名称");

    await expect(
      resolveTableForBackup({ client: base.client, connection: repository }),
    ).resolves.toEqual({
      status: "ready",
      tableId: recoveredId,
      recovered: true,
    });
    expect((await repository.get())?.backupTableId).toBe(recoveredId);
    expect(base.callCounts.createTable).toBe(0);
  });

  it("无 table ID 时自动绑定唯一 matching marker", async () => {
    const base = createInMemoryBase();
    const { repository, bindingId } = await createBoundConnection(null);
    const tableId = base.seedTable("managed", [
      ...buildBackupTableFields(),
      buildBackupBindingMarkerField(bindingId),
    ]);

    await expect(
      resolveTableForBackup({ client: base.client, connection: repository }),
    ).resolves.toEqual({ status: "ready", tableId, recovered: true });
    expect((await repository.get())?.backupTableId).toBe(tableId);
  });

  it("多个表匹配同一 binding 时返回歧义且不按列表顺序绑定", async () => {
    const base = createInMemoryBase();
    const { repository, bindingId } = await createBoundConnection(null);
    for (const name of ["first", "second"]) {
      base.seedTable(name, [
        ...buildBackupTableFields(),
        buildBackupBindingMarkerField(bindingId),
      ]);
    }

    const result = await resolveTableForBackup({
      client: base.client,
      connection: repository,
    });

    expect(result).toMatchObject({
      status: "failed",
      error: { kind: "ambiguous_marker" },
    });
    expect((await repository.get())?.backupTableId).toBeNull();
    expect(base.callCounts.createTable).toBe(0);
  });

  it("任一候选字段读取失败时发现不完整，禁止绑定或创建", async () => {
    const base = createInMemoryBase();
    const { repository } = await createBoundConnection(null);
    base.seedTable("candidate", buildBackupTableFields());
    const client: BaseApiClient = {
      ...base.client,
      async listFields() {
        throw new BaseApiError("timeout", null, "模拟字段分页超时");
      },
    };

    const result = await resolveTableForBackup({ client, connection: repository });

    expect(result).toMatchObject({
      status: "failed",
      error: { kind: "discovery_incomplete", retryable: true },
    });
    expect((await repository.get())?.backupTableId).toBeNull();
    expect(base.callCounts.createTable).toBe(0);
  });
});

describe("resolveTableForBackup 受管表创建与升级", () => {
  it("无远端表时先持久化 binding/pending，再原子创建十字段与 marker", async () => {
    const base = createInMemoryBase();
    const connection = await createConnection(null);

    const result = await resolveTableForBackup({ client: base.client, connection });

    expect(result).toMatchObject({ status: "ready", recovered: false });
    if (result.status !== "ready") return;
    const state = await connection.get();
    expect(state).toMatchObject({
      backupTableId: result.tableId,
      backupBindingId: BINDING_ID,
      pendingTableName: null,
    });
    const fields = await base.client.listFields(result.tableId);
    expect(fields.items).toHaveLength(11);
    expect(fields.items.at(-1)?.field_name).toBe(
      `${BACKUP_BINDING_MARKER_PREFIX}1__${BINDING_ID}`,
    );
    expect(base.callCounts.createTable).toBe(1);
    expect(base.callCounts.createField).toBe(0);
  });

  it("已保存的旧七字段强身份补齐三个字段和 marker", async () => {
    const base = createInMemoryBase();
    const tableId = base.seedTable(
      "legacy",
      buildBackupTableFields().slice(0, 7),
    );
    const connection = await createConnection(tableId);

    await expect(
      resolveTableForBackup({ client: base.client, connection }),
    ).resolves.toEqual({ status: "ready", tableId, recovered: false });
    const fields = await base.client.listFields(tableId);
    expect(fields.items).toHaveLength(11);
    expect(base.callCounts.createField).toBe(4);
  });

  it("强 table ID 已带 v1 marker 时采用远端 binding，不生成冲突 marker", async () => {
    const base = createInMemoryBase();
    const tableId = base.seedTable("managed", [
      ...buildBackupTableFields(),
      buildBackupBindingMarkerField(OTHER_BINDING_ID),
    ]);
    const connection = await createConnection(tableId);

    await expect(
      resolveTableForBackup({ client: base.client, connection }),
    ).resolves.toEqual({ status: "ready", tableId, recovered: false });
    expect((await connection.get())?.backupBindingId).toBe(OTHER_BINDING_ID);
    expect(base.callCounts.createField).toBe(0);
  });

  it("marker 创建已提交但响应超时时，重读确认后继续", async () => {
    const base = createInMemoryBase();
    const tableId = base.seedTable("current", buildBackupTableFields());
    const connection = await createConnection(tableId);
    let injected = false;
    const client: BaseApiClient = {
      ...base.client,
      async createField(targetTableId, field, options) {
        const fieldId = await base.client.createField(targetTableId, field, options);
        if (!injected && field.field_name.startsWith(BACKUP_BINDING_MARKER_PREFIX)) {
          injected = true;
          throw new BaseApiError("timeout", null, "模拟 marker 响应超时");
        }
        return fieldId;
      },
    };

    await expect(
      resolveTableForBackup({ client, connection }),
    ).resolves.toEqual({ status: "ready", tableId, recovered: false });
    expect(injected).toBe(true);
  });
});

describe("resolveTableForBackup 建表结果对账", () => {
  it.each([
    "after_timeout",
    "after_network",
    "after_server_error",
    "missing_response_id",
  ] as const)("%s 后按 marker 找回，且同次运行只 POST 一次", async (fault) => {
    const base = createInMemoryBase({ createTableFaults: [fault] });
    const connection = await createConnection(null);

    const result = await resolveTableForBackup({ client: base.client, connection });

    expect(result).toMatchObject({ status: "ready", recovered: true });
    expect(base.callCounts.createTable).toBe(1);
    expect((await connection.get())?.pendingTableName).toBeNull();
  });

  it("对账首次读取旧快照、第二次可见时仍找回原表", async () => {
    const base = createInMemoryBase({
      createTableFaults: ["after_timeout"],
      createTableVisibilityDelay: 1,
    });
    const connection = await createConnection(null);

    const result = await resolveTableForBackup({ client: base.client, connection });

    expect(result).toMatchObject({ status: "ready", recovered: true });
    expect(base.callCounts.createTable).toBe(1);
    expect(base.callCounts.listTables).toBe(4);
  });

  it("收到 1254013 后找到当前 binding 时绑定抢先创建的同一张表", async () => {
    const base = createInMemoryBase();
    const connection = await createConnection(null);
    const client: BaseApiClient = {
      ...base.client,
      async createTable(input, options) {
        base.seedTable(input.name, input.fields);
        return base.client.createTable(input, options);
      },
    };

    const result = await resolveTableForBackup({ client, connection });

    expect(result).toMatchObject({ status: "ready", recovered: true });
    expect(base.callCounts.createTable).toBe(1);
  });

  it("1254013 后仍无当前 binding 时保留 pending，本次和下次都不重复 POST", async () => {
    const base = createInMemoryBase();
    const connection = await createConnection(null);
    const client: BaseApiClient = {
      ...base.client,
      async createTable(input, options) {
        base.seedTable(input.name, [{ field_name: "外部字段", type: 1 }]);
        return base.client.createTable(input, options);
      },
    };

    const first = await resolveTableForBackup({ client, connection });
    const createsAfterFirst = base.callCounts.createTable;
    const second = await resolveTableForBackup({ client, connection });

    expect(first).toMatchObject({
      status: "failed",
      error: { kind: "table_create_uncertain" },
    });
    expect(second).toMatchObject({
      status: "failed",
      error: { kind: "table_create_uncertain" },
    });
    expect(createsAfterFirst).toBe(1);
    expect(base.callCounts.createTable).toBe(createsAfterFirst);
  });

  it("建表成功但本地绑定保存失败时，下次按 marker 找回", async () => {
    const base = createInMemoryBase();
    const connection = await createConnection(null);
    const failingConnection: TableBackupConnectionRepository = {
      ...connection,
      async bindBackupTable() {
        throw new TableBackupConnectionError("模拟本地绑定保存失败");
      },
    };

    const first = await resolveTableForBackup({
      client: base.client,
      connection: failingConnection,
    });
    const second = await resolveTableForBackup({
      client: base.client,
      connection,
    });

    expect(first).toMatchObject({
      status: "failed",
      error: { kind: "table_create_uncertain" },
    });
    expect(second).toMatchObject({ status: "ready", recovered: true });
    expect(base.callCounts.createTable).toBe(1);
  });

  it("POST 提交后取消时保留 pending，下次先对账找回", async () => {
    const base = createInMemoryBase({ createTableFaults: ["after_cancelled"] });
    const connection = await createConnection(null);

    const first = await resolveTableForBackup({ client: base.client, connection });
    const second = await resolveTableForBackup({ client: base.client, connection });

    expect(first).toMatchObject({
      status: "failed",
      error: { kind: "table_create_uncertain" },
    });
    expect(second).toMatchObject({ status: "ready", recovered: true });
    expect(base.callCounts.createTable).toBe(1);
  });

  it("提交前网络失败未建表时也不在同一次或 pending 重试中盲目 POST", async () => {
    const base = createInMemoryBase({ createTableFaults: ["before_network"] });
    const connection = await createConnection(null);

    const first = await resolveTableForBackup({ client: base.client, connection });
    const second = await resolveTableForBackup({ client: base.client, connection });

    expect(first).toMatchObject({
      status: "failed",
      error: { kind: "table_create_uncertain" },
    });
    expect(second).toMatchObject({
      status: "failed",
      error: { kind: "table_create_uncertain" },
    });
    expect(base.callCounts.createTable).toBe(1);
  });
});

describe("resolveTableForBackup 旧表选择与同名冲突", () => {
  it.each([
    { fields: buildBackupTableFields().slice(0, 7), kind: "legacy7" },
    { fields: buildBackupTableFields().slice(0, 8), kind: "partial8_9" },
    { fields: buildBackupTableFields(), kind: "current10" },
    {
      fields: [
        ...buildBackupTableFields(),
        { field_name: "用户分类", type: BASE_FIELD_TYPE_TEXT },
      ],
      kind: "current10",
    },
  ] as const)("同名 $kind 候选要求显式选择且零写入", async ({ fields, kind }) => {
    const base = createInMemoryBase();
    base.seedTable(BACKUP_TABLE_NAME, [...fields]);
    const connection = await createConnection(null);

    const result = await resolveTableForBackup({ client: base.client, connection });

    expect(result).toMatchObject({
      status: "needs_table_choice",
      candidates: [{ kind }],
    });
    expect(base.callCounts.createTable).toBe(0);
    expect(base.callCounts.createField).toBe(0);
  });

  it("同名其他 binding 表要求选择，不静默共享镜像目标", async () => {
    const base = createInMemoryBase();
    base.seedTable(BACKUP_TABLE_NAME, [
      ...buildBackupTableFields(),
      buildBackupBindingMarkerField(OTHER_BINDING_ID),
    ]);
    const connection = await createConnection(null);

    await expect(
      resolveTableForBackup({ client: base.client, connection }),
    ).resolves.toMatchObject({
      status: "needs_table_choice",
      candidates: [{ kind: "managed_other", bindingId: OTHER_BINDING_ID }],
    });
    expect(base.callCounts.createTable).toBe(0);
  });

  it("仅名字相似或带后缀的表不作为旧同名候选", async () => {
    const base = createInMemoryBase();
    base.seedTable(`${BACKUP_TABLE_NAME} · old`, buildBackupTableFields());
    const connection = await createConnection(null);

    const result = await resolveTableForBackup({ client: base.client, connection });

    expect(result).toMatchObject({ status: "ready" });
    const names = (await listTablesForResolution(base.client)).map(({ name }) => name);
    expect(names).toContain(BACKUP_TABLE_NAME);
    expect(names).toContain(`${BACKUP_TABLE_NAME} · old`);
  });

  it("不兼容同名表保持不变，新表使用确定性 binding 后缀", async () => {
    const base = createInMemoryBase();
    const externalId = base.seedTable(BACKUP_TABLE_NAME, [
      { field_name: "外部字段", type: BASE_FIELD_TYPE_TEXT },
    ]);
    base.seedRecord(externalId, { 外部字段: "保留" });
    const connection = await createConnection(null);

    const result = await resolveTableForBackup({ client: base.client, connection });

    expect(result).toMatchObject({ status: "ready" });
    const tables = await listTablesForResolution(base.client);
    expect(tables).toContainEqual({
      table_id: externalId,
      name: BACKUP_TABLE_NAME,
    });
    expect(tables.map(({ name }) => name)).toContain(
      `${BACKUP_TABLE_NAME} · 550e8400`,
    );
    expect(base.listRecordFields(externalId)).toEqual([{ 外部字段: "保留" }]);
    expect(base.callCounts.createField).toBe(0);
  });

  it("短后缀冲突时确定性扩大 UUID 前缀", async () => {
    const base = createInMemoryBase();
    const externalFields = [{ field_name: "外部字段", type: BASE_FIELD_TYPE_TEXT }];
    base.seedTable(BACKUP_TABLE_NAME, externalFields);
    base.seedTable(`${BACKUP_TABLE_NAME} · 550e8400`, externalFields);
    const connection = await createConnection(null);

    await expect(
      resolveTableForBackup({ client: base.client, connection }),
    ).resolves.toMatchObject({ status: "ready" });
    const names = (await listTablesForResolution(base.client)).map(({ name }) => name);
    expect(names).toContain(`${BACKUP_TABLE_NAME} · 550e8400e29b`);
  });

  it("同名未来 marker 或多 marker 阻止写入", async () => {
    for (const markerFields of [
      [
        {
          field_name: `${BACKUP_BINDING_MARKER_PREFIX}2__${BINDING_ID}`,
          type: BASE_FIELD_TYPE_TEXT,
        },
      ],
      [
        buildBackupBindingMarkerField(BINDING_ID),
        buildBackupBindingMarkerField(OTHER_BINDING_ID),
      ],
    ]) {
      const base = createInMemoryBase();
      base.seedTable(BACKUP_TABLE_NAME, [
        ...buildBackupTableFields(),
        ...markerFields,
      ]);
      const connection = await createConnection(null);

      const result = await resolveTableForBackup({ client: base.client, connection });

      expect(result).toMatchObject({ status: "failed" });
      expect(base.callCounts.createTable).toBe(0);
      expect(base.callCounts.createField).toBe(0);
    }
  });

  it("显式覆盖旧七字段表时重新校验并补字段与 marker", async () => {
    const base = createInMemoryBase();
    const tableId = base.seedTable(
      BACKUP_TABLE_NAME,
      buildBackupTableFields().slice(0, 7),
    );
    const connection = await createConnection(null);
    await resolveTableForBackup({ client: base.client, connection });

    const adopted = await adoptExistingTable(
      {
        client: base.client,
        connection,
        expectedAppToken: "bascnApp",
      },
      tableId,
    );

    expect(adopted).toEqual({ status: "ready", tableId, recovered: true });
    expect((await base.client.listFields(tableId)).items).toHaveLength(11);
    expect((await connection.get())?.backupTableId).toBe(tableId);
  });

  it("选择保留旧表并新建时轮换 binding 且不修改旧表", async () => {
    const base = createInMemoryBase();
    const oldId = base.seedTable(
      BACKUP_TABLE_NAME,
      buildBackupTableFields().slice(0, 7),
    );
    const connection = await createConnection(null);

    const created = await createIndependentManagedTable({
      client: base.client,
      connection,
      expectedAppToken: "bascnApp",
    });

    expect(created).toMatchObject({ status: "ready" });
    expect((await base.client.listFields(oldId)).items).toHaveLength(7);
    expect((await listTablesForResolution(base.client)).map(({ name }) => name)).toContain(
      `${BACKUP_TABLE_NAME} · 550e8400`,
    );
  });
});
