import { describe, expect, it } from "vitest";

import {
  getTaskSubmitState,
  type TaskSubmitStateInput,
} from "./task-form-submit-state";

function submitStateInput(
  overrides: Partial<TaskSubmitStateInput> = {},
): TaskSubmitStateInput {
  return {
    taskType: "generate",
    isExecutableEditTemplate: false,
    isUnsupportedMaskEditTemplate: false,
    missingRequiredInputNames: [],
    hasPickedEditImage: false,
    hasReadyImageConfiguration: true,
    isLoadingDefaultConfiguration: false,
    isPickingEditImage: false,
    isSubmitting: false,
    activeModelCallType: null,
    ...overrides,
  };
}

describe("getTaskSubmitState", () => {
  it("条件齐备时可提交且没有阻塞原因", () => {
    expect(getTaskSubmitState(submitStateInput())).toEqual({
      canSubmit: true,
      block: null,
    });
  });

  it("提交中时报「正在提交」", () => {
    const state = getTaskSubmitState(
      submitStateInput({ isSubmitting: true }),
    );

    expect(state.canSubmit).toBe(false);
    expect(state.block?.kind).toBe("submitting");
  });

  it("全局锁被占用时复用模型调用状态文案", () => {
    const state = getTaskSubmitState(
      submitStateInput({ activeModelCallType: "templateRefinement" }),
    );

    expect(state.canSubmit).toBe(false);
    expect(state.block).toEqual({
      kind: "model_call_in_progress",
      message: "模板提炼进行中，请等待其完成。",
    });
  });

  it("蒙版编辑条目不可执行", () => {
    const state = getTaskSubmitState(
      submitStateInput({
        taskType: "edit",
        isUnsupportedMaskEditTemplate: true,
      }),
    );

    expect(state.canSubmit).toBe(false);
    expect(state.block?.kind).toBe("unsupported_template");
  });

  it("edit 条目未声明 image 输入时同样不可执行", () => {
    const state = getTaskSubmitState(
      submitStateInput({
        taskType: "edit",
        isExecutableEditTemplate: false,
        isUnsupportedMaskEditTemplate: false,
      }),
    );

    expect(state.canSubmit).toBe(false);
    expect(state.block?.kind).toBe("unsupported_template");
  });

  it("模型配置加载中时报加载中", () => {
    const state = getTaskSubmitState(
      submitStateInput({ isLoadingDefaultConfiguration: true }),
    );

    expect(state.canSubmit).toBe(false);
    expect(state.block?.kind).toBe("loading_model_configuration");
  });

  it("没有就绪的默认图片模型时报模型未配置", () => {
    const state = getTaskSubmitState(
      submitStateInput({ hasReadyImageConfiguration: false }),
    );

    expect(state.canSubmit).toBe(false);
    expect(state.block?.kind).toBe("missing_model_configuration");
  });

  it("可执行 edit 条目未选图片时报缺少输入图片", () => {
    const state = getTaskSubmitState(
      submitStateInput({
        taskType: "edit",
        isExecutableEditTemplate: true,
        hasPickedEditImage: false,
      }),
    );

    expect(state.canSubmit).toBe(false);
    expect(state.block?.kind).toBe("missing_edit_image");
  });

  it("缺少单个必填输入时点名该输入", () => {
    const state = getTaskSubmitState(
      submitStateInput({ missingRequiredInputNames: ["content"] }),
    );

    expect(state.canSubmit).toBe(false);
    expect(state.block).toEqual({
      kind: "missing_required_inputs",
      message: "必填输入 content 未填写。",
    });
  });

  it("缺少多个必填输入时用顿号连接", () => {
    const state = getTaskSubmitState(
      submitStateInput({ missingRequiredInputNames: ["content", "title"] }),
    );

    expect(state.block?.message).toBe("必填输入 content、title 未填写。");
  });

  it("正在选择图片时报正在选图", () => {
    const state = getTaskSubmitState(
      submitStateInput({
        taskType: "edit",
        isExecutableEditTemplate: true,
        hasPickedEditImage: true,
        isPickingEditImage: true,
      }),
    );

    expect(state.canSubmit).toBe(false);
    expect(state.block?.kind).toBe("picking_edit_image");
  });

  it("提交中优先于缺必填输入", () => {
    const state = getTaskSubmitState(
      submitStateInput({
        isSubmitting: true,
        missingRequiredInputNames: ["content"],
      }),
    );

    expect(state.block?.kind).toBe("submitting");
  });

  it("全局锁占用优先于模型未配置", () => {
    const state = getTaskSubmitState(
      submitStateInput({
        activeModelCallType: "modelConfigurationTest",
        hasReadyImageConfiguration: false,
      }),
    );

    expect(state.block?.kind).toBe("model_call_in_progress");
  });

  it("可执行 edit 条目在选好图片且输入齐备时可提交", () => {
    const state = getTaskSubmitState(
      submitStateInput({
        taskType: "edit",
        isExecutableEditTemplate: true,
        hasPickedEditImage: true,
      }),
    );

    expect(state).toEqual({ canSubmit: true, block: null });
  });
});
