import { describe, expect, it } from "vitest";

import { getPressFeedbackClassNameProps } from "./press-feedback";

describe("Web 按压反馈类名", () => {
  it("未启用延迟时保留完整类名", () => {
    expect(
      getPressFeedbackClassNameProps(
        "web",
        undefined,
        "bg-app-surface active:bg-app-action-soft",
      ),
    ).toEqual({
      className: "bg-app-surface active:bg-app-action-soft",
    });
  });

  it.each(["android", "ios"])("%s 保留原生 active 类", (runtimeOS) => {
    expect(
      getPressFeedbackClassNameProps(
        runtimeOS,
        100,
        "bg-app-surface active:bg-app-action-soft",
      ),
    ).toEqual({
      className: "bg-app-surface active:bg-app-action-soft",
    });
  });

  it("Web 移除由显式 pressed 样式接管的 active 类", () => {
    expect(
      getPressFeedbackClassNameProps(
        "web",
        100,
        "bg-app-surface active:bg-app-action-soft active:opacity-75",
      ),
    ).toEqual({
      className: "bg-app-surface",
    });
  });

  it("Web 保留非 active 变体并整理空白", () => {
    expect(
      getPressFeedbackClassNameProps(
        "web",
        100,
        "  hover:opacity-90   active:bg-app-action-soft disabled:opacity-50  ",
      ),
    ).toEqual({
      className: "hover:opacity-90 disabled:opacity-50",
    });
  });

  it("显式零延迟仍移除浏览器 active 类", () => {
    expect(
      getPressFeedbackClassNameProps(
        "web",
        0,
        "active:bg-app-action-soft",
      ),
    ).toEqual({
      className: undefined,
    });
  });
});
