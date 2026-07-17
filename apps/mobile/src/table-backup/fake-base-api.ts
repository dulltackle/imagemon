// 内存版多维表格实现，供备份/恢复的集成测试使用（方案 四·集成层）。
// 实现真实 BaseApiClient 接口，另暴露句柄用于播种数据与模拟飞书侧破坏性编辑。
import {
  BaseApiError,
  type BaseApiClient,
  type BaseField,
  type BaseMediaUploadFile,
  type BasePage,
  type BaseRecord,
  type CreateTableFieldSpec,
  type RecordFieldsWrite,
  type RecordUpdateWrite,
} from "./base-api-client";
import {
  DISPLAY_IMAGE_FIELD_NAME,
  DISPLAY_IMAGE_ID_FIELD_NAME,
} from "./field-contract";

interface FakeTable {
  tableId: string;
  name: string;
  fields: BaseField[];
  records: Map<string, Record<string, unknown>>;
}

export interface InMemoryBase {
  readonly client: BaseApiClient;
  seedTable: (name: string, fields: CreateTableFieldSpec[]) => string;
  seedRecord: (tableId: string, fields: Record<string, unknown>) => string;
  listRecordFields: (tableId: string) => Record<string, unknown>[];
  listRecords: (tableId: string) => BaseRecord[];
  setRecordField: (
    tableId: string,
    recordId: string,
    fieldName: string,
    value: unknown,
  ) => void;
  setFieldType: (tableId: string, fieldName: string, type: number) => void;
  removeField: (tableId: string, fieldName: string) => void;
  dropTable: (tableId: string) => void;
  callCounts: Record<string, number>;
  callLog: string[];
  calls: {
    uploadMedia: BaseMediaUploadFile[];
    batchCreate: RecordFieldsWrite[][];
    batchUpdate: RecordUpdateWrite[][];
    updateRecord: Array<{
      tableId: string;
      recordId: string;
      fields: Record<string, unknown>;
    }>;
  };
}

export interface InMemoryBaseOptions {
  recordPageSize?: number;
  failUploadAtCall?: number;
  failUpdateRecordAtCall?: number;
  /** 用于保护调用方必须按名称映射 batch_create 响应，不能依赖返回顺序。 */
  reverseBatchCreateResponse?: boolean;
}

