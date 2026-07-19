import { describe, expect, it } from "vitest";

import {
  createMemoryFeishuPersonalBaseTokenCredentialAdapter,
  type FeishuPersonalBaseTokenCredentialAdapter,
} from "../storage";
import {
  TableBackupConnectionError,
  createMemoryTableBackupStateStore,
  createTableBackupConnectionRepository,
  type TableBackupStateStore,
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

  it("更换 app_token 必须提供新授权码并清空全部目标状态", async () => {
    const { repository, credentials } = createRepository(
      () => "2026-07-15T00:00:00.000Z",
    );

    await repository.save({ appToken: "bascnOld", token: "pt-secret" });
    const bindingId = await repository.ensureBackupBindingId("bascnOld");
    await repository.markCreatePending({
      expectedAppToken: "bascnOld",
      bindingId,
      tableName: "Imagemon 图鉴备份",
    });
    await repository.bindBackupTable({
      expectedAppToken: "bascnOld",
      expectedBindingId: bindingId,
      tableId: "tblBackup",
    });
    await repository.markBackupSucceeded({
      expectedAppToken: "bascnOld",
      expectedTableId: "tblBackup",
      succeededAt: "2026-07-15T01:00:00.000Z",
    });

    await expect(
      repository.save({ appToken: "bascnNew" }),
    ).rejects.toBeInstanceOf(TableBackupConnectionError);
    expect((await repository.get())?.appToken).toBe("bascnOld");

    const resaved = await repository.save({
      appToken: "bascnNew",
      token: "pt-new-base",
    });
    expect(resaved.appToken).toBe("bascnNew");
    expect(resaved.backupTableId).toBeNull();
    expect(resaved.backupBindingId).toBeNull();
    expect(resaved.pendingTableName).toBeNull();
    expect(resaved.lastBackupSucceededAt).toBeNull();
    expect(await credentials.get()).toBe("pt-new-base");
  });

  it("同一 Base 替换授权码保留全部目标状态并更新凭据", async () => {
    const { repository, credentials } = createRepository(
      () => "2026-07-15T00:00:00.000Z",
    );

    await repository.save({ appToken: "bascnApp", token: "pt-old" });
    const bindingId = await repository.ensureBackupBindingId("bascnApp");
    await repository.markCreatePending({
      expectedAppToken: "bascnApp",
      bindingId,
      tableName: "Imagemon 图鉴备份",
    });
    await repository.bindBackupTable({
      expectedAppToken: "bascnApp",
      expectedBindingId: bindingId,
      tableId: "tblBackup",
    });
    await repository.markBackupSucceeded({
      expectedAppToken: "bascnApp",
      expectedTableId: "tblBackup",
      succeededAt: "2026-07-15T01:00:00.000Z",
    });

    const resaved = await repository.save({ appToken: "bascnApp", token: "pt-new" });
    expect(resaved).toMatchObject({
      backupTableId: "tblBackup",
      backupBindingId: bindingId,
      pendingTableName: null,
      lastBackupSucceededAt: "2026-07-15T01:00:00.000Z",
    });
    expect(await credentials.get()).toBe("pt-new");
  });

  it("首次保存缺少授权码时拒绝创建半连接", async () => {
    const { repository } = createRepository(
      () => "2026-07-15T00:00:00.000Z",
    );

    await expect(
      repository.save({ appToken: "bascnApp" }),
    ).rejects.toBeInstanceOf(TableBackupConnectionError);
    expect(await repository.get()).toBeNull();
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

  it("清理 pending 时同时校验 Base、binding 和表名", async () => {
    const { repository } = createRepository(
      () => "2026-07-17T00:00:00.000Z",
    );
    await repository.save({ appToken: "bascnApp", token: "pt-secret" });
    const bindingId = await repository.ensureBackupBindingId("bascnApp");
    await repository.markCreatePending({
      expectedAppToken: "bascnApp",
      bindingId,
      tableName: "Imagemon 图鉴备份",
    });

    await expect(
      repository.clearCreatePending({
        expectedAppToken: "bascnApp",
        bindingId,
        tableName: "其他名称",
      }),
    ).rejects.toBeInstanceOf(TableBackupConnectionError);
    expect((await repository.get())?.pendingTableName).toBe(
      "Imagemon 图鉴备份",
    );

    await repository.clearCreatePending({
      expectedAppToken: "bascnApp",
      bindingId,
      tableName: "Imagemon 图鉴备份",
    });
    expect((await repository.get())?.pendingTableName).toBeNull();
  });

  it("仅在本地 binding 为空或相同时采用已保存强身份的远端 marker", async () => {
    const { repository } = createRepository(
      () => "2026-07-17T00:00:00.000Z",
    );
    await repository.save({ appToken: "bascnApp", token: "pt-secret" });

    await expect(
      repository.adoptBackupBindingId(
        "bascnApp",
        "33333333-3333-4333-8333-333333333333",
      ),
    ).resolves.toBe("33333333-3333-4333-8333-333333333333");
    await expect(
      repository.adoptBackupBindingId(
        "bascnApp",
        "44444444-4444-4444-8444-444444444444",
      ),
    ).rejects.toBeInstanceOf(TableBackupConnectionError);
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
    await repository.save({ appToken: "bascnB", token: "pt-b" });

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

  it("显式认领其他受管表时原子替换 binding、表 ID 和成功状态", async () => {
    const { repository } = createRepository(
      () => "2026-07-17T00:00:00.000Z",
    );
    await repository.save({ appToken: "bascnApp", token: "pt-secret" });
    const firstBinding = await repository.ensureBackupBindingId("bascnApp");
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

    await expect(
      repository.adoptBackupTable({
        expectedAppToken: "bascnApp",
        bindingId: "33333333-3333-4333-8333-333333333333",
        tableId: "tblSelected",
      }),
    ).resolves.toMatchObject({
      backupTableId: "tblSelected",
      backupBindingId: "33333333-3333-4333-8333-333333333333",
      pendingTableName: null,
      lastBackupSucceededAt: null,
    });
  });

  it("安全存储写入失败时不切换 Base 或清空旧目标", async () => {
    const store = createMemoryTableBackupStateStore();
    const credentials = createMemoryFeishuPersonalBaseTokenCredentialAdapter();
    const repository = createTableBackupConnectionRepository({
      store,
      credentials,
      now: () => "2026-07-17T00:00:00.000Z",
      generateBindingId: () => "11111111-1111-4111-8111-111111111111",
    });
    await repository.save({ appToken: "bascnOld", token: "pt-old" });
    const bindingId = await repository.ensureBackupBindingId("bascnOld");

    const failingCredentials: FeishuPersonalBaseTokenCredentialAdapter = {
      get: () => credentials.get(),
      async save() {
        throw new Error("模拟安全存储写入失败");
      },
      delete: () => credentials.delete(),
    };
    const failingRepository = createTableBackupConnectionRepository({
      store,
      credentials: failingCredentials,
      now: () => "2026-07-17T01:00:00.000Z",
    });

    await expect(
      failingRepository.save({ appToken: "bascnNew", token: "pt-new" }),
    ).rejects.toThrow("模拟安全存储写入失败");
    expect(await repository.get()).toMatchObject({
      appToken: "bascnOld",
      backupBindingId: bindingId,
    });
    expect(await credentials.get()).toBe("pt-old");
  });

  it("状态写入失败时补偿恢复旧授权码且不混搭目标", async () => {
    const store = createMemoryTableBackupStateStore();
    const credentials = createMemoryFeishuPersonalBaseTokenCredentialAdapter();
    const repository = createTableBackupConnectionRepository({
      store,
      credentials,
      now: () => "2026-07-17T00:00:00.000Z",
      generateBindingId: () => "11111111-1111-4111-8111-111111111111",
    });
    await repository.save({ appToken: "bascnOld", token: "pt-old" });
    const bindingId = await repository.ensureBackupBindingId("bascnOld");

    const failingStore: TableBackupStateStore = {
      ...store,
      async upsert() {
        throw new Error("模拟 SQLite 写入失败");
      },
    };
    const failingRepository = createTableBackupConnectionRepository({
      store: failingStore,
      credentials,
      now: () => "2026-07-17T01:00:00.000Z",
    });

    await expect(
      failingRepository.save({ appToken: "bascnNew", token: "pt-new" }),
    ).rejects.toThrow("模拟 SQLite 写入失败");
    expect(await repository.get()).toMatchObject({
      appToken: "bascnOld",
      backupBindingId: bindingId,
    });
    expect(await credentials.get()).toBe("pt-old");
  });
});
