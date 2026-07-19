import { describe, expect, it } from "vitest";

import { createMemoryFeishuPersonalBaseTokenCredentialAdapter } from "../storage";
import {
  BASE_FIELD_TYPE_TEXT,
  BaseApiError,
  type BaseApiClient,
} from "./base-api-client";
import {
  createMemoryTableBackupStateStore,
  createTableBackupConnectionRepository,
} from "./connection-repository";
import { createInMemoryBase } from "./fake-base-api";
import { BACKUP_TABLE_NAME, buildBackupTableFields } from "./field-contract";
import {
  BACKUP_BINDING_MARKER_PREFIX,
  buildBackupBindingMarkerField,
} from "./table-binding-marker";
import { resolveTableForRestore } from "./table-resolver";

const APP_TOKEN = "bascnApp";
const BINDING_ID = "550e8400-e29b-41d4-a716-446655440000";
const OTHER_BINDING_ID = "018f47a5-4f45-7bb1-8000-123456789abc";

async function createConnection(options: {
  tableId?: string;
  binding?: boolean;
} = {}) {
  const connection = createTableBackupConnectionRepository({
    store: createMemoryTableBackupStateStore(),
    credentials: createMemoryFeishuPersonalBaseTokenCredentialAdapter(),
    now: () => "2026-07-17T00:00:00.000Z",
    generateBindingId: () => BINDING_ID,
  });
  await connection.save({ appToken: APP_TOKEN, token: "pt-secret" });
  if (options.binding) {
    await connection.ensureBackupBindingId(APP_TOKEN);
  }
  if (options.tableId) {
    if (options.binding) {
      await connection.bindBackupTable({
        expectedAppToken: APP_TOKEN,
        expectedBindingId: BINDING_ID,
        tableId: options.tableId,
      });
    } else {
      await connection.setBackupTableId(options.tableId);
    }
  }
  return connection;
}

describe("resolveTableForRestore 已保存目标", () => {
  it.each([7, 8, 9, 10])("已保存 %s 字段表只读返回 ready", async (count) => {
    const base = createInMemoryBase();
    const tableId = base.seedTable(
      "renamed",
      buildBackupTableFields().slice(0, count),
    );
    const connection = await createConnection({ tableId });

    const result = await resolveTableForRestore({
      client: base.client,
      connection,
      expectedAppToken: APP_TOKEN,
    });

    expect(result).toEqual({ status: "ready", tableId, recovered: false });
    expect(base.callCounts.listTables).toBe(0);
    expect(base.callCounts.createField).toBe(0);
    expect(base.callCounts.createTable).toBe(0);
  });

  it("只有明确 1254041 才进入发现，超时保留强身份且不扫描", async () => {
    const base = createInMemoryBase();
    const tableId = base.seedTable("stored", buildBackupTableFields());
    const connection = await createConnection({ tableId });
    const client: BaseApiClient = {
      ...base.client,
      async listFields() {
        throw new BaseApiError("timeout", null, "模拟读取超时");
      },
    };

    const result = await resolveTableForRestore({
      client,
      connection,
      expectedAppToken: APP_TOKEN,
    });

    expect(result).toMatchObject({
      status: "failed",
      error: { kind: "stored_table_unavailable" },
    });
    expect((await connection.get())?.backupTableId).toBe(tableId);
    expect(base.callCounts.listTables).toBe(0);
    expect(base.callCounts.createTable).toBe(0);
  });

  it("已保存表缺少必需字段时只读失败且列出字段", async () => {
    const base = createInMemoryBase();
    const tableId = base.seedTable(
      "stored",
      buildBackupTableFields().filter(({ field_name }) => field_name !== "模板正文"),
    );
    const connection = await createConnection({ tableId });

    const result = await resolveTableForRestore({
      client: base.client,
      connection,
      expectedAppToken: APP_TOKEN,
    });

    expect(result).toMatchObject({
      status: "failed",
      error: {
        kind: "contract_incompatible",
        message: expect.stringContaining("模板正文"),
      },
    });
    expect(base.callCounts.createField).toBe(0);
  });
});

