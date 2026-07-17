import { describe, expect, it } from "vitest";

import { createOperationGate } from "./operation-gate";

describe("createOperationGate", () => {
  it("同一操作结束前拒绝任何重入，结束后重新开放", () => {
    const gate = createOperationGate<"preflight" | "restore">();

    expect(gate.tryEnter("preflight")).toBe(true);
    expect(gate.tryEnter("preflight")).toBe(false);
    expect(gate.tryEnter("restore")).toBe(false);
    gate.leave("restore");
    expect(gate.tryEnter("restore")).toBe(false);
    gate.leave("preflight");
    expect(gate.tryEnter("restore")).toBe(true);
  });
});
