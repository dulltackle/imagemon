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
    const uuid = "123e4567-e89b-42d3-a456-426614174000";
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: {
        randomUUID: () => uuid,
      },
    });

    expect(createRandomId()).toBe(uuid);
  });

  it("在 Web Crypto 不可用时仍返回 UUID v4", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.42);
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: {},
    });

    expect(createRandomId()).toBe("6b6b6b6b-6b6b-4b6b-ab6b-6b6b6b6b6b6b");
  });

  it("在仅有 getRandomValues 时用随机字节生成 UUID v4", () => {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: {
        getRandomValues(bytes: Uint8Array) {
          bytes.fill(0xff);
          return bytes;
        },
      },
    });

    expect(createRandomId()).toBe("ffffffff-ffff-4fff-bfff-ffffffffffff");
  });
});
