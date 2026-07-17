import type { TableCandidateKind } from "./table-resolver";

export const TABLE_CHOICE_WARNING =
  "发现现有 Imagemon 备份数据表。备份是全量镜像，可能删除表中本机不存在的记录。请选择下一步。";

export const TABLE_OVERWRITE_CONFIRMATION =
  "继续后，表中本机不存在的图鉴记录会被删除。建议先完成恢复或另建备份表。";

export const RESTORE_NOT_FOUND_MESSAGE = "未发现可恢复的备份数据表。";

export const TABLE_CHOICE_ACTIONS = {
  restore: { label: "先从此表恢复", recommended: true },
  overwrite: { label: "使用此表并以本机内容覆盖", recommended: false },
  createIndependent: {
    label: "保留此表，创建新的备份表",
    recommended: false,
  },
  cancel: { label: "取消", recommended: false },
} as const;

const CANDIDATE_KIND_LABELS: Record<TableCandidateKind, string> = {
  legacy7: "旧版 7 字段备份表",
  partial8_9: "旧版部分升级备份表",
  current10: "当前字段契约备份表",
  managed_matching: "当前 binding 备份表",
  managed_other: "其他 Imagemon 备份目标",
  incompatible: "不兼容数据表",
  future_managed: "更高版本备份表",
  ambiguous: "marker 冲突数据表",
};

export function tableCandidateKindLabel(kind: TableCandidateKind): string {
  return CANDIDATE_KIND_LABELS[kind];
}
