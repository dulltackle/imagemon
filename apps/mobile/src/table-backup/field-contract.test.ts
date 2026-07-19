import { describe, expect, it } from "vitest";

import type { PersonalPromptdexEntry } from "../promptdex/personal-entry-repository";
import {
  BASE_FIELD_TYPE_ATTACHMENT,
  BASE_FIELD_TYPE_TEXT,
  BaseApiError,
  type BaseField,
  type BasePage,
} from "./base-api-client";
import {
  BACKUP_TABLE_NAME,
  FIELD_CONTRACT,
  FieldContractError,
  RESTORE_OPTIONAL_FIELD_CONTRACT,
  RESTORE_REQUIRED_FIELD_CONTRACT,
  analyzeFieldContract,
  assertRestoreFieldContract,
  buildBackupTableFields,
  entryToBackupFields,
  ensureBackupFieldContract,
  extractBaseTextValue,
  inspectRestoreFieldContract,
  readRecordName,
  readRecordSourceType,
  recordFieldsToTemplate,
} from "./field-contract";

const CONTRACT_NAMES = [
  "名称",
  "用途说明",
  "版本",
  "输入声明JSON",
  "模板正文",
  "条目创建时间",
  "条目更新时间",
  "来源类型",
  "展示图标识",
  "展示图",
];

const LEGACY_CONTRACT_NAMES = CONTRACT_NAMES.slice(0, 7);

function field(name: string, type = BASE_FIELD_TYPE_TEXT): BaseField {
  return { field_id: `fld-${name}`, field_name: name, type };
}

function fullContractFields(): BaseField[] {
  return CONTRACT_NAMES.map((name) =>
    field(name, name === "展示图" ? BASE_FIELD_TYPE_ATTACHMENT : BASE_FIELD_TYPE_TEXT),
  );
}

class FakeFieldClient {
  createdFields: string[] = [];
  createFieldError: Error | null = null;
  commitBeforeCreateFieldError = false;

  constructor(private fields: BaseField[]) {}

  async listFields(): Promise<BasePage<BaseField>> {
    return { items: this.fields, pageToken: null, hasMore: false };
  }

  async createField(
    _tableId: string,
    input: { field_name: string; type: number },
  ): Promise<string> {
    if (this.createFieldError) {
      if (this.commitBeforeCreateFieldError) {
        this.fields = [...this.fields, field(input.field_name, input.type)];
      }
      throw this.createFieldError;
    }
    this.createdFields.push(input.field_name);
    this.fields = [...this.fields, field(input.field_name, input.type)];
    return `fld-${input.field_name}`;
  }
}

const SAMPLE_ENTRY: PersonalPromptdexEntry = {
  name: "little-dino",
  description: "示例条目",
  version: "1.0",
  inputs: { subject: { required: true, description: "主体" } },
  body: "画一只小恐龙",
  fileName: "little-dino.md",
  taskType: "generate",
  sourceType: "personal",
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-02T00:00:00.000Z",
};

const SAMPLE_BACKUP_ENTRY = { ...SAMPLE_ENTRY, displayImageId: "" };

describe("字段契约常量", () => {
  it("建表字段以名称主字段开头，末尾追加两个文本字段和附件字段", () => {
    const fields = buildBackupTableFields();
    expect(fields[0]).toEqual({ field_name: "名称", type: BASE_FIELD_TYPE_TEXT });
    expect(fields.map((f) => f.field_name)).toEqual(CONTRACT_NAMES);
    expect(fields.slice(0, 9).every((f) => f.type === BASE_FIELD_TYPE_TEXT)).toBe(true);
    expect(fields[9]).toEqual({
      field_name: "展示图",
      type: BASE_FIELD_TYPE_ATTACHMENT,
    });
    expect(RESTORE_REQUIRED_FIELD_CONTRACT.map((def) => def.name)).toEqual(
      LEGACY_CONTRACT_NAMES,
    );
    expect(RESTORE_OPTIONAL_FIELD_CONTRACT.map((def) => def.name)).toEqual(
      CONTRACT_NAMES.slice(7),
    );
    expect(FIELD_CONTRACT).toHaveLength(10);
    expect(BACKUP_TABLE_NAME).toBe("Imagemon 图鉴备份");
  });
});

describe("analyzeFieldContract", () => {
  it("契约完整时无缺失无冲突", () => {
    const result = analyzeFieldContract(fullContractFields());
    expect(result.missing).toEqual([]);
    expect(result.mismatched).toEqual([]);
  });

  it("识别缺失字段", () => {
    const partial = fullContractFields().filter((f) => f.field_name !== "版本");
    const result = analyzeFieldContract(partial);
    expect(result.missing.map((d) => d.name)).toEqual(["版本"]);
    expect(result.mismatched).toEqual([]);
  });

  it("识别类型不符字段", () => {
    const wrong = fullContractFields().map((f) =>
      f.field_name === "模板正文" ? { ...f, type: 99 } : f,
    );
    const result = analyzeFieldContract(wrong);
    expect(result.mismatched.map((d) => d.name)).toEqual(["模板正文"]);
    expect(result.missing).toEqual([]);
  });

  it("忽略使用者自加的多余列", () => {
    const withExtra = [...fullContractFields(), field("分类"), field("封面", 17)];
    const result = analyzeFieldContract(withExtra);
    expect(result.missing).toEqual([]);
    expect(result.mismatched).toEqual([]);
  });
});

