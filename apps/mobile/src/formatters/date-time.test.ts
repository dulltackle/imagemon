import { describe, expect, it, vi } from "vitest";

import { formatLocalDateTime } from "./date-time";

describe("formatLocalDateTime", () => {
  it("按本地时间输出固定的年月日时分", () => {
    expect(formatLocalDateTime("2026-01-02T03:04:00")).toBe(
      "2026-01-02 03:04",
    );
  });

  it("为月、日、时和分补零", () => {
    expect(formatLocalDateTime(new Date(2026, 0, 2, 3, 4))).toBe(
      "2026-01-02 03:04",
    );
  });

  it("跨年日期始终保留年份", () => {
    expect(formatLocalDateTime(new Date(2025, 11, 31, 23, 59))).toBe(
      "2025-12-31 23:59",
    );
    expect(formatLocalDateTime(new Date(2026, 0, 1, 0, 0))).toBe(
      "2026-01-01 00:00",
    );
  });

  it("无效时间返回时间未知", () => {
    expect(formatLocalDateTime("not-a-date")).toBe("时间未知");
  });

  it("不依赖 Intl.DateTimeFormat", () => {
    const dateTimeFormat = vi
      .spyOn(Intl, "DateTimeFormat")
      .mockImplementation(() => {
        throw new Error("不应调用 Intl.DateTimeFormat");
      });

    expect(formatLocalDateTime("2026-01-02T03:04:00")).toBe(
      "2026-01-02 03:04",
    );
    expect(dateTimeFormat).not.toHaveBeenCalled();
  });
});
