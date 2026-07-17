import { describe, expect, it } from "vitest";

import {
  createImageTaskRepository,
  createMemoryImageResultFileStorage,
  createMemoryImageTaskStore,
  type ImageTaskRepository,
  type ImageTaskSnapshot,
  type PromptdexEntrySourceType,
} from "../image-tasks";
import { createMemoryFeishuPersonalBaseTokenCredentialAdapter } from "../storage";
import type { PersonalPromptdexEntry } from "../promptdex/personal-entry-repository";
import {
  planDisplayImageActions,
  planMirror,
  runBackup,
  type RunBackupOptions,
} from "./backup-service";
import type { BaseApiClient } from "./base-api-client";
import {
  createMemoryTableBackupStateStore,
  createTableBackupConnectionRepository,
  type TableBackupConnectionRepository,
} from "./connection-repository";
import {
  createInMemoryBase,
  type InMemoryBase,
  type InMemoryBaseOptions,
} from "./fake-base-api";
import {
  DISPLAY_IMAGE_FIELD_NAME,
  DISPLAY_IMAGE_ID_FIELD_NAME,
  SOURCE_TYPE_FIELD_NAME,
  buildBackupTableFields,
  entryToBackupFields,
  extractBaseTextValue,
} from "./field-contract";
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
  imageTasks: ImageTaskRepository;
  imageFileStorage: ReturnType<typeof createMemoryImageResultFileStorage>;
  run: (extra?: Partial<RunBackupOptions>) => ReturnType<typeof runBackup>;
}

async function createHarness(baseOptions: InMemoryBaseOptions = {}): Promise<Harness> {
  const base = createInMemoryBase(baseOptions);
  const imageTasks = createImageTaskRepository({
    store: createMemoryImageTaskStore(),
  });
  const imageFileStorage = createMemoryImageResultFileStorage();
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
    imageTasks,
    imageFileStorage,
    run: (extra = {}) =>
      runBackup({
        connection,
        entries: { list: async () => harness.entries },
        imageTasks,
        imageFileStorage,
        createClient: () => base.client,
        migrationLock: createMigrationLockStore(),
        builtInSources: [],
        now: () => "2026-07-15T12:00:00.000Z",
        ...extra,
      }),
  };
  return harness;
}

function backupFields(
  entry: PersonalPromptdexEntry,
  displayImageId = "",
): Record<string, string> {
  return entryToBackupFields({ ...entry, displayImageId });
}

async function addGeneratedImage(
  harness: Harness,
  input: {
    entryName: string;
    imageId: string;
    createdAt: string;
    sourceType?: PromptdexEntrySourceType;
    bytes?: Uint8Array;
  },
): Promise<string> {
  const history = await harness.imageTasks.createRunningHistory({
    id: `history-${input.imageId}`,
    snapshot: createPromptdexSnapshot(
      input.entryName,
      input.sourceType ?? "personal",
    ),
  });
  const saved = await harness.imageFileStorage.saveImageResultFile({
    imageResultId: input.imageId,
    format: "png",
    bytes: input.bytes ?? new Uint8Array([1, 2, 3, 4]),
  });
  await harness.imageTasks.insertImageResult({
    id: input.imageId,
    taskHistoryId: history.id,
    filePath: saved.filePath,
    format: "png",
    width: 1024,
    height: 1024,
    createdAt: input.createdAt,
  });
  await harness.imageTasks.markCompleted(history.id, input.createdAt);
  return saved.filePath;
}

