// 内存版多维表格实现，供备份/恢复的集成测试使用（方案 四·集成层）。
// 实现真实 BaseApiClient 接口，另暴露句柄用于播种数据与模拟飞书侧破坏性编辑。
import {
  BaseApiError,
  type BaseApiClient,
  type BaseField,
  type BasePage,
  type BaseRecord,
  type CreateTableFieldSpec,
  type RecordFieldsWrite,
  type RecordUpdateWrite,
} from "./base-api-client";

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
  setFieldType: (tableId: string, fieldName: string, type: number) => void;
  removeField: (tableId: string, fieldName: string) => void;
  dropTable: (tableId: string) => void;
  callCounts: Record<string, number>;
}

export function createInMemoryBase(
  options: { recordPageSize?: number } = {},
): InMemoryBase {
  const tables = new Map<string, FakeTable>();
  let tableSeq = 0;
  let recordSeq = 0;
  let fieldSeq = 0;
  const callCounts: Record<string, number> = {
    createTable: 0,
    createField: 0,
    batchCreate: 0,
    batchUpdate: 0,
    batchDelete: 0,
    listRecords: 0,
    listFields: 0,
  };
  const pageSize = options.recordPageSize ?? Infinity;

  function requireTable(tableId: string): FakeTable {
    const table = tables.get(tableId);
    if (!table) {
      throw new BaseApiError("not_found", 1254045, "数据表不存在。");
    }
    return table;
  }

  function makeField(spec: CreateTableFieldSpec): BaseField {
    fieldSeq += 1;
    return { field_id: `fld-${fieldSeq}`, field_name: spec.field_name, type: spec.type };
  }

  const client: BaseApiClient = {
    async listTables() {
      return {
        items: [...tables.values()].map((t) => ({ table_id: t.tableId, name: t.name })),
        pageToken: null,
        hasMore: false,
      };
    },

    async createTable(input) {
      callCounts.createTable += 1;
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
        fields: { ...fields },
      }));
      const start = params.pageToken ? Number.parseInt(params.pageToken, 10) : 0;
      const end = start + pageSize;
      const items = all.slice(start, end);
      const hasMore = end < all.length;
      return { items, pageToken: hasMore ? String(end) : null, hasMore };
    },

    async batchCreateRecords(tableId, records: RecordFieldsWrite[]) {
      callCounts.batchCreate += 1;
      const table = requireTable(tableId);
      const created: BaseRecord[] = [];
      for (const record of records) {
        recordSeq += 1;
        const recordId = `rec-${recordSeq}`;
        table.records.set(recordId, { ...record.fields });
        created.push({ record_id: recordId, fields: { ...record.fields } });
      }
      return created;
    },

    async batchUpdateRecords(tableId, records: RecordUpdateWrite[]) {
      callCounts.batchUpdate += 1;
      const table = requireTable(tableId);
      const updated: BaseRecord[] = [];
      for (const record of records) {
        if (!table.records.has(record.record_id)) {
          throw new BaseApiError("not_found", 1254043, "记录不存在。");
        }
        table.records.set(record.record_id, { ...record.fields });
        updated.push({ record_id: record.record_id, fields: { ...record.fields } });
      }
      return updated;
    },

    async batchDeleteRecords(tableId, recordIds: string[]) {
      callCounts.batchDelete += 1;
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
    table.records.set(recordId, { ...fields });
    return recordId;
  }

  return {
    client,
    seedTable,
    seedRecord,
    listRecordFields(tableId) {
      return [...requireTable(tableId).records.values()].map((fields) => ({ ...fields }));
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
  };
}
