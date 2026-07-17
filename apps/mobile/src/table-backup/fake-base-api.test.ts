import { describe, expect, it } from "vitest";

import { BASE_FIELD_TYPE_TEXT, BaseApiError } from "./base-api-client";
import { createInMemoryBase } from "./fake-base-api";

const FIELDS = [{ field_name: "名称", type: BASE_FIELD_TYPE_TEXT }];

describe("createInMemoryBase", () => {
  it("生产建表调用拒绝同名表并返回 TableNameDuplicated", async () => {
    const base = createInMemoryBase();

    await base.client.createTable({ name: "Imagemon 图鉴备份", fields: FIELDS });

    const error = await base.client
      .createTable({ name: "Imagemon 图鉴备份", fields: FIELDS })
      .catch((caught) => caught);
    expect(error).toBeInstanceOf(BaseApiError);
    expect(error).toMatchObject({ code: 1254013 });
    expect(base.callCounts.createTable).toBe(2);
  });

  it("seedTable 允许测试显式制造同名异常状态", async () => {
    const base = createInMemoryBase();

    const first = base.seedTable("Imagemon 图鉴备份", FIELDS);
    const second = base.seedTable("Imagemon 图鉴备份", FIELDS);
    const page = await base.client.listTables();

    expect(first).not.toBe(second);
    expect(page.items.map((table) => table.name)).toEqual([
      "Imagemon 图鉴备份",
      "Imagemon 图鉴备份",
    ]);
    expect(base.callCounts.listTables).toBe(1);
  });

  it("数据表与字段列表按选项分页并记录只读调用", async () => {
    const base = createInMemoryBase({ tablePageSize: 1, fieldPageSize: 1 });
    const first = base.seedTable("first", FIELDS);
    base.seedTable("second", FIELDS);

    const tablePage = await base.client.listTables();
    const fieldPage = await base.client.listFields(first);

    expect(tablePage).toMatchObject({ hasMore: true, pageToken: "1" });
    expect(fieldPage).toMatchObject({ hasMore: false, pageToken: null });
    expect(base.tableCallLog).toEqual(["listTables", `listFields:${first}`]);
  });

  it("支持重命名数据表供强身份与 marker 恢复测试使用", async () => {
    const base = createInMemoryBase();
    const tableId = base.seedTable("before", FIELDS);

    base.renameTable(tableId, "after");

    await expect(base.client.listTables()).resolves.toMatchObject({
      items: [{ table_id: tableId, name: "after" }],
    });
  });
});
