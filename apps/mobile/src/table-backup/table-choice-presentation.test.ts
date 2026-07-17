import { describe, expect, it } from "vitest";

import {
  RESTORE_NOT_FOUND_MESSAGE,
  TABLE_CHOICE_ACTIONS,
  TABLE_CHOICE_WARNING,
  TABLE_OVERWRITE_CONFIRMATION,
  tableCandidateKindLabel,
} from "./table-choice-presentation";

describe("备份表选择文案", () => {
  it("提供恢复、覆盖、新建与取消四种动作，且只推荐先恢复", () => {
    expect(Object.values(TABLE_CHOICE_ACTIONS).map(({ label }) => label)).toEqual([
      "先从此表恢复",
      "使用此表并以本机内容覆盖",
      "保留此表，创建新的备份表",
      "取消",
    ]);
    expect(
      Object.entries(TABLE_CHOICE_ACTIONS)
        .filter(([, action]) => action.recommended)
        .map(([key]) => key),
    ).toEqual(["restore"]);
  });

  it("明确全量镜像风险与覆盖二次确认", () => {
    expect(TABLE_CHOICE_WARNING).toContain("可能删除");
    expect(TABLE_OVERWRITE_CONFIRMATION).toContain("本机不存在");
    expect(TABLE_OVERWRITE_CONFIRMATION).toContain("先完成恢复");
  });

  it.each([
    ["legacy7", "旧版 7 字段备份表"],
    ["partial8_9", "旧版部分升级备份表"],
    ["current10", "当前字段契约备份表"],
    ["managed_other", "其他 Imagemon 备份目标"],
  ] as const)("将 %s 映射为可读候选类型", (kind, label) => {
    expect(tableCandidateKindLabel(kind)).toBe(label);
  });

  it("未找到恢复目标不再引导先备份", () => {
    expect(RESTORE_NOT_FOUND_MESSAGE).toBe("未发现可恢复的备份数据表。");
    expect(RESTORE_NOT_FOUND_MESSAGE).not.toContain("先备份");
  });
});
