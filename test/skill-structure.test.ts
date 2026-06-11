import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const checkerPath = resolve("scripts/check-skills.mjs");
let tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs = [];
});

describe("三项 Skill 结构校验", () => {
  it("接受最小合法 skill 套件", () => {
    expect(runChecker(createSuite()).status).toBe(0);
  });

  it("拒绝 frontmatter 名称与目录名不一致", () => {
    const root = createSuite();
    writeSkill(root, "imagemon", "wrong-name");
    expect(runChecker(root).stderr).toContain("name 必须与目录名一致");
  });

  it("拒绝缺失必需 reference、script 或 eval 文件", () => {
    const root = createSuite({ omit: "skills/imagemon-promptdex/scripts/promptdex.mjs" });
    expect(runChecker(root).stderr).toContain("缺少必需文件");
  });

  it.each([
    ["缺少字段", [{ id: "yes", prompt: "触发", shouldTrigger: true, reason: "正向" }, { id: "no", prompt: "不触发", shouldTrigger: false }]],
    ["ID 重复", [{ id: "same", prompt: "触发", shouldTrigger: true, reason: "正向" }, { id: "same", prompt: "不触发", shouldTrigger: false, reason: "负向" }]],
    ["shouldTrigger 非布尔值", [{ id: "yes", prompt: "触发", shouldTrigger: "true", reason: "正向" }, { id: "no", prompt: "不触发", shouldTrigger: false, reason: "负向" }]],
  ])("拒绝 trigger case %s", (_label, cases) => {
    const root = createSuite();
    writeJson(root, "skills/imagemon/evals/trigger-cases.json", { skill: "imagemon", cases });
    expect(runChecker(root).status).not.toBe(0);
  });

  it("拒绝 Builder 或 Promptdex 中不存在的相对引用", () => {
    const root = createSuite();
    writeSkill(root, "imagemon-promptdex", "imagemon-promptdex", `${promptdexBody}\n[缺失](references/missing.md)`);
    expect(runChecker(root).stderr).toContain("references/missing.md");
  });

  it("拒绝 Promptdex 未声明保持调用方项目工作目录", () => {
    const root = createSuite();
    writeSkill(root, "imagemon-promptdex", "imagemon-promptdex", "node <skill-root>/scripts/promptdex.mjs list");
    expect(runChecker(root).stderr).toContain("必须声明保持调用方项目工作目录");
  });

  it("拒绝 Promptdex 未声明相对输出目录基于调用方项目工作目录", () => {
    const root = createSuite();
    writeSkill(
      root,
      "imagemon-promptdex",
      "imagemon-promptdex",
      promptdexBody.replace("相对输出目录相对于 `<project-root>` 解析。\n", ""),
    );
    expect(runChecker(root).stderr).toContain("必须声明相对输出目录基于调用方项目工作目录解析");
  });

  it("拒绝 Promptdex 使用相对于 skill 目录的裸脚本路径", () => {
    const root = createSuite();
    writeSkill(root, "imagemon-promptdex", "imagemon-promptdex", `${promptdexBody}\nnode scripts/imagemon.mjs generate`);
    expect(runChecker(root).stderr).toContain("不得使用相对于 skill 目录的裸脚本路径");
  });
});

function createSuite(options: { omit?: string } = {}) {
  const root = mkdtempSync(join(tmpdir(), "skill-structure-test-"));
  tempDirs.push(root);
  const files = [
    "skills/imagemon/references/cli-contract.md",
    "skills/imagemon/scripts/imagemon.mjs",
    "skills/imagemon-promptdex/references/template-contract.md",
    "skills/imagemon-promptdex/references/templates/light-infographic.md",
    "skills/imagemon-promptdex/scripts/imagemon.mjs",
    "skills/imagemon-promptdex/scripts/promptdex.mjs",
    "skills/imagemon-promptdex-builder/references/refinement-policy.md",
    "skills/imagemon-promptdex-builder/references/proposal-format.md",
  ];
  for (const file of files) if (file !== options.omit) write(root, file, "占位\n");
  for (const skill of ["imagemon", "imagemon-promptdex", "imagemon-promptdex-builder"]) {
    writeSkill(root, skill, skill, skill === "imagemon-promptdex" ? promptdexBody : "说明");
    writeJson(root, `skills/${skill}/evals/trigger-cases.json`, {
      skill,
      cases: [
        { id: "yes", prompt: "触发", shouldTrigger: true, reason: "正向" },
        { id: "no", prompt: "不触发", shouldTrigger: false, reason: "负向" },
      ],
    });
  }
  if (options.omit?.endsWith("trigger-cases.json")) rmSync(join(root, options.omit));
  return root;
}

function writeSkill(root: string, directory: string, name: string, body = "说明") {
  write(root, `skills/${directory}/SKILL.md`, `---\nname: ${name}\ndescription: 描述\n---\n\n${body}\n`);
}

function writeJson(root: string, path: string, value: unknown) {
  write(root, path, `${JSON.stringify(value, null, 2)}\n`);
}

function write(root: string, path: string, value: string) {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, value);
}

function runChecker(root: string) {
  return spawnSync(process.execPath, [checkerPath, "--root", root], { encoding: "utf8" });
}

const promptdexBody = `
保持 \`<project-root>\` 为当前工作目录，不得切换到 \`<skill-root>\`。
相对输出目录相对于 \`<project-root>\` 解析。
node <skill-root>/scripts/promptdex.mjs list
node <skill-root>/scripts/imagemon.mjs generate
`;
