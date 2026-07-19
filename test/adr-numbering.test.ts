import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const checkerPath = resolve("scripts/check-adrs.mjs");
let tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs = [];
});

describe("ADR 编号校验", () => {
  it("接受多个上下文中的全局唯一编号", () => {
    const root = createFixture({
      "docs/adr/0001-root-decision.md": "# 根决策\n",
      "contexts/mobile/docs/adr/0002-mobile-decision.md": "# 移动端决策\n",
    });

    const result = runChecker(root);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("2 份 ADR 全局唯一");
  });

  it("拒绝跨上下文重复的 ADR 编号并报告全部路径", () => {
    const root = createFixture({
      "docs/adr/0001-root-decision.md": "# 根决策\n",
      "contexts/mobile/docs/adr/0001-mobile-decision.md": "# 移动端决策\n",
    });

    const result = runChecker(root);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("ADR 编号 0001 重复");
    expect(result.stderr).toContain("docs/adr/0001-root-decision.md");
    expect(result.stderr).toContain("contexts/mobile/docs/adr/0001-mobile-decision.md");
  });

  it("拒绝同一上下文重复的 ADR 编号并报告全部路径", () => {
    const root = createFixture({
      "docs/adr/0001-first-decision.md": "# 第一项决策\n",
      "docs/adr/0001-second-decision.md": "# 第二项决策\n",
    });

    const result = runChecker(root);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("ADR 编号 0001 重复");
    expect(result.stderr).toContain("docs/adr/0001-first-decision.md");
    expect(result.stderr).toContain("docs/adr/0001-second-decision.md");
  });

  it.each([
    "docs/adr/decision-without-number.md",
    "docs/adr/0001-.md",
  ])("拒绝非法 ADR 文件名：%s", (path) => {
    const root = createFixture({ [path]: "# 非法决策\n" });

    const result = runChecker(root);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("<四位编号>-<slug>.md");
    expect(result.stderr).toContain(path);
  });
});

function createFixture(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "adr-numbering-test-"));
  tempDirs.push(root);
  for (const [path, source] of Object.entries(files)) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, source);
  }
  return root;
}

function runChecker(root: string) {
  return spawnSync(process.execPath, [checkerPath, "--root", root], {
    encoding: "utf8",
  });
}
