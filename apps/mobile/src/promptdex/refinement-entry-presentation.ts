import type { BusinessCallAttentionKind } from "../business-call-attentions";
import { getTemplateRefinementAttentionLabel } from "../business-call-attentions";
import type { TemplateRefinementDraftStatus } from "./index";

export type TemplateRefinementEntryIcon =
  | "pending"
  | "document"
  | "warning"
  | "edit"
  | "sparkles";

export interface TemplateRefinementEntryPresentation {
  readonly icon: TemplateRefinementEntryIcon;
  readonly title: "模板提炼";
  readonly description: string;
  readonly status: string;
}

export function getTemplateRefinementEntryPresentation(
  hasActiveCall: boolean,
  attentionKind: BusinessCallAttentionKind | null,
  draftStatus: TemplateRefinementDraftStatus | null,
): TemplateRefinementEntryPresentation {
  if (hasActiveCall) {
    return {
      icon: "pending",
      title: "模板提炼",
      description: "已有提炼调用正在进行。",
      status: "进行中",
    };
  }

  if (attentionKind) {
    return {
      icon: attentionKind === "succeeded" ? "document" : "warning",
      title: "模板提炼",
      description:
        attentionKind === "succeeded"
          ? "有一份提炼方案等待确认写入。"
          : "上次提炼需要处理，可进入后查看并重新生成。",
      status: getTemplateRefinementAttentionLabel(attentionKind),
    };
  }

  switch (draftStatus) {
    case "ready_for_review":
      return {
        icon: "document",
        title: "模板提炼",
        description: "有一份提炼方案等待确认写入。",
        status: "待审阅",
      };
    case "failed":
      return {
        icon: "warning",
        title: "模板提炼",
        description: "上次提炼失败，可修改输入后重新生成。",
        status: "待处理",
      };
    case "generating":
      return {
        icon: "warning",
        title: "模板提炼",
        description: "上次提炼在结果确认前中断，可进入后重新生成。",
        status: "待处理",
      };
    case "editing_input":
      return {
        icon: "edit",
        title: "模板提炼",
        description: "继续编辑未完成的提炼输入。",
        status: "编辑中",
      };
    case null:
      return {
        icon: "sparkles",
        title: "模板提炼",
        description: "从外部完整提示词生成个人图鉴条目。",
        status: "新建",
      };
  }
}