describe("ensureBackupFieldContract", () => {
  it("补建缺失字段", async () => {
    const client = new FakeFieldClient(
      fullContractFields().filter((f) => f.field_name !== "版本"),
    );
    await ensureBackupFieldContract(client, "tbl1");
    expect(client.createdFields).toEqual(["版本"]);
  });

  it("旧契约表自动补建三个 v2 字段", async () => {
    const client = new FakeFieldClient(
      fullContractFields().filter((f) => LEGACY_CONTRACT_NAMES.includes(f.field_name)),
    );
    await ensureBackupFieldContract(client, "tbl1");
    expect(client.createdFields).toEqual(["来源类型", "展示图标识", "展示图"]);
  });

  it("类型不符时直接失败且不补建", async () => {
    const client = new FakeFieldClient(
      fullContractFields().map((f) =>
        f.field_name === "版本" ? { ...f, type: 99 } : f,
      ),
    );
    await expect(ensureBackupFieldContract(client, "tbl1")).rejects.toBeInstanceOf(
      FieldContractError,
    );
    expect(client.createdFields).toEqual([]);
  });

  it("补建失败时归一为契约错误", async () => {
    const client = new FakeFieldClient(
      fullContractFields().filter((f) => f.field_name !== "版本"),
    );
    client.createFieldError = new Error("网络故障");
    const error = await ensureBackupFieldContract(client, "tbl1").catch(
      (caught) => caught,
    );
    expect(error).toBeInstanceOf(FieldContractError);
    expect(error).toMatchObject({ cause: client.createFieldError });
    expect((error as Error).message).toMatch(/补建字段「版本」失败/);
  });

  it("补字段提交后超时时重读确认字段存在并视为成功", async () => {
    const client = new FakeFieldClient(
      fullContractFields().filter((f) => f.field_name !== "版本"),
    );
    client.createFieldError = new BaseApiError("timeout", null, "模拟超时");
    client.commitBeforeCreateFieldError = true;

    await expect(ensureBackupFieldContract(client, "tbl1")).resolves.toBeUndefined();
  });

  it("补字段结果不确定且重读仍缺失时保留底层 cause", async () => {
    const client = new FakeFieldClient(
      fullContractFields().filter((f) => f.field_name !== "版本"),
    );
    const cause = new BaseApiError("network_error", null, "模拟断网");
    client.createFieldError = cause;

    const error = await ensureBackupFieldContract(client, "tbl1").catch(
      (caught) => caught,
    );
    expect(error).toBeInstanceOf(FieldContractError);
    expect(error).toMatchObject({ cause });
  });
});

describe("assertRestoreFieldContract", () => {
  it("契约完整时通过", async () => {
    const client = new FakeFieldClient(fullContractFields());
    await expect(assertRestoreFieldContract(client, "tbl1")).resolves.toBeUndefined();
    await expect(inspectRestoreFieldContract(client, "tbl1")).resolves.toEqual({
      sourceTypeFieldPresent: true,
      displayImageIdFieldPresent: true,
      displayImageFieldPresent: true,
    });
    expect(client.createdFields).toEqual([]);
  });

  it("缺失恢复必需字段时失败且不补建", async () => {
    const client = new FakeFieldClient(
      fullContractFields().filter((f) => f.field_name !== "版本"),
    );
    await expect(assertRestoreFieldContract(client, "tbl1")).rejects.toBeInstanceOf(
      FieldContractError,
    );
    expect(client.createdFields).toEqual([]);
  });

  it("旧契约表缺少三个可选字段仍通过并返回存在性", async () => {
    const client = new FakeFieldClient(
      fullContractFields().filter((f) => LEGACY_CONTRACT_NAMES.includes(f.field_name)),
    );
    await expect(assertRestoreFieldContract(client, "tbl1")).resolves.toBeUndefined();
    await expect(inspectRestoreFieldContract(client, "tbl1")).resolves.toEqual({
      sourceTypeFieldPresent: false,
      displayImageIdFieldPresent: false,
      displayImageFieldPresent: false,
    });
    expect(client.createdFields).toEqual([]);
  });

  it("可选字段可独立缺失，并准确返回来源字段存在性", async () => {
    const client = new FakeFieldClient(
      fullContractFields().filter(
        (f) => f.field_name !== "展示图标识" && f.field_name !== "展示图",
      ),
    );
    await expect(inspectRestoreFieldContract(client, "tbl1")).resolves.toEqual({
      sourceTypeFieldPresent: true,
      displayImageIdFieldPresent: false,
      displayImageFieldPresent: false,
    });
  });

  it("可选契约字段存在但类型不符时仍失败", async () => {
    const client = new FakeFieldClient(
      fullContractFields().map((f) =>
        f.field_name === "展示图" ? { ...f, type: BASE_FIELD_TYPE_TEXT } : f,
      ),
    );
    await expect(assertRestoreFieldContract(client, "tbl1")).rejects.toThrow(
      /展示图/,
    );
  });

  it("类型不符时失败", async () => {
    const client = new FakeFieldClient(
      fullContractFields().map((f) =>
        f.field_name === "名称" ? { ...f, type: 99 } : f,
      ),
    );
    await expect(assertRestoreFieldContract(client, "tbl1")).rejects.toBeInstanceOf(
      FieldContractError,
    );
  });
});

