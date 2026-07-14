import type {
  BusinessCallAttention,
  BusinessCallAttentionKind,
} from "./repository";

export type BusinessCallAttentionLabel =
  | "待查看"
  | "待处理"
  | "待确认";

export interface BusinessCallAttentionSnapshot {
  readonly attentions: readonly BusinessCallAttention[];
  readonly imageTasks: ReadonlyMap<string, BusinessCallAttention>;
  readonly templateRefinement: BusinessCallAttention | null;
  readonly hasCatalogAttention: boolean;
  readonly hasHistoryAttention: boolean;
}

export const EMPTY_BUSINESS_CALL_ATTENTION_SNAPSHOT: BusinessCallAttentionSnapshot =
  Object.freeze({
    attentions: Object.freeze([]),
    imageTasks: new Map<string, BusinessCallAttention>(),
    templateRefinement: null,
    hasCatalogAttention: false,
    hasHistoryAttention: false,
  });

export function createBusinessCallAttentionSnapshot(
  attentions: readonly BusinessCallAttention[],
): BusinessCallAttentionSnapshot {
  const copiedAttentions = attentions.map((attention) =>
    Object.freeze({ ...attention }),
  );
  const imageTasks = new Map<string, BusinessCallAttention>();
  let templateRefinement: BusinessCallAttention | null = null;

  for (const attention of copiedAttentions) {
    if (attention.subjectType === "image_task") {
      imageTasks.set(attention.subjectId, attention);
    } else {
      templateRefinement = attention;
    }
  }

  return Object.freeze({
    attentions: Object.freeze(copiedAttentions),
    imageTasks,
    templateRefinement,
    hasCatalogAttention:
      templateRefinement !== null ||
      [...imageTasks.values()].some(({ kind }) => kind === "succeeded"),
    hasHistoryAttention: imageTasks.size > 0,
  });
}

export function getImageTaskAttentionLabel(
  kind: BusinessCallAttentionKind,
): Extract<BusinessCallAttentionLabel, "待查看" | "待处理"> {
  return kind === "succeeded" ? "待查看" : "待处理";
}

export function getTemplateRefinementAttentionLabel(
  kind: BusinessCallAttentionKind,
): Extract<BusinessCallAttentionLabel, "待确认" | "待处理"> {
  return kind === "succeeded" ? "待确认" : "待处理";
}
