import { describe, expect, it, vi } from "vitest";

import { getPressFeedbackDelayStyle } from "./press-feedback";

describe("Web 按压反馈延迟样式", () => {
  it("未启用延迟时保留原样式引用", () => {
    const style = { opacity: 0.8 };

    expect(getPressFeedbackDelayStyle("web", undefined, style)).toBe(style);
  });

  it("原生平台不增加 Web transition delay", () => {
    const style = { opacity: 0.8 };

    expect(getPressFeedbackDelayStyle("android", 100, style)).toBe(style);
    expect(getPressFeedbackDelayStyle("ios", 100, style)).toBe(style);
  });

  it("Web 静态样式追加同值 transition delay", () => {
    const style = { opacity: 0.8 };

    expect(getPressFeedbackDelayStyle("web", 100, style)).toEqual([
      style,
      { transitionDelay: "100ms" },
    ]);
  });

  it("Web 保留样式回调并在结果后追加 delay", () => {
    const style = vi.fn(({ pressed }: { pressed: boolean }) => ({
      opacity: pressed ? 0.8 : 1,
    }));
    const delayedStyle = getPressFeedbackDelayStyle("web", 100, style);

    expect(typeof delayedStyle).toBe("function");
    if (typeof delayedStyle !== "function") {
      throw new Error("Web 样式回调未被保留");
    }

    const state = { focused: false, hovered: false, pressed: true };

    expect(delayedStyle(state)).toEqual([
      { opacity: 0.8 },
      { transitionDelay: "100ms" },
    ]);
    expect(style).toHaveBeenCalledWith(state);
  });

  it("值为 0 时显式生成零延迟样式", () => {
    expect(getPressFeedbackDelayStyle("web", 0, undefined)).toEqual([
      undefined,
      { transitionDelay: "0ms" },
    ]);
  });
});