describe("记录 ⇄ 条目 映射", () => {
  it("条目映射为契约文本字段", () => {
    expect(entryToBackupFields({ ...SAMPLE_ENTRY, displayImageId: "img-latest" })).toEqual({
      名称: "little-dino",
      用途说明: "示例条目",
      版本: '"1.0"',
      输入声明JSON: '{"subject":{"required":true,"description":"主体"}}',
      模板正文: "画一只小恐龙",
      条目创建时间: "2026-07-01T00:00:00.000Z",
      条目更新时间: "2026-07-02T00:00:00.000Z",
      来源类型: "personal",
      展示图标识: "img-latest",
    });
  });

  it("内置条目无时间戳和展示图时写空串", () => {
    expect(
      entryToBackupFields({
        name: "built-in-entry",
        description: "内置示例",
        inputs: {},
        body: "内置正文",
        sourceType: "built-in",
        displayImageId: "",
      }),
    ).toMatchObject({
      来源类型: "built-in",
      条目创建时间: "",
      条目更新时间: "",
      展示图标识: "",
    });
  });

  it("无版本条目版本列为空串", () => {
    const { version: _version, ...withoutVersion } = SAMPLE_ENTRY;
    expect(entryToBackupFields({ ...withoutVersion, displayImageId: "" }).版本).toBe("");
  });

  it("记录映射为模板并保留时间戳", () => {
    const candidate = recordFieldsToTemplate(entryToBackupFields(SAMPLE_BACKUP_ENTRY));
    expect(candidate.template.name).toBe("little-dino");
    expect(candidate.template.taskType).toBe("generate");
    expect(candidate.createdAt).toBe("2026-07-01T00:00:00.000Z");
    expect(candidate.updatedAt).toBe("2026-07-02T00:00:00.000Z");
  });

  it("条目→记录→模板往返无损", () => {
    const { template, createdAt, updatedAt } = recordFieldsToTemplate(
      entryToBackupFields(SAMPLE_BACKUP_ENTRY),
    );
    expect(template.name).toBe(SAMPLE_ENTRY.name);
    expect(template.description).toBe(SAMPLE_ENTRY.description);
    expect(template.version).toBe(SAMPLE_ENTRY.version);
    expect(template.inputs).toEqual(SAMPLE_ENTRY.inputs);
    expect(template.body).toBe(SAMPLE_ENTRY.body);
    expect(createdAt).toBe(SAMPLE_ENTRY.createdAt);
    expect(updatedAt).toBe(SAMPLE_ENTRY.updatedAt);
  });

  it("输入声明 JSON 非法时抛错", () => {
    const fields = { ...entryToBackupFields(SAMPLE_BACKUP_ENTRY), 输入声明JSON: "{坏的" };
    expect(() => recordFieldsToTemplate(fields)).toThrow(/输入声明JSON/);
  });

  it("版本 JSON 非法时抛错", () => {
    const fields = { ...entryToBackupFields(SAMPLE_BACKUP_ENTRY), 版本: "{坏的" };
    expect(() => recordFieldsToTemplate(fields)).toThrow(/版本/);
  });

  it("名称格式非法时抛错", () => {
    const fields = { ...entryToBackupFields(SAMPLE_BACKUP_ENTRY), 名称: "小恐龙" };
    expect(() => recordFieldsToTemplate(fields)).toThrow();
  });

  it("缺必填正文时抛错", () => {
    const fields = { ...entryToBackupFields(SAMPLE_BACKUP_ENTRY), 模板正文: "" };
    expect(() => recordFieldsToTemplate(fields)).toThrow();
  });

  it("readRecordName 即使其余字段非法也能取名称", () => {
    const fields = { 名称: "little-dino", 输入声明JSON: "坏" };
    expect(readRecordName(fields)).toBe("little-dino");
  });

  it("readRecordSourceType 归一化来源类型富文本", () => {
    expect(
      readRecordSourceType({
        来源类型: [{ type: "text", text: "built-" }, { type: "text", text: "in" }],
      }),
    ).toBe("built-in");
  });
});

describe("extractBaseTextValue", () => {
  it("纯字符串原样返回", () => {
    expect(extractBaseTextValue("abc")).toBe("abc");
  });

  it("富文本段数组拼接 text", () => {
    expect(
      extractBaseTextValue([
        { type: "text", text: "画一只" },
        { type: "text", text: "小恐龙" },
      ]),
    ).toBe("画一只小恐龙");
  });

  it("空值返回空串", () => {
    expect(extractBaseTextValue(null)).toBe("");
    expect(extractBaseTextValue(undefined)).toBe("");
  });
});
