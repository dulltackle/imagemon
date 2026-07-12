import { afterEach, describe, expect, it, vi } from "vitest";

import {
  APP_ICON_DEFINITIONS,
  DEFAULT_APP_ICON_DEFINITION,
  getAppIconDefinition,
  resolveSymbolIconSize,
  TAB_ICON_DEFINITIONS,
  type AppIconName,
} from "./symbol-icon-definitions";

const EXPECTED_APP_ICON_NAMES = [
  "refresh",
  "next",
  "expand",
  "connection-test",
  "confirm",
  "success",
  "checkbox-checked",
  "checkbox-empty",
  "chevron-down",
  "chevron-right",
  "chevron-up",
  "copy",
  "document",
  "warning",
  "skip",
  "settings",
  "pending",
  "information",
  "locked",
  "edit",
  "photo",
  "photos",
  "server",
  "sparkles",
  "download",
  "save",
  "favorite",
  "text-model",
  "delete",
  "empty-tray",
  "magic-wand",
  "close",
] as const satisfies readonly AppIconName[];

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("移动端语义图标目录", () => {
  it("完整冻结全部 32 个业务语义键及平台名称", () => {
    expect(Object.keys(APP_ICON_DEFINITIONS).sort()).toEqual(
      [...EXPECTED_APP_ICON_NAMES].sort(),
    );

    for (const definition of Object.values(APP_ICON_DEFINITIONS)) {
      expect(definition.ios.trim()).not.toBe("");
      expect(definition.fallback.trim()).not.toBe("");
    }
  });

  it("保存配置与下载到相册使用不同且正确的 fallback", () => {
    expect(APP_ICON_DEFINITIONS.save.ios).toBe(
      APP_ICON_DEFINITIONS.download.ios,
    );
    expect(APP_ICON_DEFINITIONS.save.fallback).toBe("save-outline");
    expect(APP_ICON_DEFINITIONS.download.fallback).toBe("download-outline");
  });

  it("警告语义在两个平台都有明确可见名称", () => {
    expect(APP_ICON_DEFINITIONS.warning).toEqual({
      ios: "exclamationmark.triangle",
      fallback: "warning-outline",
    });
  });

  it("按显式尺寸、宽、高和默认值的顺序解析 glyph 尺寸", () => {
    expect(resolveSymbolIconSize(18, 20, 22)).toBe(18);
    expect(resolveSymbolIconSize(undefined, 20, 22)).toBe(20);
    expect(resolveSymbolIconSize(undefined, "100%", 22)).toBe(22);
    expect(resolveSymbolIconSize(undefined, "100%", "2rem")).toBe(24);
    expect(
      resolveSymbolIconSize(undefined, Number.NaN, Number.POSITIVE_INFINITY),
    ).toBe(24);
  });

  it("运行时未知名称返回可见缺省定义并按名称去重告警", () => {
    vi.stubGlobal("__DEV__", true);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const firstUnknown = "runtime-unknown-first" as AppIconName;
    const secondUnknown = "runtime-unknown-second" as AppIconName;

    expect(getAppIconDefinition(firstUnknown)).toEqual(
      DEFAULT_APP_ICON_DEFINITION,
    );
    expect(getAppIconDefinition(firstUnknown)).toEqual(
      DEFAULT_APP_ICON_DEFINITION,
    );
    expect(getAppIconDefinition(secondUnknown)).toEqual(
      DEFAULT_APP_ICON_DEFINITION,
    );
    expect(DEFAULT_APP_ICON_DEFINITION.ios.trim()).not.toBe("");
    expect(DEFAULT_APP_ICON_DEFINITION.fallback.trim()).not.toBe("");
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("原型链名称也只能落到缺省定义", () => {
    vi.stubGlobal("__DEV__", false);

    expect(getAppIconDefinition("toString" as AppIconName)).toEqual(
      DEFAULT_APP_ICON_DEFINITION,
    );
    expect(getAppIconDefinition("__proto__" as AppIconName)).toEqual(
      DEFAULT_APP_ICON_DEFINITION,
    );
  });

  it("三个 NativeTabs 定义都包含 iOS 双态和 Android 名称", () => {
    expect(Object.keys(TAB_ICON_DEFINITIONS).sort()).toEqual([
      "catalog",
      "history",
      "settings",
    ]);

    for (const definition of Object.values(TAB_ICON_DEFINITIONS)) {
      expect(definition.ios.default.trim()).not.toBe("");
      expect(definition.ios.selected.trim()).not.toBe("");
      expect(definition.fallback.trim()).not.toBe("");
    }
  });
});
