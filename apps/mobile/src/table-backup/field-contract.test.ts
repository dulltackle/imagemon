import { describe, expect, it } from "vitest";

import type { PersonalPromptdexEntry } from "../promptdex/personal-entry-repository";
import { BASE_FIELD_TYPE_TEXT, type BaseField, type BasePage } from "./base-api-client";
import {
  BACKUP_TABLE_NAME,
  FieldContractError,
  analyzeFieldContract,
  assertRestoreFieldContract,
  buildBackupTableFields,
  entryToBackupFields,
  ensureBackupFieldContract,
  extractBaseTextValue,
  readRecordName,
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
];

function field(name: string, type = BASE_FIELD_TYPE_TEXT): BaseField {
  return { field_id: `fld-${name}`, field_name: name, type };
}

function fullContractFields(): BaseField[] {
  return CONTRACT_NAMES.map((name) => field(name));
}

class FakeFieldClient {
  createdFields: string[] = [];
  createFieldError: Error | null = null;

  constructor(private fields: BaseField[]) {}

  async listFields(): Promise<BasePage<BaseField>> {
    return { items: this.fields, pageToken: null, hasMore: false };
  }

  async createField(
    _tableId: string,
    input: { field_name: string; type: number },
  ): Promise<string> {
    if (this.createFieldError) {
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

describe("字段契约常量", () => {
  it("建表字段以名称主字段开头且全为文本类型", () => {
    const fields = buildBackupTableFields();
    expect(fields[0]).toEqual({ field_name: "名称", type: BASE_FIELD_TYPE_TEXT });
    expect(fields.map((f) => f.field_name)).toEqual(CONTRACT_NAMES);
    expect(fields.every((f) => f.type === BASE_FIELD_TYPE_TEXT)).toBe(true);
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
    await expect(ensureBackupFieldContract(client, "tbl1")).rejects.toThrow(
      /补建字段「版本」失败/,
    );
  });
});

describe("assertRestoreFieldContract", () => {
  it("契约完整时通过", async () => {
    const client = new FakeFieldClient(fullContractFields());
    await expect(assertRestoreFieldContract(client, "tbl1")).resolves.toBeUndefined();
    expect(client.createdFields).toEqual([]);
  });

  it("缺失字段时失败且不补建", async () => {
    const client = new FakeFieldClient(
      fullContractFields().filter((f) => f.field_name !== "版本"),
    );
    await expect(assertRestoreFieldContract(client, "tbl1")).rejects.toBeInstanceOf(
      FieldContractError,
    );
    expect(client.createdFields).toEqual([]);
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
    expect(entryToBackupFields(SAMPLE_ENTRY)).toEqual({
      名称: "little-dino",
      用途说明: "示例条目",
      版本: '"1.0"',
      输入声明JSON: '{"subject":{"required":true,"description":"主体"}}',
      模板正文: "画一只小恐龙",
      条目创建时间: "2026-07-01T00:00:00.000Z",
      条目更新时间: "2026-07-02T00:00:00.000Z",
    });
  });

  it("无版本条目版本列为空串", () => {
    const { version: _version, ...withoutVersion } = SAMPLE_ENTRY;
    expect(entryToBackupFields(withoutVersion).版本).toBe("");
  });

  it("记录映射为模板并保留时间戳", () => {
    const candidate = recordFieldsToTemplate(entryToBackupFields(SAMPLE_ENTRY));
    expect(candidate.template.name).toBe("little-dino");
    expect(candidate.template.taskType).toBe("generate");
    expect(candidate.createdAt).toBe("2026-07-01T00:00:00.000Z");
    expect(candidate.updatedAt).toBe("2026-07-02T00:00:00.000Z");
  });

  it("条目→记录→模板往返无损", () => {
    const { template, createdAt, updatedAt } = recordFieldsToTemplate(
      entryToBackupFields(SAMPLE_ENTRY),
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
    const fields = { ...entryToBackupFields(SAMPLE_ENTRY), 输入声明JSON: "{坏的" };
    expect(() => recordFieldsToTemplate(fields)).toThrow(/输入声明JSON/);
  });

  it("版本 JSON 非法时抛错", () => {
    const fields = { ...entryToBackupFields(SAMPLE_ENTRY), 版本: "{坏的" };
    expect(() => recordFieldsToTemplate(fields)).toThrow(/版本/);
  });

  it("名称格式非法时抛错", () => {
    const fields = { ...entryToBackupFields(SAMPLE_ENTRY), 名称: "小恐龙" };
    expect(() => recordFieldsToTemplate(fields)).toThrow();
  });

  it("缺必填正文时抛错", () => {
    const fields = { ...entryToBackupFields(SAMPLE_ENTRY), 模板正文: "" };
    expect(() => recordFieldsToTemplate(fields)).toThrow();
  });

  it("readRecordName 即使其余字段非法也能取名称", () => {
    const fields = { 名称: "little-dino", 输入声明JSON: "坏" };
    expect(readRecordName(fields)).toBe("little-dino");
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
