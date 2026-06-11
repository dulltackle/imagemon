import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const helperPath = resolve("skills/imagemon-promptdex/scripts/promptdex-task.mjs");
let tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs = [];
});

describe("Promptdex 任务辅助脚本", () => {
  it("通过临时文件安全传递超长提示词并在成功后清理", () => {
    const isolated = createIsolatedScripts();
    const content = `反引号 \` 引号 " 尖括号 <tag> # 标题\n${"长内容".repeat(1500)}`;
    const result = runTask(isolated.helper, {
      template: "light-infographic",
      inputs: { content },
      options: { out: "./custom-output" },
    }, isolated.cwd);

    expect(result.status).toBe(0);
    expect(result.json).toMatchObject({ ok: true, files: [resolve(isolated.cwd, "custom-output", "image.png")] });
    const record = JSON.parse(readFileSync(isolated.recordPath, "utf8"));
    expect(record.prompt).toBe(content);
    expect(record.imagemonArgs.join(" ")).not.toContain(content);
    expect(record.renderArgs.join(" ")).not.toContain(content);
    expect(record.inputMode).toBe(0o600);
    expect(record.promptMode).toBe(0o600);
    expect(existsSync(record.tempDir)).toBe(false);
  });

  it("拒绝无效 stdin、未知字段和命令行任务内容", () => {
    const isolated = createIsolatedScripts();
    for (const invocation of [
      spawnSync(process.execPath, [isolated.helper], { cwd: isolated.cwd, input: "{", encoding: "utf8" }),
      spawnSync(process.execPath, [isolated.helper], {
        cwd: isolated.cwd,
        input: JSON.stringify({ template: "x", inputs: {}, unknown: true }),
        encoding: "utf8",
      }),
      spawnSync(process.execPath, [isolated.helper, "user-content"], {
        cwd: isolated.cwd,
        input: JSON.stringify({ template: "x", inputs: {} }),
        encoding: "utf8",
      }),
    ]) {
      expect(invocation.status).not.toBe(0);
      expect(JSON.parse(invocation.stdout).error.code).toBe("INVALID_REQUEST");
    }
  });

  it("Render、Imagemon 和子进程启动失败时均清理临时目录", () => {
    for (const failure of ["render", "imagemon", "spawn"]) {
      const isolated = createIsolatedScripts(failure);
      const result = runTask(isolated.helper, { template: "x", inputs: { content: "x" } }, isolated.cwd);
      expect(result.status).not.toBe(0);
      const record = JSON.parse(readFileSync(isolated.recordPath, "utf8"));
      expect(existsSync(record.tempDir)).toBe(false);
    }
  });
});

function createIsolatedScripts(failure?: string) {
  const root = createTempDir();
  const scripts = join(root, "scripts");
  const cwd = join(root, "project");
  mkdirSync(scripts, { recursive: true });
  mkdirSync(cwd);
  const helper = join(scripts, "promptdex-task.mjs");
  const recordPath = join(root, "record.json");
  cpSync(helperPath, helper);
  writeFileSync(join(scripts, "promptdex.mjs"), promptdexStub);
  if (failure !== "spawn") writeFileSync(join(scripts, "imagemon.mjs"), imagemonStub);
  writeFileSync(join(cwd, "imagemon.config.json"), JSON.stringify({ recordPath, failure }));
  return { helper, cwd, recordPath };
}

function runTask(helper: string, request: unknown, cwd: string) {
  const result = spawnSync(process.execPath, [helper], {
    cwd,
    input: JSON.stringify(request),
    encoding: "utf8",
  });
  return { ...result, json: JSON.parse(result.stdout) };
}

function createTempDir() {
  const dir = mkdtempSync(join(tmpdir(), "promptdex-task-test-"));
  tempDirs.push(dir);
  return dir;
}

const promptdexStub = `
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
const args = process.argv.slice(2);
const value = name => args[args.indexOf(name) + 1];
const config = JSON.parse(readFileSync(resolve("imagemon.config.json"), "utf8"));
const inputsPath = value("--inputs-file");
const promptPath = value("--prompt-file");
const inputs = JSON.parse(readFileSync(inputsPath, "utf8"));
const record = { tempDir: dirname(inputsPath), renderArgs: args, inputMode: statSync(inputsPath).mode & 0o777 };
writeFileSync(config.recordPath, JSON.stringify(record));
if (config.failure === "render") {
  console.log(JSON.stringify({ ok: false, error: { code: "MISSING_INPUT", message: "失败" } }));
  process.exitCode = 1;
} else {
  writeFileSync(promptPath, inputs.content, { mode: 0o600, flag: "wx" });
  console.log(JSON.stringify({ ok: true, taskType: "generate", promptFile: promptPath }));
}
`;

const imagemonStub = `
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
const args = process.argv.slice(2);
const value = name => args[args.indexOf(name) + 1];
const config = JSON.parse(readFileSync(resolve("imagemon.config.json"), "utf8"));
const record = JSON.parse(readFileSync(config.recordPath, "utf8"));
record.imagemonArgs = args;
record.prompt = readFileSync(value("--prompt-file"), "utf8");
record.promptMode = (await import("node:fs")).statSync(value("--prompt-file")).mode & 0o777;
writeFileSync(config.recordPath, JSON.stringify(record));
if (config.failure === "imagemon") {
  console.log(JSON.stringify({ ok: false, files: [], metadataPath: null, error: { code: "EXECUTION_ERROR", message: "失败" } }));
  process.exitCode = 1;
} else {
  const out = resolve(value("--out"));
  mkdirSync(out, { recursive: true });
  console.log(JSON.stringify({ ok: true, files: [resolve(out, "image.png")], metadataPath: resolve(out, "image.json") }));
}
`;
