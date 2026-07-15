import { describe, expect, it } from "vitest";

import { getPressFeedbackDelayProps } from "./press-feedback";

describe("按压反馈延迟的平台映射", () => {
  it("未传延迟时不生成底层属性", () => {
    expect(getPressFeedbackDelayProps("web", undefined)).toEqual({});
    expect(getPressFeedbackDelayProps("android", undefined)).toEqual({});
  });

  it("Web 只生成 delayPressIn", () => {
    const props = getPressFeedbackDelayProps("web", 100);

    expect(props).toEqual({ delayPressIn: 100 });
    expect(props).not.toHaveProperty("unstable_pressDelay");
  });

  it.each(["android", "ios"])("%s 只生成 unstable_pressDelay", (runtimeOS) => {
    const props = getPressFeedbackDelayProps(runtimeOS, 100);

    expect(props).toEqual({ unstable_pressDelay: 100 });
    expect(props).not.toHaveProperty("delayPressIn");
  });

  it("保留值为 0 的显式延迟", () => {
    expect(getPressFeedbackDelayProps("web", 0)).toEqual({ delayPressIn: 0 });
    expect(getPressFeedbackDelayProps("ios", 0)).toEqual({
      unstable_pressDelay: 0,
    });
  });
});
