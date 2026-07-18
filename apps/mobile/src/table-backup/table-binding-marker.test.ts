import { describe, expect, it } from "vitest";

import {
  BASE_FIELD_TYPE_ATTACHMENT,
  BASE_FIELD_TYPE_TEXT,
  type BaseField,
} from "./base-api-client";
import {
  BACKUP_BINDING_MARKER_PREFIX,
  CURRENT_BACKUP_BINDING_MARKER_VERSION,
  TableBindingMarkerError,
  buildBackupBindingMarkerField,
  buildBackupBindingMarkerName,
  inspectBackupBindingMarkers,
  parseBackupBindingMarkerName,
} from "./table-binding-marker";

const BINDING_ID = "550e8400-e29b-41d4-a716-446655440000";
const OTHER_BINDING_ID = "018f47a5-4f45-7bb1-8000-123456789abc";
const MARKER_NAME = `__imagemon_backup_target_v1__${BINDING_ID}`;

function field(
  fieldName: string,
  type = BASE_FIELD_TYPE_TEXT,
  fieldId = `fld-${fieldName}`,
): BaseField {
  return { field_id: fieldId, field_name: fieldName, type };
}

describe("备份目标管理标识构造", () => {
  it("将 canonical UUID 规范化为小写 v1 字段名和文本字段定义", () => {
    const uppercaseId = BINDING_ID.toUpperCase();

    expect(buildBackupBindingMarkerName(uppercaseId)).toBe(MARKER_NAME);
    expect(buildBackupBindingMarkerField(uppercaseId)).toEqual({
      field_name: MARKER_NAME,
      type: BASE_FIELD_TYPE_TEXT,
    });
    expect(CURRENT_BACKUP_BINDING_MARKER_VERSION).toBe(1);
  });

  it.each([
    "not-a-uuid",
    BINDING_ID.replaceAll("-", ""),
    ` ${BINDING_ID}`,
    "550e8400-e29b-41d4-7716-446655440000",
  ])("拒绝非 canonical UUID：%s", (invalidId) => {
    expect(() => buildBackupBindingMarkerName(invalidId)).toThrow(
      TableBindingMarkerError,
    );
  });
});

describe("备份目标管理标识解析", () => {
  it("没有保留前缀字段时返回 none，并忽略普通额外字段", () => {
    const inspection = inspectBackupBindingMarkers([
      field("名称"),
      field("分类"),
      field("__imagemon_backup_target_custom"),
      field(`用户备注-${MARKER_NAME}`),
    ]);

    expect(inspection).toEqual({ status: "none" });
    expect(parseBackupBindingMarkerName("普通用户字段")).toEqual({
      status: "none",
    });
  });

  it("唯一 v1 marker 返回 managed 并规范化 UUID", () => {
    const marker = field(
      `${BACKUP_BINDING_MARKER_PREFIX}1__${BINDING_ID.toUpperCase()}`,
    );

    expect(inspectBackupBindingMarkers([field("名称"), marker])).toEqual({
      status: "managed",
      version: 1,
      bindingId: BINDING_ID,
      field: marker,
    });
  });

  it("唯一更高版本 marker 返回 future，不能当作当前 managed marker", () => {
    const marker = field(
      `${BACKUP_BINDING_MARKER_PREFIX}2__${OTHER_BINDING_ID.toUpperCase()}`,
    );

    expect(inspectBackupBindingMarkers([marker])).toEqual({
      status: "future",
      version: 2,
      bindingId: OTHER_BINDING_ID,
      field: marker,
    });
  });

  it.each([
    {
      name: `${BACKUP_BINDING_MARKER_PREFIX}1__not-a-uuid`,
      expected: { status: "invalid", reason: "invalid_uuid" },
    },
    {
      name: `${BACKUP_BINDING_MARKER_PREFIX}x__${BINDING_ID}`,
      expected: { status: "invalid", reason: "invalid_version" },
    },
    {
      name: `${BACKUP_BINDING_MARKER_PREFIX}-1__${BINDING_ID}`,
      expected: { status: "invalid", reason: "invalid_version" },
    },
    {
      name: `${BACKUP_BINDING_MARKER_PREFIX}01__${BINDING_ID}`,
      expected: { status: "invalid", reason: "invalid_version" },
    },
    {
      name: `${BACKUP_BINDING_MARKER_PREFIX}1_${BINDING_ID}`,
      expected: { status: "invalid", reason: "malformed_marker" },
    },
    {
      name: `${BACKUP_BINDING_MARKER_PREFIX}0__${BINDING_ID}`,
      expected: { status: "unsupported", versionText: "0" },
    },
  ])("拒绝畸形或非正版本 marker：$name", ({ name, expected }) => {
    expect(inspectBackupBindingMarkers([field(name)])).toMatchObject(expected);
  });

  it("marker 字段不是文本类型时返回 invalid", () => {
    const marker = field(MARKER_NAME, BASE_FIELD_TYPE_ATTACHMENT);

    expect(inspectBackupBindingMarkers([marker])).toEqual({
      status: "invalid",
      reason: "invalid_field_type",
      field: marker,
    });
  });

  it("同表存在多个管理 marker 时直接返回 conflict", () => {
    const markers = [
      field(MARKER_NAME, BASE_FIELD_TYPE_TEXT, "fld-managed"),
      field(
        `${BACKUP_BINDING_MARKER_PREFIX}2__${OTHER_BINDING_ID}`,
        BASE_FIELD_TYPE_TEXT,
        "fld-future",
      ),
    ];

    expect(
      inspectBackupBindingMarkers([field("名称"), ...markers, field("分类")]),
    ).toEqual({ status: "conflict", fields: markers });
  });
});