export function createInMemoryBase(
  options: InMemoryBaseOptions = {},
): InMemoryBase {
  const tables = new Map<string, FakeTable>();
  let tableSeq = 0;
  let recordSeq = 0;
  let fieldSeq = 0;
  let mediaSeq = 0;
  const mediaByToken = new Map<string, BaseMediaUploadFile>();
  const callLog: string[] = [];
  const calls: InMemoryBase["calls"] = {
    uploadMedia: [],
    batchCreate: [],
    batchUpdate: [],
    updateRecord: [],
  };
  const callCounts: Record<string, number> = {
    listTables: 0,
    createTable: 0,
    createField: 0,
    batchCreate: 0,
    batchUpdate: 0,
    batchDelete: 0,
    listRecords: 0,
    listFields: 0,
    uploadMedia: 0,
    updateRecord: 0,
  };
  const pageSize = options.recordPageSize ?? Infinity;

  function requireTable(tableId: string): FakeTable {
    const table = tables.get(tableId);
    if (!table) {
      throw new BaseApiError("table_not_found", 1254041, "数据表不存在。");
    }
    return table;
  }

  function makeField(spec: CreateTableFieldSpec): BaseField {
    fieldSeq += 1;
    return { field_id: `fld-${fieldSeq}`, field_name: spec.field_name, type: spec.type };
  }

  const client: BaseApiClient = {
    async uploadMedia(file) {
      callCounts.uploadMedia += 1;
      callLog.push("uploadMedia");
      calls.uploadMedia.push({ ...file });
      if (callCounts.uploadMedia === options.failUploadAtCall) {
        throw new BaseApiError("api_error", 999001, "模拟素材上传失败。");
      }
      mediaSeq += 1;
      const fileToken = `file-${mediaSeq}`;
      mediaByToken.set(fileToken, { ...file });
      return fileToken;
    },

    async listTables() {
      callCounts.listTables += 1;
      return {
        items: [...tables.values()].map((t) => ({ table_id: t.tableId, name: t.name })),
        pageToken: null,
        hasMore: false,
      };
    },

    async createTable(input) {
      callCounts.createTable += 1;
      if ([...tables.values()].some((table) => table.name === input.name)) {
        throw new BaseApiError(
          "conflict",
          1254013,
          `数据表名称「${input.name}」已存在。`,
        );
      }
      return seedTable(input.name, input.fields);
    },

    async listFields(tableId) {
      callCounts.listFields += 1;
      const table = requireTable(tableId);
      return { items: table.fields.map((f) => ({ ...f })), pageToken: null, hasMore: false };
    },

    async createField(tableId, field) {
      callCounts.createField += 1;
      const table = requireTable(tableId);
      const created = makeField(field);
      table.fields.push(created);
      return created.field_id;
    },

    async listRecords(tableId, params = {}): Promise<BasePage<BaseRecord>> {
      callCounts.listRecords += 1;
      const table = requireTable(tableId);
      const all = [...table.records.entries()].map(([record_id, fields]) => ({
        record_id,
        fields: cloneFields(fields),
      }));
      const start = params.pageToken ? Number.parseInt(params.pageToken, 10) : 0;
      const end = start + pageSize;
      const items = all.slice(start, end);
      const hasMore = end < all.length;
      return { items, pageToken: hasMore ? String(end) : null, hasMore };
    },

    async batchCreateRecords(tableId, records: RecordFieldsWrite[]) {
      callCounts.batchCreate += 1;
      callLog.push("batchCreate");
      calls.batchCreate.push(records.map(cloneRecordFieldsWrite));
      assertBatchHasNoDisplayImageFields(records);
      const table = requireTable(tableId);
      const created: BaseRecord[] = [];
      for (const record of records) {
        recordSeq += 1;
        const recordId = `rec-${recordSeq}`;
        const fields = cloneFields(record.fields);
        table.records.set(recordId, fields);
        created.push({ record_id: recordId, fields: cloneFields(fields) });
      }
      return options.reverseBatchCreateResponse ? created.reverse() : created;
    },

    async batchUpdateRecords(tableId, records: RecordUpdateWrite[]) {
      callCounts.batchUpdate += 1;
      callLog.push("batchUpdate");
      calls.batchUpdate.push(records.map(cloneRecordUpdateWrite));
      assertBatchHasNoDisplayImageFields(records);
      const table = requireTable(tableId);
      const updated: BaseRecord[] = [];
      for (const record of records) {
        const existing = table.records.get(record.record_id);
        if (!existing) {
          throw new BaseApiError("not_found", 1254043, "记录不存在。");
        }
        const fields = { ...existing, ...cloneFields(record.fields) };
        table.records.set(record.record_id, fields);
        updated.push({ record_id: record.record_id, fields: cloneFields(fields) });
      }
      return updated;
    },

    async updateRecord(tableId, recordId, fields) {
      callCounts.updateRecord += 1;
      callLog.push("updateRecord");
      calls.updateRecord.push({
        tableId,
        recordId,
        fields: cloneFields(fields),
      });
      if (callCounts.updateRecord === options.failUpdateRecordAtCall) {
        throw new BaseApiError("api_error", 999002, "模拟单记录更新失败。");
      }
      const table = requireTable(tableId);
      const existing = table.records.get(recordId);
      if (!existing) {
        throw new BaseApiError("not_found", 1254043, "记录不存在。");
      }
      const nextFields = {
        ...existing,
        ...materializeAttachmentFields(fields, mediaByToken),
      };
      table.records.set(recordId, nextFields);
      // 单条 PUT 响应保持请求的精简附件形态；后续 GET 才返回富化附件元数据。
      return { record_id: recordId, fields: cloneFields(fields) };
    },

    async batchDeleteRecords(tableId, recordIds: string[]) {
      callCounts.batchDelete += 1;
      callLog.push("batchDelete");
      const table = requireTable(tableId);
      for (const recordId of recordIds) {
        table.records.delete(recordId);
      }
    },
  };

  function seedTable(name: string, fields: CreateTableFieldSpec[]): string {
    tableSeq += 1;
    const tableId = `tbl-${tableSeq}`;
    tables.set(tableId, {
      tableId,
      name,
      fields: fields.map(makeField),
      records: new Map(),
    });
    return tableId;
  }

  function seedRecord(tableId: string, fields: Record<string, unknown>): string {
    const table = requireTable(tableId);
    recordSeq += 1;
    const recordId = `rec-${recordSeq}`;
    table.records.set(recordId, cloneFields(fields));
    return recordId;
  }

  return {
    client,
    seedTable,
    seedRecord,
    listRecordFields(tableId) {
      return [...requireTable(tableId).records.values()].map(cloneFields);
    },
    listRecords(tableId) {
      return [...requireTable(tableId).records.entries()].map(
        ([record_id, fields]) => ({ record_id, fields: cloneFields(fields) }),
      );
    },
    setRecordField(tableId, recordId, fieldName, value) {
      const record = requireTable(tableId).records.get(recordId);
      if (!record) {
        throw new BaseApiError("not_found", 1254043, "记录不存在。");
      }
      record[fieldName] = cloneValue(value);
    },
    setFieldType(tableId, fieldName, type) {
      const field = requireTable(tableId).fields.find((f) => f.field_name === fieldName);
      if (field) {
        field.type = type;
      }
    },
    removeField(tableId, fieldName) {
      const table = requireTable(tableId);
      table.fields = table.fields.filter((f) => f.field_name !== fieldName);
    },
    dropTable(tableId) {
      tables.delete(tableId);
    },
    callCounts,
    callLog,
    calls,
  };
}

