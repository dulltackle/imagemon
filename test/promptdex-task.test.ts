import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
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
  it("准备权限受限且相互隔离的随机任务", () => {
    const isolated = createIsolatedScripts();
    const first = prepareTask(isolated);
    const second = prepareTask(isolated);

    expect(first.status).toBe(0);
    expect(first.json).toMatchObject({ ok: true, command: "prepare" });
    expect(first.json.taskId).not.toBe(second.json.taskId);
    expect(first.json.requestPath).not.toBe(second.json.requestPath);
    expect(first.json.requestPath).toBe(join(isolated.tmp, "imagemon-promptdex-tasks", first.json.taskId, "request.json"));
    expect(mode(dirname(first.json.requestPath))).toBe(0o700);
    expect(mode(first.json.requestPath)).toBe(0o600);
    expect(mode(join(dirname(first.json.requestPath), "state.json"))).toBe(0o600);
    expect(first.json.inputsDir).toBe(join(dirname(first.json.requestPath), "inputs"));
    expect(mode(first.json.inputsDir)).toBe(0o700);
    expect(Date.parse(first.json.expiresAt)).toBeGreaterThan(Date.now());
  });

  it("通过受管任务目录安全传递超长提示词并在成功后清理", () => {
    const isolated = createIsolatedScripts();
    const content = `反引号 \` 引号 " 尖括号 <tag> # 标题\n${"长内容".repeat(1500)}`;
    const prepared = prepareTask(isolated).json;
    writeRequest(prepared, {
      template: "light-infographic",
      inputs: { content },
      options: { out: "./custom-output" },
    });
    const result = invoke(isolated, ["run", "--task-id", prepared.taskId]);

    expect(result.status).toBe(0);
    expect(result.json).toMatchObject({ ok: true, files: [resolve(isolated.cwd, "custom-output", "image.png")] });
    const record = JSON.parse(readFileSync(isolated.recordPath, "utf8"));
    expect(record.prompt).toBe(content);
    expect(record.imagemonArgs.join(" ")).not.toContain(content);
    expect(record.renderArgs.join(" ")).not.toContain(content);
    expect(record.inputMode).toBe(0o600);
    expect(record.promptMode).toBe(0o600);
    expect(existsSync(dirname(prepared.requestPath))).toBe(false);
  });

  it("向 Imagemon 传递已移除首尾空白的 image 和 mask 路径", () => {
    const isolated = createIsolatedScripts();
    const prepared = prepareTask(isolated).json;
    writeRequest(prepared, {
      template: "edit-card",
      inputs: {
        image: "  ./input.png\n",
        mask: "\t./mask.png\r\n",
        instruction: "改成蓝色",
      },
    });
    const result = invoke(isolated, ["run", "--task-id", prepared.taskId]);

    expect(result.status).toBe(0);
    const record = JSON.parse(readFileSync(isolated.recordPath, "utf8"));
    expect(record.imagemonArgs).toContain("./input.png");
    expect(record.imagemonArgs).toContain("./mask.png");
    expect(record.imagemonArgs).not.toContain("  ./input.png\n");
    expect(record.imagemonArgs).not.toContain("\t./mask.png\r\n");
  });

  it("取消 prepared 任务并删除任务目录", () => {
    const isolated = createIsolatedScripts();
    const prepared = prepareTask(isolated).json;
    const result = invoke(isolated, ["cancel", "--task-id", prepared.taskId]);

    expect(result).toMatchObject({ status: 0, json: { ok: true, command: "cancel", taskId: prepared.taskId } });
    expect(existsSync(dirname(prepared.requestPath))).toBe(false);
  });

  it("拒绝重复执行或取消已被其他进程占用的任务", () => {
    const isolated = createIsolatedScripts();
    const prepared = prepareTask(isolated).json;
    const taskDir = dirname(prepared.requestPath);
    writeFileSync(join(taskDir, "claim.lock"), "", { mode: 0o600 });

    for (const command of ["run", "cancel"]) {
      const result = invoke(isolated, [command, "--task-id", prepared.taskId]);
      expect(result.status).not.toBe(0);
      expect(result.json.error.code).toBe("INVALID_TASK_STATE");
      expect(existsSync(taskDir)).toBe(true);
    }
  });

  it("拒绝无命令、旧 stdin、无效 task-id 和任意请求路径", () => {
    const isolated = createIsolatedScripts();
    for (const invocation of [
      invoke(isolated, []),
      invoke(isolated, [], JSON.stringify({ template: "x", inputs: {} })),
      invoke(isolated, ["run", "--task-id", "not-a-uuid"]),
      invoke(isolated, ["run", "--request-file", "/tmp/request.json"]),
    ]) {
      expect(invocation.status).not.toBe(0);
      expect(invocation.json.error.code).toMatch(/^INVALID_/);
    }
    expect(invoke(isolated, [], "{}").json.error.message).toContain("不再支持 stdin 请求");
  });

  it("拒绝无效请求并清理任务目录", () => {
    const isolated = createIsolatedScripts();
    for (const request of [
      "{",
      JSON.stringify({ template: "x", options: { unknown: true } }),
      JSON.stringify({ template: "x", inputs: { content: "x" } }),
    ]) {
      const prepared = prepareTask(isolated).json;
      writeFileSync(prepared.requestPath, request);
      const result = invoke(isolated, ["run", "--task-id", prepared.taskId]);
      expect(result.status).not.toBe(0);
      expect(result.json.error.code).toBe("INVALID_REQUEST");
      expect(existsSync(dirname(prepared.requestPath))).toBe(false);
    }
  });

  it("拒绝符号链接、篡改状态、缺失状态和非受管目录", () => {
    const isolated = createIsolatedScripts();

    const linked = prepareTask(isolated).json;
    unlinkSync(linked.requestPath);
    symlinkSync(isolated.recordPath, linked.requestPath);
    expect(invoke(isolated, ["run", "--task-id", linked.taskId]).json.error.code).toBe("INVALID_TASK");

    const tampered = prepareTask(isolated).json;
    const statePath = join(dirname(tampered.requestPath), "state.json");
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    writeFileSync(statePath, JSON.stringify({ ...state, taskId: "00000000-0000-4000-8000-000000000000" }));
    chmodSync(statePath, 0o600);
    expect(invoke(isolated, ["run", "--task-id", tampered.taskId]).json.error.code).toBe("INVALID_TASK");

    const missing = prepareTask(isolated).json;
    unlinkSync(join(dirname(missing.requestPath), "state.json"));
    expect(invoke(isolated, ["run", "--task-id", missing.taskId]).json.error.code).toBe("INVALID_TASK");

    const fakeId = "00000000-0000-4000-8000-000000000000";
    mkdirSync(join(isolated.tmp, "imagemon-promptdex-tasks", fakeId), { mode: 0o700 });
    expect(invoke(isolated, ["run", "--task-id", fakeId]).json.error.code).toBe("INVALID_TASK");
  });

  it("拒绝非法输入文件名和输入目录中的符号链接并清理任务目录", () => {
    const isolated = createIsolatedScripts();

    const badName = prepareTask(isolated).json;
    writeRequest(badName, { template: "x" });
    writeFileSync(join(badName.inputsDir, "bad.name"), "x");
    const badNameResult = invoke(isolated, ["run", "--task-id", badName.taskId]);
    expect(badNameResult.status).not.toBe(0);
    expect(badNameResult.json.error.code).toBe("INVALID_REQUEST");
    expect(existsSync(dirname(badName.requestPath))).toBe(false);

    const linked = prepareTask(isolated).json;
    writeRequest(linked, { template: "x" });
    symlinkSync(isolated.recordPath, join(linked.inputsDir, "content"));
    const linkedResult = invoke(isolated, ["run", "--task-id", linked.taskId]);
    expect(linkedResult.status).not.toBe(0);
    expect(linkedResult.json.error.code).toBe("INVALID_TASK");
    expect(existsSync(dirname(linked.requestPath))).toBe(false);
  });

  it("Render、Imagemon 和子进程启动失败时均清理任务目录", () => {
    for (const failure of ["render", "imagemon", "spawn"]) {
      const isolated = createIsolatedScripts(failure);
      const prepared = prepareTask(isolated).json;
      writeRequest(prepared, { template: "x", inputs: { content: "x" } });
      const result = invoke(isolated, ["run", "--task-id", prepared.taskId]);
      expect(result.status).not.toBe(0);
      expect(existsSync(dirname(prepared.requestPath))).toBe(false);
    }
  });

  it("清理超过期限的 prepared 和 running 任务但保留未过期任务", () => {
    const isolated = createIsolatedScripts();
    const expiredPrepared = prepareTask(isolated).json;
    ageTask(expiredPrepared.requestPath, "prepared", 25);
    const expiredRunning = prepareTask(isolated).json;
    ageTask(expiredRunning.requestPath, "running", 8 * 24);
    const activeRunning = prepareTask(isolated).json;
    ageTask(activeRunning.requestPath, "running", 2 * 24);

    prepareTask(isolated);

    expect(existsSync(dirname(expiredPrepared.requestPath))).toBe(false);
    expect(existsSync(dirname(expiredRunning.requestPath))).toBe(false);
    expect(existsSync(dirname(activeRunning.requestPath))).toBe(true);
  });
});