describe("runBackup 镜像引擎", () => {
  it("首次备份建表并写入全部条目", async () => {
    const harness = await createHarness();
    harness.entries = [makeEntry("alpha"), makeEntry("beta")];

    const result = await harness.run();
    expect(result.status).toBe("succeeded");
    if (result.status !== "succeeded") return;
    expect(result.summary).toEqual({
      created: 2,
      updated: 0,
      deleted: 0,
      skipped: 0,
      uploadedImages: 0,
    });
    expect(result.succeededAt).toBe("2026-07-15T12:00:00.000Z");

    const connection = await harness.connection.get();
    expect(connection?.backupTableId).toBeTruthy();
    expect(connection?.lastBackupSucceededAt).toBe("2026-07-15T12:00:00.000Z");

    const tableId = connection!.backupTableId!;
    const stored = harness.base.listRecordFields(tableId);
    expect(stored).toContainEqual(withoutDisplayImageId(backupFields(makeEntry("alpha"))));
    expect(stored).toContainEqual(withoutDisplayImageId(backupFields(makeEntry("beta"))));
  });

  it("无改动再备份幂等不产生写调用", async () => {
    const harness = await createHarness();
    harness.entries = [makeEntry("alpha"), makeEntry("beta")];
    await harness.run();
    const createsBefore = harness.base.callCounts.batchCreate;

    const result = await harness.run();
    expect(result.status).toBe("succeeded");
    if (result.status !== "succeeded") return;
    expect(result.summary).toEqual({
      created: 0,
      updated: 0,
      deleted: 0,
      skipped: 2,
      uploadedImages: 0,
    });
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
    expect(result.summary).toEqual({
      created: 0,
      updated: 1,
      deleted: 0,
      skipped: 0,
      uploadedImages: 0,
    });

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
    expect(result.summary).toEqual({
      created: 0,
      updated: 0,
      deleted: 1,
      skipped: 1,
      uploadedImages: 0,
    });

    const tableId = (await harness.connection.get())!.backupTableId!;
    expect(harness.base.listRecordFields(tableId)).toHaveLength(1);
  });

  it("表格同名多条记录仅保留第一条其余删除", async () => {
    const harness = await createHarness();
    harness.entries = [makeEntry("alpha"), makeEntry("beta")];
    await harness.run();
    const tableId = (await harness.connection.get())!.backupTableId!;
    harness.base.seedRecord(tableId, backupFields(makeEntry("alpha")));

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
      imageTasks: {
        listHistories: async () => [],
        listImageResults: async () => [],
      },
      imageFileStorage: createMemoryImageResultFileStorage(),
      createClient: () => base.client,
      migrationLock: createMigrationLockStore(),
      builtInSources: [],
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

  it("带图新记录先上传并暂存，再以单条 PUT 同落标识与附件", async () => {
    const harness = await createHarness({ reverseBatchCreateResponse: true });
    harness.entries = [makeEntry("alpha")];
    await addGeneratedImage(harness, {
      entryName: "alpha",
      imageId: "image-alpha",
      createdAt: "2026-07-15T10:00:00.000Z",
    });

    const result = await harness.run();
    expect(result.status).toBe("succeeded");
    if (result.status !== "succeeded") return;
    expect(result.summary).toEqual({
      created: 1,
      updated: 0,
      deleted: 0,
      skipped: 0,
      uploadedImages: 1,
    });
    expect(harness.base.callLog).toEqual([
      "uploadMedia",
      "batchCreate",
      "updateRecord",
    ]);
    const stagedFields = harness.base.calls.batchCreate[0][0].fields;
    expect(Object.hasOwn(stagedFields, DISPLAY_IMAGE_ID_FIELD_NAME)).toBe(false);
    expect(Object.hasOwn(stagedFields, DISPLAY_IMAGE_FIELD_NAME)).toBe(false);
    expect(harness.base.calls.updateRecord[0].fields).toMatchObject({
      [DISPLAY_IMAGE_ID_FIELD_NAME]: "image-alpha",
      [DISPLAY_IMAGE_FIELD_NAME]: [{ file_token: "file-1" }],
    });

    const tableId = (await harness.connection.get())!.backupTableId!;
    const stored = harness.base.listRecordFields(tableId)[0];
    expect(stored[DISPLAY_IMAGE_ID_FIELD_NAME]).toBe("image-alpha");
    expect(stored[DISPLAY_IMAGE_FIELD_NAME]).toMatchObject([
      {
        file_token: "file-1",
        name: "image-alpha.png",
        size: 4,
        type: "image/png",
      },
    ]);
  });

  it("生成更新图片后只上传最新一张并替换附件", async () => {
    const harness = await createHarness();
    harness.entries = [makeEntry("alpha")];
    await addGeneratedImage(harness, {
      entryName: "alpha",
      imageId: "image-old",
      createdAt: "2026-07-15T09:00:00.000Z",
    });
    await harness.run();
    await addGeneratedImage(harness, {
      entryName: "alpha",
      imageId: "image-new",
      createdAt: "2026-07-15T11:00:00.000Z",
    });

    const result = await harness.run();
    expect(result.status).toBe("succeeded");
    if (result.status !== "succeeded") return;
    expect(result.summary).toMatchObject({ updated: 1, uploadedImages: 1 });
    expect(harness.base.callCounts.uploadMedia).toBe(2);
    expect(harness.base.calls.uploadMedia.map(({ name }) => name)).toEqual([
      "image-old.png",
      "image-new.png",
    ]);
    expect(harness.base.callCounts.updateRecord).toBe(2);
    expect(harness.base.callCounts.batchUpdate).toBe(0);

    const tableId = (await harness.connection.get())!.backupTableId!;
    expect(
      harness.base.listRecordFields(tableId)[0][DISPLAY_IMAGE_ID_FIELD_NAME],
    ).toBe("image-new");
  });

  it("纯文本变化走 batch update 且保留既有附件", async () => {
    const harness = await createHarness();
    harness.entries = [makeEntry("alpha")];
    await addGeneratedImage(harness, {
      entryName: "alpha",
      imageId: "image-alpha",
      createdAt: "2026-07-15T10:00:00.000Z",
    });
    await harness.run();
    const tableId = (await harness.connection.get())!.backupTableId!;
    const attachmentBefore = harness.base.listRecordFields(tableId)[0][
      DISPLAY_IMAGE_FIELD_NAME
    ];

    harness.entries = [makeEntry("alpha", { body: "正文已更新" })];
    const result = await harness.run();

    expect(result.status).toBe("succeeded");
    if (result.status !== "succeeded") return;
    expect(result.summary).toMatchObject({ updated: 1, uploadedImages: 0 });
    expect(harness.base.callCounts.updateRecord).toBe(1);
    expect(harness.base.callCounts.batchUpdate).toBe(1);
    const fields = harness.base.listRecordFields(tableId)[0];
    expect(fields["模板正文"]).toBe("正文已更新");
    expect(fields[DISPLAY_IMAGE_FIELD_NAME]).toEqual(attachmentBefore);
  });

  it("图片结果删除后用同一个单条 PUT 清空标识与附件", async () => {
    const harness = await createHarness();
    harness.entries = [makeEntry("alpha")];
    const filePath = await addGeneratedImage(harness, {
      entryName: "alpha",
      imageId: "image-alpha",
      createdAt: "2026-07-15T10:00:00.000Z",
    });
    await harness.run();
    await harness.imageTasks.deleteImageResult("image-alpha");
    await harness.imageFileStorage.deleteFile(filePath);

    const result = await harness.run();
    expect(result.status).toBe("succeeded");
    if (result.status !== "succeeded") return;
    expect(result.summary).toMatchObject({ updated: 1, uploadedImages: 0 });
    expect(harness.base.calls.updateRecord.at(-1)?.fields).toMatchObject({
      [DISPLAY_IMAGE_ID_FIELD_NAME]: "",
      [DISPLAY_IMAGE_FIELD_NAME]: [],
    });
    const tableId = (await harness.connection.get())!.backupTableId!;
    const stored = harness.base.listRecordFields(tableId)[0];
    expect(stored[DISPLAY_IMAGE_ID_FIELD_NAME]).toBe("");
    expect(stored[DISPLAY_IMAGE_FIELD_NAME]).toEqual([]);
  });

  it("素材上传失败时不执行任何记录写入", async () => {
    const harness = await createHarness({ failUploadAtCall: 1 });
    harness.entries = [makeEntry("alpha")];
    await addGeneratedImage(harness, {
      entryName: "alpha",
      imageId: "image-alpha",
      createdAt: "2026-07-15T10:00:00.000Z",
    });

    const result = await harness.run();
    expect(result.status).toBe("failed");
    expect(harness.base.callCounts.batchCreate).toBe(0);
    expect(harness.base.callCounts.batchUpdate).toBe(0);
    expect(harness.base.callCounts.updateRecord).toBe(0);
    expect(harness.base.callCounts.batchDelete).toBe(0);
  });

  it("多张展示图在后续上传失败时仍不执行任何记录写入", async () => {
    const harness = await createHarness({ failUploadAtCall: 2 });
    harness.entries = [makeEntry("alpha"), makeEntry("beta")];
    await addGeneratedImage(harness, {
      entryName: "alpha",
      imageId: "image-alpha",
      createdAt: "2026-07-15T10:00:00.000Z",
    });
    await addGeneratedImage(harness, {
      entryName: "beta",
      imageId: "image-beta",
      createdAt: "2026-07-15T11:00:00.000Z",
    });

    const result = await harness.run();
    expect(result.status).toBe("failed");
    expect(harness.base.callCounts.uploadMedia).toBe(2);
    expect(harness.base.callCounts.batchCreate).toBe(0);
    expect(harness.base.callCounts.batchUpdate).toBe(0);
    expect(harness.base.callCounts.updateRecord).toBe(0);
    expect(harness.base.callCounts.batchDelete).toBe(0);
  });

  it("暂存新建后单条写失败，重跑按 update 补齐且不重复 create", async () => {
    const harness = await createHarness({ failUpdateRecordAtCall: 1 });
    harness.entries = [makeEntry("alpha")];
    await addGeneratedImage(harness, {
      entryName: "alpha",
      imageId: "image-alpha",
      createdAt: "2026-07-15T10:00:00.000Z",
    });

    const first = await harness.run();
    expect(first.status).toBe("failed");
    const tableId = (await harness.connection.get())!.backupTableId!;
    expect(harness.base.listRecordFields(tableId)).toHaveLength(1);
    expect(
      Object.hasOwn(
        harness.base.listRecordFields(tableId)[0],
        DISPLAY_IMAGE_ID_FIELD_NAME,
      ),
    ).toBe(false);

    const retry = await harness.run();
    expect(retry.status).toBe("succeeded");
    if (retry.status !== "succeeded") return;
    expect(retry.summary).toMatchObject({
      created: 0,
      updated: 1,
      uploadedImages: 1,
    });
    expect(harness.base.callCounts.batchCreate).toBe(1);
    expect(harness.base.callCounts.uploadMedia).toBe(2);
    expect(harness.base.callCounts.updateRecord).toBe(2);
  });

  it("部分单条写成功后重跑只重传未落定记录", async () => {
    const harness = await createHarness({
      failUpdateRecordAtCall: 2,
      reverseBatchCreateResponse: true,
    });
    harness.entries = [makeEntry("alpha"), makeEntry("beta")];
    await addGeneratedImage(harness, {
      entryName: "alpha",
      imageId: "image-alpha",
      createdAt: "2026-07-15T10:00:00.000Z",
    });
    await addGeneratedImage(harness, {
      entryName: "beta",
      imageId: "image-beta",
      createdAt: "2026-07-15T11:00:00.000Z",
    });

    expect((await harness.run()).status).toBe("failed");
    const tableId = (await harness.connection.get())!.backupTableId!;
    const afterFailure = new Map(
      harness.base
        .listRecordFields(tableId)
        .map((fields) => [fields["名称"], fields]),
    );
    expect(afterFailure.get("alpha")?.[DISPLAY_IMAGE_ID_FIELD_NAME]).toBe(
      "image-alpha",
    );
    expect(
      Object.hasOwn(
        afterFailure.get("beta") ?? {},
        DISPLAY_IMAGE_ID_FIELD_NAME,
      ),
    ).toBe(false);

    const retry = await harness.run();
    expect(retry.status).toBe("succeeded");
    if (retry.status !== "succeeded") return;
    expect(retry.summary.uploadedImages).toBe(1);
    expect(harness.base.callCounts.batchCreate).toBe(1);
    expect(harness.base.callCounts.uploadMedia).toBe(3);
    expect(harness.base.callCounts.updateRecord).toBe(3);
    expect(harness.base.calls.uploadMedia.map(({ name }) => name)).toEqual([
      "image-alpha.png",
      "image-beta.png",
      "image-beta.png",
    ]);
  });

  it("附件被使用者单独改动时标识未变，因此不察觉也不修复", async () => {
    const harness = await createHarness();
    harness.entries = [makeEntry("alpha")];
    await addGeneratedImage(harness, {
      entryName: "alpha",
      imageId: "image-alpha",
      createdAt: "2026-07-15T10:00:00.000Z",
    });
    await harness.run();
    const tableId = (await harness.connection.get())!.backupTableId!;
    const recordId = harness.base.listRecords(tableId)[0].record_id;
    harness.base.setRecordField(tableId, recordId, DISPLAY_IMAGE_FIELD_NAME, []);

    const result = await harness.run();
    expect(result.status).toBe("succeeded");
    if (result.status !== "succeeded") return;
    expect(result.summary).toMatchObject({ skipped: 1, uploadedImages: 0 });
    expect(harness.base.callCounts.updateRecord).toBe(1);
    expect(harness.base.listRecordFields(tableId)[0][DISPLAY_IMAGE_FIELD_NAME]).toEqual([]);
  });

  it("合并图鉴包含内置条目，个人同名条目抑制内置版本", async () => {
    const harness = await createHarness();
    harness.entries = [makeEntry("shared")];

    const result = await harness.run({
      builtInSources: [
        createTemplateSource("shared"),
        createTemplateSource("built-only"),
      ],
    });
    expect(result.status).toBe("succeeded");
    const tableId = (await harness.connection.get())!.backupTableId!;
    const byName = new Map(
      harness.base
        .listRecordFields(tableId)
        .map((fields) => [fields["名称"], fields]),
    );
    expect([...byName.keys()].sort()).toEqual(["built-only", "shared"]);
    expect(byName.get("shared")?.[SOURCE_TYPE_FIELD_NAME]).toBe("personal");
    expect(byName.get("built-only")?.[SOURCE_TYPE_FIELD_NAME]).toBe("built-in");
    expect(byName.get("built-only")?.["条目创建时间"]).toBe("");
    expect(byName.get("built-only")?.["条目更新时间"]).toBe("");
  });

  it("首次备份旧 7 字段表时自动补建 3 个 v2 字段", async () => {
    const harness = await createHarness();
    const oldTableId = harness.base.seedTable(
      "Imagemon 图鉴备份",
      buildBackupTableFields().slice(0, 7),
    );
    await harness.connection.setBackupTableId(oldTableId);
    harness.entries = [makeEntry("alpha")];

    const result = await harness.run();
    expect(result.status).toBe("succeeded");
    expect(harness.base.callCounts.createField).toBe(3);
    const stored = harness.base.listRecordFields(oldTableId)[0];
    expect(stored[SOURCE_TYPE_FIELD_NAME]).toBe("personal");
    expect(extractBaseTextValue(stored[DISPLAY_IMAGE_ID_FIELD_NAME])).toBe("");
  });

  it.each([
    ["缺项", "missing"],
    ["重名", "duplicate"],
    ["无法映射", "unknown"],
  ] as const)("batch create 响应%s时按无效响应失败", async (_label, mode) => {
    const harness = await createHarness();
    harness.entries = [makeEntry("alpha")];
    const invalidClient: BaseApiClient = {
      ...harness.base.client,
      async batchCreateRecords(tableId, records, options) {
        const created = await harness.base.client.batchCreateRecords(
          tableId,
          records,
          options,
        );
        if (mode === "missing") {
          return [];
        }
        if (mode === "duplicate") {
          return [
            created[0],
            { ...created[0], record_id: "rec-duplicate" },
          ];
        }
        return [
          ...created,
          { record_id: "rec-unknown", fields: { 名称: "unknown" } },
        ];
      },
    };

    const result = await harness.run({ createClient: () => invalidClient });
    expect(result.status).toBe("failed");
    if (result.status !== "failed") return;
    expect(result.message).toMatch(/新建记录响应/);
  });

  it("batch create 为不同名称返回相同 record_id 时失败", async () => {
    const harness = await createHarness();
    harness.entries = [makeEntry("alpha"), makeEntry("beta")];
    const invalidClient: BaseApiClient = {
      ...harness.base.client,
      async batchCreateRecords(tableId, records, options) {
        const created = await harness.base.client.batchCreateRecords(
          tableId,
          records,
          options,
        );
        return [created[0], { ...created[1], record_id: created[0].record_id }];
      },
    };

    const result = await harness.run({ createClient: () => invalidClient });
    expect(result.status).toBe("failed");
    if (result.status !== "failed") return;
    expect(result.message).toContain("共用了 record_id");
  });

  it("最后一次网络写完成后收到取消时不标记备份成功", async () => {
    const harness = await createHarness();
    harness.entries = [makeEntry("alpha")];
    const controller = new AbortController();
    const cancellingClient: BaseApiClient = {
      ...harness.base.client,
      async batchCreateRecords(tableId, records, options) {
        const created = await harness.base.client.batchCreateRecords(
          tableId,
          records,
          options,
        );
        controller.abort();
        return created;
      },
    };

    const result = await harness.run({
      createClient: () => cancellingClient,
      signal: controller.signal,
    });
    expect(result.status).toBe("cancelled");
    expect((await harness.connection.get())?.lastBackupSucceededAt).toBeNull();
  });
});

describe("展示图动作规划", () => {
  it("覆盖新建、换图、删图与标识未变四种情况", () => {
    const createWithImage = backupFields(makeEntry("create-with"), "image-create");
    const createWithoutImage = backupFields(makeEntry("create-without"));
    const replaceFields = backupFields(makeEntry("replace"), "image-new");
    const clearFields = backupFields(makeEntry("clear"));
    const unchangedFields = backupFields(
      makeEntry("unchanged", { body: "新正文" }),
      "image-same",
    );
    const records = [
      {
        record_id: "rec-replace",
        fields: backupFields(makeEntry("replace"), "image-old"),
      },
      {
        record_id: "rec-clear",
        fields: backupFields(makeEntry("clear"), "image-old"),
      },
      {
        record_id: "rec-unchanged",
        fields: backupFields(makeEntry("unchanged"), "image-same"),
      },
    ];
    const plan = planMirror(
      [
        createWithImage,
        createWithoutImage,
        replaceFields,
        clearFields,
        unchangedFields,
      ],
      records,
    );

    const actions = planDisplayImageActions(plan.creates, plan.updates, records);
    expect(
      actions.map((action) => ({
        kind: action.kind,
        name: action.name,
        recordId: action.recordId,
        displayImageId:
          action.kind === "upload" ? action.displayImageId : undefined,
      })),
    ).toEqual([
      {
        kind: "upload",
        name: "create-with",
        recordId: null,
        displayImageId: "image-create",
      },
      {
        kind: "upload",
        name: "replace",
        recordId: "rec-replace",
        displayImageId: "image-new",
      },
      {
        kind: "clear",
        name: "clear",
        recordId: "rec-clear",
        displayImageId: undefined,
      },
    ]);
  });

  it("附件字段不参与文本 diff", () => {
    const fields = backupFields(makeEntry("alpha"), "image-alpha");
    const plan = planMirror([fields], [
      {
        record_id: "rec-alpha",
        fields: {
          ...fields,
          [DISPLAY_IMAGE_FIELD_NAME]: [{ file_token: "user-changed" }],
        },
      },
    ]);
    expect(plan.summary).toMatchObject({ updated: 0, skipped: 1 });
  });
});

function createPromptdexSnapshot(
  name: string,
  sourceType: PromptdexEntrySourceType,
): ImageTaskSnapshot {
  return {
    source: "promptdex",
    promptdexEntry: {
      name,
      description: `${name} 描述`,
      sourceType,
      taskType: "generate",
      inputs: {
        subject: {
          required: true,
          description: "主体",
        },
      },
      body: `body-${name}`,
    },
    taskInputs: { subject: "测试主体" },
    imageSpec: {
      size: "1024x1024",
      quality: "auto",
      format: "png",
      n: 1,
    },
    modelConfiguration: {
      type: "image",
      baseUrl: "https://api.openai.com/v1",
      modelName: "gpt-image-2",
    },
    fullPrompt: "完整提示词",
  };
}

function withoutDisplayImageId(
  fields: Record<string, string>,
): Record<string, string> {
  const result = { ...fields };
  delete result[DISPLAY_IMAGE_ID_FIELD_NAME];
  return result;
}

function createTemplateSource(name: string) {
  return {
    fileName: `${name}.md`,
    source: `---
name: ${name}
description: ${name} 内置描述
inputs:
  subject:
    required: true
    description: 主体
---

# ${name}

内置模板正文。`,
  };
}
