import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const runtimePath = resolve(".agents/skills/imagemon-promptdex/scripts/promptdex.mjs");
let tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs = [];
});

describe("Promptdex 确定性运行时", () => {
  it("list 不返回正文并识别生成任务", () => {
    const result = run(["list"]);
    expect(result.status).toBe(0);
    expect(result.json.templates.length).toBeGreaterThan(1);
    expect(templateByName(result, "light-infographic")).toMatchObject({
      name: "light-infographic",
      taskType: "generate",
    });
    expect(templateByName(result, "american-university-graduation-portrait")).toMatchObject({
      name: "american-university-graduation-portrait",
      taskType: "edit",
    });
    expect(result.json.templates.every((template: Record<string, unknown>) => !Object.hasOwn(template, "body"))).toBe(true);
    expect(result.stdout).not.toContain("# 浅色解释性信息图");
  });

  it("inspect 按模板名返回正文，未知模板失败", () => {
    const inspected = run(["inspect", "--template", "light-infographic"]);
    expect(inspected.json.template.body).toContain("# 浅色解释性信息图");
    const unknown = run(["inspect", "--template", "../light-infographic"]);
    expect(unknown.status).not.toBe(0);
    expect(unknown.json.error.code).toBe("UNKNOWN_TEMPLATE");
  });

  it("render 按声明顺序拼装输入并跳过可选输入", () => {
    const inputs = writeInputs({ title: "辅助标题", content: "核心内容" });
    const rendered = run(["render", "--template", "light-infographic", "--inputs-file", inputs]);
    expect(rendered.json.prompt.indexOf("### content")).toBeLessThan(rendered.json.prompt.indexOf("### title"));

    const requiredOnly = writeInputs({ content: "核心内容" });
    expect(run(["render", "--template", "light-infographic", "--inputs-file", requiredOnly]).json.prompt)
      .not.toContain("### title");
  });

  it("render 缺少必需输入时失败", () => {
    const result = run(["render", "--template", "light-infographic", "--inputs-file", writeInputs({})]);
    expect(result.status).not.toBe(0);
    expect(result.json.error.code).toBe("MISSING_INPUT");
  });

  it("render 文件模式写出权限受限的完整提示词且 stdout 不包含提示词", () => {
    const promptPath = join(createTempDir(), "prompt.txt");
    const inputs = writeInputs({ content: "特殊字符 ` <tag> # 标题\n下一行" });
    const result = run([
      "render",
      "--template",
      "light-infographic",
      "--inputs-file",
      inputs,
      "--prompt-file",
      promptPath,
    ]);

    expect(result.json).toMatchObject({ ok: true, taskType: "generate", promptFile: resolve(promptPath) });
    expect(result.json).not.toHaveProperty("prompt");
    expect(readFileSync(promptPath, "utf8")).toContain("特殊字符 ` <tag> # 标题\n下一行");
    expect(statSync(promptPath).mode & 0o777).toBe(0o600);
    expect(run([
      "render",
      "--template",
      "light-infographic",
      "--inputs-file",
      inputs,
      "--prompt-file",
      promptPath,
    ]).json.error.code).toBe("EXECUTION_ERROR");
  });

  it("image 和 mask 归一化后只作为文件参数返回", () => {
    const isolated = createIsolatedRuntime(editTemplate);
    const inputs = writeInputs({
      image: "  /tmp/input.png\n",
      mask: "\t/tmp/mask.png\r\n",
      instruction: "改成蓝色",
    });
    const result = run(["render", "--template", "edit-card", "--inputs-file", inputs], isolated);
    expect(result.json).toMatchObject({ taskType: "edit", image: "/tmp/input.png", mask: "/tmp/mask.png" });
    expect(result.json.prompt).not.toContain("/tmp/input.png");
    expect(result.json.prompt).not.toContain("/tmp/mask.png");
  });

  it("普通输入保留末尾换行", () => {
    const result = run([
      "render",
      "--template",
      "light-infographic",
      "--inputs-file",
      writeInputs({ content: "核心内容\n" }),
    ]);
    expect(result.json.prompt).toMatch(/### content\n核心内容\n$/);
  });

  it("拒绝非对象输入、无效 JSON 和模板目录外路径", () => {
    const array = writeInputs([]);
    expect(run(["render", "--template", "light-infographic", "--inputs-file", array]).json.error.code).toBe("INVALID_INPUTS");
    const invalid = writeRaw("{");
    expect(run(["render", "--template", "light-infographic", "--inputs-file", invalid]).json.error.code).toBe("INVALID_INPUTS");
    expect(run(["inspect", "--template", resolve(".agents/skills/imagemon-promptdex/references/templates/light-infographic.md")]).status).not.toBe(0);
  });

  it("validate 验证当前图鉴并拒绝隔离目录中的无效模板", () => {
    const listed = run(["list"]);
    expect(run(["validate"]).json).toMatchObject({
      ok: true,
      command: "validate",
      templates: listed.json.templates.length,
    });
    const isolated = createIsolatedRuntime(editTemplate.replace("name: edit-card", "name: wrong-name"));
    expect(run(["validate"], isolated).json.error.code).toBe("INVALID_TEMPLATE");
  });

  it("所有成功和失败输出均为单行 JSON", () => {
    for (const args of [["list"], ["inspect", "--template", "missing"]]) {
      const result = run(args);
      expect(result.stdout.trimEnd().split("\n")).toHaveLength(1);
      expect(() => JSON.parse(result.stdout)).not.toThrow();
    }
  });

  it("使用绝对脚本路径时可从任意工作目录发现图鉴条目", () => {
    const cwd = createTempDir();
    const result = run(["list"], runtimePath, cwd);
    expect(result.status).toBe(0);
    expect(templateByName(result, "light-infographic")).toMatchObject({ name: "light-infographic" });
  });
});

function run(args: string[], path = runtimePath, cwd?: string) {
  const result = spawnSync(process.execPath, [path, ...args], { cwd, encoding: "utf8" });
  return { ...result, json: JSON.parse(result.stdout), stdout: result.stdout };
}

function templateByName(result: ReturnType<typeof run>, name: string) {
  const template = result.json.templates.find((candidate: { name?: string }) => candidate.name === name);
  expect(template).toBeDefined();
  return template;
}

function createTempDir() {
  const dir = mkdtempSync(join(tmpdir(), "promptdex-runtime-test-"));
  tempDirs.push(dir);
  return dir;
}

function writeInputs(value: unknown) {
  return writeRaw(JSON.stringify(value));
}

function writeRaw(value: string) {
  const path = join(createTempDir(), "inputs.json");
  writeFileSync(path, value);
  return path;
}

function createIsolatedRuntime(template: string) {
  const root = createTempDir();
  const path = join(root, "scripts", "promptdex.mjs");
  mkdirSync(dirname(path), { recursive: true });
  mkdirSync(join(root, "references", "templates"), { recursive: true });
  cpSync(runtimePath, path);
  writeFileSync(join(root, "references", "templates", "edit-card.md"), template);
  return path;
}

const editTemplate = `---
name: edit-card
description: 编辑卡片
inputs:
  image:
    required: true
    description: 原图
  mask:
    required: false
    description: 蒙版
  instruction:
    required: true
    description: 编辑要求
---

# 编辑卡片

按要求编辑卡片。
`;