function createIsolatedScripts(failure?: string) {
  const root = createTempDir();
  const scripts = join(root, "scripts");
  const cwd = join(root, "project");
  const tmp = join(root, "tmp");
  mkdirSync(scripts, { recursive: true });
  mkdirSync(cwd);
  mkdirSync(tmp);
  const helper = join(scripts, "promptdex-task.mjs");
  const recordPath = join(root, "record.json");
  cpSync(helperPath, helper);
  writeFileSync(join(scripts, "promptdex.mjs"), promptdexStub);
  if (failure !== "spawn") writeFileSync(join(scripts, "imagemon.mjs"), imagemonStub);
  writeFileSync(join(cwd, "imagemon.config.json"), JSON.stringify({ recordPath, failure }));
  writeFileSync(recordPath, "{}");
  return { helper, cwd, tmp, recordPath };
}

function prepareTask(isolated: ReturnType<typeof createIsolatedScripts>) {
  return invoke(isolated, ["prepare"]);
}

function writeRequest(
  prepared: { requestPath: string; inputsDir: string },
  request: { template: string; inputs?: Record<string, string>; options?: unknown },
) {
  const envelope: Record<string, unknown> = { template: request.template };
  if (request.options !== undefined) envelope.options = request.options;
  writeFileSync(prepared.requestPath, JSON.stringify(envelope));
  chmodSync(prepared.requestPath, 0o600);
  for (const [name, value] of Object.entries(request.inputs ?? {})) {
    writeFileSync(join(prepared.inputsDir, name), value);
  }
}

