import { describe, expect, it } from "vitest";

import {
  getGlobalModelCallStatusBottomOffset,
  isGlobalModelCallStatusTabRoute,
} from "./global-model-call-status-layout";

describe("global model call status layout", () => {
  it("只把 tabs 路由识别为原生 Tab 页面", () => {
    expect(
      isGlobalModelCallStatusTabRoute(["(tabs)", "(catalog)", "index"]),
    ).toBe(true);
    expect(isGlobalModelCallStatusTabRoute(["history", "history-1"])).toBe(
      false,
    );
    expect(isGlobalModelCallStatusTabRoute([])).toBe(false);
  });

  it("详情页始终位于底部安全区与边缘间距之上", () => {
    expect(
      getGlobalModelCallStatusBottomOffset({
        safeAreaBottom: 34,
        isTabRoute: false,
      }),
    ).toBe(34);
    expect(
      getGlobalModelCallStatusBottomOffset({
        safeAreaBottom: 0,
        isTabRoute: false,
      }),
    ).toBe(12);
  });

  it("Tab 页面在安全区之外继续避让原生 Tab 栏", () => {
    expect(
      getGlobalModelCallStatusBottomOffset({
        safeAreaBottom: 34,
        isTabRoute: true,
      }),
    ).toBe(98);
    expect(
      getGlobalModelCallStatusBottomOffset({
        safeAreaBottom: Number.NaN,
        isTabRoute: true,
      }),
    ).toBe(76);
  });
});
