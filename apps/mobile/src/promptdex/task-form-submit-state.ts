import { getModelCallStatusLabel, type ModelCallType } from "../model-calls";

export type TaskSubmitBlockKind =
  | "loading_model_configuration"
  | "missing_model_configuration"
  | "unsupported_template"
  | "missing_edit_image"
  | "missing_required_inputs"
  | "picking_edit_image"
  | "submitting"
  | "model_call_in_progress";

export interface TaskSubmitBlock {
  kind: TaskSubmitBlockKind;
  message: string;
}

export interface TaskSubmitState {
  canSubmit: boolean;
  block: TaskSubmitBlock | null;
}

export interface TaskSubmitStateInput {
  taskType: "generate" | "edit";
  isExecutableEditTemplate: boolean;
  isUnsupportedMaskEditTemplate: boolean;
  missingRequiredInputNames: string[];
  hasPickedEditImage: boolean;
  hasReadyImageConfiguration: boolean;
  isLoadingDefaultConfiguration: boolean;
  isPickingEditImage: boolean;
  isSubmitting: boolean;
  activeModelCallType: ModelCallType | null;
}

/**
 * 把「为什么不能提交」从一个布尔量拆成可解释的单一原因。
 *
 * 一次只讲一个最该先解决的原因，优先级固定为：正在提交 > 全局锁被占用 >
 * 模板不受支持 > 模型配置加载中 > 模型未配置 > 缺输入图片 > 缺必填输入 >
 * 正在选图。
 */
export function getTaskSubmitState(input: TaskSubmitStateInput): TaskSubmitState {
  const block = getTaskSubmitBlock(input);
  return { canSubmit: block === null, block };
}

function getTaskSubmitBlock(input: TaskSubmitStateInput): TaskSubmitBlock | null {
  if (input.isSubmitting) {
    return { kind: "submitting", message: "正在提交任务，请稍候。" };
  }

  if (input.activeModelCallType !== null) {
    return {
      kind: "model_call_in_progress",
      message: `${getModelCallStatusLabel(input.activeModelCallType)}，请等待其完成。`,
    };
  }

  if (input.isUnsupportedMaskEditTemplate) {
    return {
      kind: "unsupported_template",
      message: "该条目包含蒙版输入，当前版本暂不支持执行。",
    };
  }

  // edit 条目必须声明 image 输入才可执行；否则同样不给提交（与 handleSubmit 的
  // 首个守卫一致），避免声明不完整的模板走到模型调用。
  if (input.taskType === "edit" && !input.isExecutableEditTemplate) {
    return {
      kind: "unsupported_template",
      message: "该条目的输入声明不完整，当前版本无法执行。",
    };
  }

  if (input.isLoadingDefaultConfiguration) {
    return {
      kind: "loading_model_configuration",
      message: "正在加载图片模型配置。",
    };
  }

  if (!input.hasReadyImageConfiguration) {
    return {
      kind: "missing_model_configuration",
      message: "尚未配置可用的默认图片模型。",
    };
  }

  if (input.isExecutableEditTemplate && !input.hasPickedEditImage) {
    return { kind: "missing_edit_image", message: "请先选择输入图片。" };
  }

  if (input.missingRequiredInputNames.length > 0) {
    return {
      kind: "missing_required_inputs",
      message: `必填输入 ${input.missingRequiredInputNames.join("、")} 未填写。`,
    };
  }

  if (input.isPickingEditImage) {
    return { kind: "picking_edit_image", message: "正在选择图片。" };
  }

  return null;
}
