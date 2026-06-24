import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runPromptdexRuntime } from "../src/promptdex-runtime.js";

let tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs = [];
});

describe("Promptdex TypeScript 运行时入口", () => {
  it("复用 core 规则完成 list、inspect、render 和 validate", async () => {
    const templatesDir = createTemplatesDir();
    writeTemplate(templatesDir, "light-card.md", generateTemplate);
    writeTemplate(templatesDir, "edit-card.md", editTemplate);

    const listed = await run(["list"], templatesDir);
    expect(listed).toMatchObject({ code: 0, json: { ok: true, command: "list" } });
    expect(listed.json.templates).toEqual([
      {
        name: "edit-card",
        description: "编辑卡片",
        taskType: "edit",
        inputs: [
          { name: "image", required: true, description: "原图" },
          { name: "instruction", required: true, description: "编辑要求" },
        ],
      },
      {
        name: "light-card",
        description: "浅色卡片",
        taskType: "generate",
        inputs: [{ name: "content", required: true, description: "主要内容" }],
      },
    ]);
    expect(JSON.stringify(listed.json.templates)).not.toContain("# 浅色卡片");

    const inspected = await run(["inspect", "--template", "light-card"], templatesDir);
    expect(inspected.json.template.body).toContain("# 浅色卡片");

    const inputsPath = writeJson({ content: "核心内容\n" });
    const rendered = await run(["render", "--template", "light-card", "--inputs-file", inputsPath], templatesDir);
    expect(rendered.json.prompt).toMatch(/### content\n核心内容\n$/);

    const promptFile = join(createTempDir(), "prompt.txt");
    const fileRendered = await run(
      ["render", "--template", "light-card", "--inputs-file", inputsPath, "--prompt-file", promptFile],
      templatesDir,
    );
    expect(fileRendered.json).toMatchObject({ ok: true, promptFile: resolve(promptFile) });
    expect(fileRendered.json).not.toHaveProperty("prompt");
    expect(readFileSync(promptFile, "utf8")).toContain("核心内容");
    expect(statSync(promptFile).mode & 0o777).toBe(0o600);

    expect((await run(["validate"], templatesDir)).json.templates).toBe(2);
  });

  it("输出稳定错误码并避免把完整提示词写入 stdout", async () => {
    const templatesDir = createTemplatesDir();
    writeTemplate(templatesDir, "light-card.md", generateTemplate);
    const inputsPath = writeJson({ content: "核心内容" });
    const promptFile = join(createTempDir(), "prompt.txt");
    writeFileSync(promptFile, "exists");

    expect((await run(["inspect", "--template", "../light-card"], templatesDir)).json.error.code).toBe(
      "UNKNOWN_TEMPLATE",
    );
    expect((await run(["render", "--template", "light-card", "--inputs-file", writeRaw("{")], templatesDir)).json.error.code)
      .toBe("INVALID_INPUTS");
    expect((await run(["render", "--template", "light-card", "--inputs-file", inputsPath, "--prompt-file", promptFile], templatesDir)).json.error.code)
      .toBe("EXECUTION_ERROR");
    expect((await run(["render", "--template"], templatesDir)).json.error.code).toBe("INVALID_OPTION");
    expect((await run(["missing"], templatesDir)).json.error.code).toBe("INVALID_COMMAND");
    expect((await run(["list"], join(createTempDir(), "missing"))).json.error.code).toBe("INVALID_TEMPLATE");
  });
});

async function run(args: string[], templatesDir: string) {
  let stdout = "";
  const code = await runPromptdexRuntime(args, {
    templatesDir,
    streams: {
      stdout: { write: (chunk: string) => Boolean((stdout += chunk)) },
    },
  });
  return { code, stdout, json: JSON.parse(stdout) };
}

function createTemplatesDir() {
  const dir = join(createTempDir(), "templates");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function createTempDir() {
  const dir = mkdtempSync(join(tmpdir(), "promptdex-runtime-source-test-"));
  tempDirs.push(dir);
  return dir;
}

function writeTemplate(dir: string, fileName: string, source: string) {
  writeFileSync(join(dir, fileName), source);
}

function writeJson(value: unknown) {
  return writeRaw(JSON.stringify(value));
}

function writeRaw(value: string) {
  const path = join(createTempDir(), "inputs.json");
  writeFileSync(path, value);
  return path;
}

const generateTemplate = `---
name: light-card
description: 浅色卡片
inputs:
  content:
    required: true
    description: 主要内容
---

# 浅色卡片

保持简洁。
`;

const editTemplate = `---
name: edit-card
description: 编辑卡片
inputs:
  image:
    required: true
    description: 原图
  instruction:
    required: true
    description: 编辑要求
---

# 编辑卡片

按要求编辑。
`;
