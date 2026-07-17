import { describe, expect, it } from "vitest";

import { createMemoryFeishuPersonalBaseTokenCredentialAdapter } from "../storage";
import {
  TableBackupConnectionError,
  createMemoryTableBackupStateStore,
  createTableBackupConnectionRepository,
} from "./connection-repository";

function createRepository(
  now: () => string,
  bindingIds = [
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
  ],
) {
  const credentials = createMemoryFeishuPersonalBaseTokenCredentialAdapter();
  const store = createMemoryTableBackupStateStore();
  let bindingIndex = 0;
  const repository = createTableBackupConnectionRepository({
    store,
    credentials,
    now,
    generateBindingId: () => bindingIds[bindingIndex++] ?? bindingIds.at(-1)!,
  });
  return { repository, credentials, store };
}

describe("createTableBackupConnectionRepository", () => {
  it("首次保存写入 app_token 与凭据", async () => {
    const { repository, credentials } = createRepository(() => "2026-07-15T00:00:00.000Z");

    const saved = await repository.save({ appToken: "bascnApp", token: "pt-secret" });
    expect(saved.appToken).toBe("bascnApp");
    expect(saved.backupTableId).toBeNull();
    expect(saved.lastBackupSucceededAt).toBeNull();
    expect(await credentials.get()).toBe("pt-secret");
    expect(await repository.getToken()).toBe("pt-secret");
  });

  it("app_token 与授权码不变时保留镜像状态", async () => {
    let clock = "2026-07-15T00:00:00.000Z";
    const { repository } = createRepository(() => clock);

    await repository.save({ appToken: "bascnApp", token: "pt-secret" });
    await repository.setBackupTableId("tblBackup");
    await repository.markBackupSucceeded("2026-07-15T01:00:00.000Z");

    clock = "2026-07-15T02:00:00.000Z";
    const resaved = await repository.save({ appToken: "bascnApp" });
    expect(resaved.backupTableId).toBe("tblBackup");
    expect(resaved.lastBackupSucceededAt).toBe("2026-07-15T01:00:00.000Z");
    expect(resaved.createdAt).toBe("2026-07-15T00:00:00.000Z");
    expect(resaved.updatedAt).toBe("2026-07-15T02:00:00.000Z");
  });

  it("更换 app_token 时清空镜像状态", async () => {
    const { repository } = createRepository(() => "2026-07-15T00:00:00.000Z");

    await repository.save({ appToken: "bascnOld", token: "pt-secret" });
    await repository.setBackupTableId("tblBackup");
    await repository.markBackupSucceeded("2026-07-15T01:00:00.000Z");

    const resaved = await repository.save({ appToken: "bascnNew" });
    expect(resaved.appToken).toBe("bascnNew");
    expect(resaved.backupTableId).toBeNull();
    expect(resaved.lastBackupSucceededAt).toBeNull();
  });

  it("替换授权码时清空镜像状态并更新凭据", async () => {
    const { repository, credentials } = createRepository(() => "2026-07-15T00:00:00.000Z");

    await repository.save({ appToken: "bascnApp", token: "pt-old" });
    await repository.setBackupTableId("tblBackup");

    const resaved = await repository.save({ appToken: "bascnApp", token: "pt-new" });
    expect(resaved.backupTableId).toBeNull();
    expect(await credentials.get()).toBe("pt-new");
  });

  it("清除连接同步删除凭据与状态", async () => {
    const { repository, credentials } = createRepository(() => "2026-07-15T00:00:00.000Z");

    await repository.save({ appToken: "bascnApp", token: "pt-secret" });
    await repository.clear();

    expect(await repository.get()).toBeNull();
    expect(await credentials.get()).toBeNull();
  });

  it("app_token 为空时拒绝保存", async () => {
    const { repository } = createRepository(() => "2026-07-15T00:00:00.000Z");
    await expect(repository.save({ appToken: "   " })).rejects.toBeInstanceOf(
      TableBackupConnectionError,
    );
  });

  it("未保存连接时回填 table_id 报错", async () => {
    const { repository } = createRepository(() => "2026-07-15T00:00:00.000Z");
    await expect(repository.setBackupTableId("tbl")).rejects.toBeInstanceOf(
      TableBackupConnectionError,
    );
  });

  it("按 binding 准备、pending、绑定和成功时间依次转换状态", async () => {
    let clock = "2026-07-17T00:00:00.000Z";
    const { repository } = createRepository(() => clock);
    await repository.save({ appToken: "bascnApp", token: "pt-secret" });

    const bindingId = await repository.ensureBackupBindingId("bascnApp");
    expect(bindingId).toBe("11111111-1111-4111-8111-111111111111");
    expect(await repository.ensureBackupBindingId("bascnApp")).toBe(bindingId);

    clock = "2026-07-17T00:01:00.000Z";
    await repository.markCreatePending({
      expectedAppToken: "bascnApp",
      bindingId,
      tableName: "Imagemon 图鉴备份",
    });
    expect(await repository.get()).toMatchObject({
      backupBindingId: bindingId,
      pendingTableName: "Imagemon 图鉴备份",
    });

    clock = "2026-07-17T00:02:00.000Z";
    await repository.bindBackupTable({
      expectedAppToken: "bascnApp",
      expectedBindingId: bindingId,
      tableId: "tblBackup",
    });
    expect(await repository.get()).toMatchObject({
      backupTableId: "tblBackup",
      backupBindingId: bindingId,
      pendingTableName: null,
    });

    await repository.markBackupSucceeded({
      expectedAppToken: "bascnApp",
      expectedTableId: "tblBackup",
      succeededAt: "2026-07-17T00:03:00.000Z",
    });
    expect((await repository.get())?.lastBackupSucceededAt).toBe(
      "2026-07-17T00:03:00.000Z",
    );
  });

  it("同一 binding 的空 table ID 恢复保留成功时间，真实换表则清除", async () => {
    const { repository, store } = createRepository(
      () => "2026-07-17T00:00:00.000Z",
    );
    await repository.save({ appToken: "bascnApp", token: "pt-secret" });
    const bindingId = await repository.ensureBackupBindingId("bascnApp");
    await repository.bindBackupTable({
      expectedAppToken: "bascnApp",
      expectedBindingId: bindingId,
      tableId: "tblOriginal",
    });
    await repository.markBackupSucceeded({
      expectedAppToken: "bascnApp",
      expectedTableId: "tblOriginal",
      succeededAt: "2026-07-17T01:00:00.000Z",
    });

    const lostIdState = (await store.get())!;
    await store.upsert({ ...lostIdState, backupTableId: null });
    const recovered = await repository.bindBackupTable({
      expectedAppToken: "bascnApp",
      expectedBindingId: bindingId,
      tableId: "tblOriginal",
    });
    expect(recovered.lastBackupSucceededAt).toBe("2026-07-17T01:00:00.000Z");

    const replaced = await repository.bindBackupTable({
      expectedAppToken: "bascnApp",
      expectedBindingId: bindingId,
      tableId: "tblReplacement",
    });
    expect(replaced.lastBackupSucceededAt).toBeNull();
  });

  it("切换 Base 后拒绝把 A 的 binding、table ID 或成功时间写入 B", async () => {
    const { repository } = createRepository(
      () => "2026-07-17T00:00:00.000Z",
    );
    await repository.save({ appToken: "bascnA", token: "pt-a" });
    const bindingId = await repository.ensureBackupBindingId("bascnA");
    await repository.save({ appToken: "bascnB" });

    await expect(
      repository.markCreatePending({
        expectedAppToken: "bascnA",
        bindingId,
        tableName: "Imagemon 图鉴备份",
      }),
    ).rejects.toBeInstanceOf(TableBackupConnectionError);
    await expect(
      repository.bindBackupTable({
        expectedAppToken: "bascnA",
        expectedBindingId: bindingId,
        tableId: "tblA",
      }),
    ).rejects.toBeInstanceOf(TableBackupConnectionError);
    await expect(
      repository.markBackupSucceeded({
        expectedAppToken: "bascnA",
        expectedTableId: "tblA",
        succeededAt: "2026-07-17T01:00:00.000Z",
      }),
    ).rejects.toBeInstanceOf(TableBackupConnectionError);
    expect(await repository.get()).toMatchObject({
      appToken: "bascnB",
      backupTableId: null,
      backupBindingId: null,
      lastBackupSucceededAt: null,
    });
  });

  it("显式新建目标轮换 binding 并清空旧目标状态", async () => {
    const { repository } = createRepository(
      () => "2026-07-17T00:00:00.000Z",
    );
    await repository.save({ appToken: "bascnApp", token: "pt-secret" });
    const firstBinding = await repository.ensureBackupBindingId("bascnApp");
    await repository.markCreatePending({
      expectedAppToken: "bascnApp",
      bindingId: firstBinding,
      tableName: "Imagemon 图鉴备份",
    });
    await repository.bindBackupTable({
      expectedAppToken: "bascnApp",
      expectedBindingId: firstBinding,
      tableId: "tblOld",
    });
    await repository.markBackupSucceeded({
      expectedAppToken: "bascnApp",
      expectedTableId: "tblOld",
      succeededAt: "2026-07-17T01:00:00.000Z",
    });

    const next = await repository.startNewBackupTarget("bascnApp");
    expect(next).toMatchObject({
      backupTableId: null,
      backupBindingId: "22222222-2222-4222-8222-222222222222",
      pendingTableName: null,
      lastBackupSucceededAt: null,
    });
  });
});
