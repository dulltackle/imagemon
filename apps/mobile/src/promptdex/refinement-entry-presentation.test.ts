import { describe, expect, it } from "vitest";

import { getTemplateRefinementEntryPresentation } from "./refinement-entry-presentation";

describe("模板提炼首页入口", () => {
  it("只有当前进程存在提炼调用时才显示进行中", () => {
    expect(
      getTemplateRefinementEntryPresentation(true, null, "generating")
        .status,
    ).toBe("进行中");
  });

  it("重启遗留的 generating 草稿没有 active call 时显示待处理", () => {
    expect(
      getTemplateRefinementEntryPresentation(false, "uncertain", "generating"),
    ).toMatchObject({
      icon: "warning",
      status: "待处理",
    });
    expect(
      getTemplateRefinementEntryPresentation(false, null, "generating")
        .status,
    ).toBe("待处理");
  });

  it("成功提示显示待确认，失败提示显示待处理", () => {
    expect(
      getTemplateRefinementEntryPresentation(
        false,
        "succeeded",
        "ready_for_review",
      ).status,
    ).toBe("待确认");
    expect(
      getTemplateRefinementEntryPresentation(false, "failed", "failed")
        .status,
    ).toBe("待处理");
  });
});
