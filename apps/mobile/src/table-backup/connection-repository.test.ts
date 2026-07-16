import { describe, expect, it } from "vitest";

import { createMemoryFeishuPersonalBaseTokenCredentialAdapter } from "../storage";
import {
  TableBackupConnectionError,
  createMemoryTableBackupStateStore,
  createTableBackupConnectionRepository,
} from "./connection-repository";

function createRepository(now: () => string) {
  const credentials = createMemoryFeishuPersonalBaseTokenCredentialAdapter();
  const repository = createTableBackupConnectionRepository({
    store: createMemoryTableBackupStateStore(),
    credentials,
    now,
  });
  return { repository, credentials };
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
});
