import { afterEach, describe, expect, it, vi } from "vitest";

import { createRandomId } from "./ids";

describe("createRandomId", () => {
  const originalCrypto = globalThis.crypto;

  afterEach(() => {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: originalCrypto,
    });
    vi.restoreAllMocks();
  });

  it("优先使用 crypto.randomUUID", () => {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: {
        randomUUID: () => "uuid-1",
      },
    });

    expect(createRandomId()).toBe("uuid-1");
  });

  it("在 randomUUID 不可用时返回非空字符串", () => {
    vi.spyOn(Date, "now").mockReturnValue(123456);
    vi.spyOn(Math, "random").mockReturnValue(0.42);
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: {},
    });

    expect(createRandomId()).toMatch(/^[a-z0-9]+-[a-z0-9]+$/);
  });
});