describe("resolveTableForRestore 只读发现", () => {
  it.each([7, 8, 9, 10])("无 binding 的精确同名 %s 字段表返回选择态", async (count) => {
    const base = createInMemoryBase();
    base.seedTable(BACKUP_TABLE_NAME, buildBackupTableFields().slice(0, count));
    const connection = await createConnection();

    const result = await resolveTableForRestore({
      client: base.client,
      connection,
      expectedAppToken: APP_TOKEN,
    });

    expect(result).toMatchObject({
      status: "needs_table_choice",
      candidates: [{ tableId: expect.any(String) }],
    });
    expect(base.callCounts.createField).toBe(0);
    expect(base.callCounts.createTable).toBe(0);
  });

  it("相似名称不猜测且不创建数据表", async () => {
    const base = createInMemoryBase();
    base.seedTable(`${BACKUP_TABLE_NAME} · copy`, buildBackupTableFields());
    const connection = await createConnection();

    const result = await resolveTableForRestore({
      client: base.client,
      connection,
      expectedAppToken: APP_TOKEN,
    });

    expect(result).toEqual({ status: "not_found" });
    expect(base.callCounts.listFields).toBe(0);
    expect(base.callCounts.createTable).toBe(0);
  });

  it("唯一匹配本地 binding 的重命名表只恢复本地 table ID", async () => {
    const base = createInMemoryBase();
    const tableId = base.seedTable("renamed", [
      ...buildBackupTableFields(),
      buildBackupBindingMarkerField(BINDING_ID),
    ]);
    const connection = await createConnection({ binding: true });
    await connection.markCreatePending({
      expectedAppToken: APP_TOKEN,
      bindingId: BINDING_ID,
      tableName: BACKUP_TABLE_NAME,
    });

    const result = await resolveTableForRestore({
      client: base.client,
      connection,
      expectedAppToken: APP_TOKEN,
    });

    expect(result).toEqual({ status: "ready", tableId, recovered: true });
    expect(await connection.get()).toMatchObject({
      backupTableId: tableId,
      backupBindingId: BINDING_ID,
      pendingTableName: null,
    });
    expect(base.callCounts.createField).toBe(0);
    expect(base.callCounts.createTable).toBe(0);
  });

  it("同一 binding 出现在多张表时返回歧义且不绑定", async () => {
    const base = createInMemoryBase();
    for (const name of ["one", "two"]) {
      base.seedTable(name, [
        ...buildBackupTableFields(),
        buildBackupBindingMarkerField(BINDING_ID),
      ]);
    }
    const connection = await createConnection({ binding: true });

    const result = await resolveTableForRestore({
      client: base.client,
      connection,
      expectedAppToken: APP_TOKEN,
    });

    expect(result).toMatchObject({
      status: "failed",
      error: { kind: "ambiguous_marker" },
    });
    expect((await connection.get())?.backupTableId).toBeNull();
  });

  it("精确同名未来 marker 或多 marker 阻止恢复", async () => {
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
      const connection = await createConnection();

      const result = await resolveTableForRestore({
        client: base.client,
        connection,
        expectedAppToken: APP_TOKEN,
      });

      expect(result).toMatchObject({ status: "failed" });
      expect(base.callCounts.createField).toBe(0);
      expect(base.callCounts.createTable).toBe(0);
    }
  });

  it("pending 未找到时不创建、不清状态", async () => {
    const base = createInMemoryBase();
    const connection = await createConnection({ binding: true });
    await connection.markCreatePending({
      expectedAppToken: APP_TOKEN,
      bindingId: BINDING_ID,
      tableName: BACKUP_TABLE_NAME,
    });

    const result = await resolveTableForRestore({
      client: base.client,
      connection,
      expectedAppToken: APP_TOKEN,
    });

    expect(result).toEqual({ status: "not_found" });
    expect((await connection.get())?.pendingTableName).toBe(BACKUP_TABLE_NAME);
    expect(base.callCounts.createTable).toBe(0);
  });
});

describe("resolveTableForRestore 显式只读选择", () => {
  it("可按精确 table ID 读取重命名旧表且不保存为备份目标", async () => {
    const base = createInMemoryBase();
    const tableId = base.seedTable("renamed-old", buildBackupTableFields().slice(0, 7));
    const connection = await createConnection();

    const result = await resolveTableForRestore({
      client: base.client,
      connection,
      expectedAppToken: APP_TOKEN,
      selection: { expectedAppToken: APP_TOKEN, tableId },
    });

    expect(result).toEqual({ status: "ready", tableId, recovered: false });
    expect(await connection.get()).toMatchObject({
      backupTableId: null,
      backupBindingId: null,
    });
    expect(base.callCounts.listTables).toBe(0);
    expect(base.callCounts.createField).toBe(0);
  });

  it("选择其他 binding 的受管表不会替换本机备份身份", async () => {
    const base = createInMemoryBase();
    const tableId = base.seedTable("other-managed", [
      ...buildBackupTableFields(),
      buildBackupBindingMarkerField(OTHER_BINDING_ID),
    ]);
    const connection = await createConnection({ binding: true });

    const result = await resolveTableForRestore({
      client: base.client,
      connection,
      expectedAppToken: APP_TOKEN,
      selection: { expectedAppToken: APP_TOKEN, tableId },
    });

    expect(result).toEqual({ status: "ready", tableId, recovered: false });
    expect(await connection.get()).toMatchObject({
      backupTableId: null,
      backupBindingId: BINDING_ID,
    });
    expect(base.callCounts.createField).toBe(0);
  });

  it("候选缺字段、变为未来 marker 或多 marker 时重新校验失败", async () => {
    for (const fields of [
      buildBackupTableFields().filter(({ field_name }) => field_name !== "模板正文"),
      [
        ...buildBackupTableFields(),
        {
          field_name: `${BACKUP_BINDING_MARKER_PREFIX}2__${BINDING_ID}`,
          type: BASE_FIELD_TYPE_TEXT,
        },
      ],
      [
        ...buildBackupTableFields(),
        buildBackupBindingMarkerField(BINDING_ID),
        buildBackupBindingMarkerField(OTHER_BINDING_ID),
      ],
    ]) {
      const base = createInMemoryBase();
      const tableId = base.seedTable("selected", fields);
      const connection = await createConnection();

      const result = await resolveTableForRestore({
        client: base.client,
        connection,
        expectedAppToken: APP_TOKEN,
        selection: { expectedAppToken: APP_TOKEN, tableId },
      });

      expect(result).toMatchObject({ status: "failed" });
      expect(base.callCounts.createField).toBe(0);
      expect(base.callCounts.createTable).toBe(0);
    }
  });

  it("选择来自旧 Base 的 table ID 时在远端读取前停止", async () => {
    const base = createInMemoryBase();
    const tableId = base.seedTable("selected", buildBackupTableFields());
    const connection = await createConnection();

    const result = await resolveTableForRestore({
      client: base.client,
      connection,
      expectedAppToken: APP_TOKEN,
      selection: { expectedAppToken: "bascnOther", tableId },
    });

    expect(result).toMatchObject({
      status: "failed",
      error: { kind: "binding_conflict" },
    });
    expect(base.callCounts.listFields).toBe(0);
  });
});