function invoke(
  isolated: ReturnType<typeof createIsolatedScripts>,
  args: string[],
  input?: string,
) {
  const result = spawnSync(process.execPath, [isolated.helper, ...args], {
    cwd: isolated.cwd,
    env: { ...process.env, TMPDIR: isolated.tmp },
    input,
    encoding: "utf8",
  });
  return { ...result, json: JSON.parse(result.stdout) };
}

function ageTask(requestPath: string, status: "prepared" | "running", ageHours: number) {
  const statePath = join(dirname(requestPath), "state.json");
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  const updatedAt = new Date(Date.now() - ageHours * 60 * 60 * 1000).toISOString();
  writeFileSync(statePath, JSON.stringify({ ...state, status, updatedAt }));
  chmodSync(statePath, 0o600);
}

function mode(path: string) {
  return lstatSync(path).mode & 0o777;
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
  writeFileSync(promptPath, inputs.content ?? inputs.instruction, { mode: 0o600, flag: "wx" });
  const fileInputs = Object.fromEntries(
    ["image", "mask"]
      .filter(name => Object.hasOwn(inputs, name))
      .map(name => [name, inputs[name].trim()]),
  );
  console.log(JSON.stringify({
    ok: true,
    taskType: Object.hasOwn(inputs, "image") ? "edit" : "generate",
    promptFile: promptPath,
    ...fileInputs,
  }));
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