function assertBatchHasNoDisplayImageFields(
  records: readonly RecordFieldsWrite[],
): void {
  for (const { fields } of records) {
    if (
      Object.hasOwn(fields, DISPLAY_IMAGE_ID_FIELD_NAME) ||
      Object.hasOwn(fields, DISPLAY_IMAGE_FIELD_NAME)
    ) {
      throw new Error("批量记录接口不得携带展示图标识或展示图字段。");
    }
  }
}

function materializeAttachmentFields(
  fields: Record<string, unknown>,
  mediaByToken: ReadonlyMap<string, BaseMediaUploadFile>,
): Record<string, unknown> {
  const result = cloneFields(fields);
  if (!Object.hasOwn(fields, DISPLAY_IMAGE_FIELD_NAME)) {
    return result;
  }
  const attachmentValue = fields[DISPLAY_IMAGE_FIELD_NAME];
  if (!Array.isArray(attachmentValue)) {
    throw new BaseApiError("api_error", 1254001, "展示图附件值无效。");
  }
  result[DISPLAY_IMAGE_FIELD_NAME] = attachmentValue.map((item) => {
    if (!isObject(item) || typeof item.file_token !== "string") {
      throw new BaseApiError("api_error", 1254001, "展示图附件值无效。");
    }
    const media = mediaByToken.get(item.file_token);
    if (!media) {
      throw new BaseApiError("api_error", 1254001, "展示图素材不存在。");
    }
    return {
      file_token: item.file_token,
      name: media.name,
      size: media.size,
      tmp_url: `memory:///tmp/${item.file_token}`,
      type: media.type,
      url: `memory:///media/${item.file_token}`,
    };
  });
  return result;
}

function cloneRecordFieldsWrite(record: RecordFieldsWrite): RecordFieldsWrite {
  return { fields: cloneFields(record.fields) };
}

function cloneRecordUpdateWrite(record: RecordUpdateWrite): RecordUpdateWrite {
  return { record_id: record.record_id, fields: cloneFields(record.fields) };
}

function cloneFields(fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, cloneValue(value)]),
  );
}

function cloneValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(cloneValue);
  }
  if (isObject(value)) {
    return cloneFields(value);
  }
  return value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
