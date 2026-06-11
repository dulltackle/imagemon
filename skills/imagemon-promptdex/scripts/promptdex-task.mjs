#!/usr/bin/env node

import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const promptdexPath = join(scriptsDir, "promptdex.mjs");
const imagemonPath = join(scriptsDir, "imagemon.mjs");
const tasksRoot = join(tmpdir(), "imagemon-promptdex-tasks");
const requestName = "request.json";
const stateName = "state.json";
const claimName = "claim.lock";
const taskIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const preparedMaxAgeMs = 24 * 60 * 60 * 1000;
const runningMaxAgeMs = 7 * preparedMaxAgeMs;
const allowedRequestFields = new Set(["template", "inputs", "options"]);
const allowedOptionFields = new Set(["size", "quality", "format", "n", "out"]);
const defaults = {
  size: "1536x1024",
  quality: "high",
  format: "png",
  n: 1,
  out: "./outputs",
};

try {
  await ensureTasksRoot();
  await cleanupStaleTasks();
  const invocation = parseInvocation(process.argv.slice(2));
  let result;
  if (invocation.command === "prepare") {
    result = await prepareTask();
  } else if (invocation.command === "run") {
    result = await runTask(invocation.taskId);
  } else {
    result = await cancelTask(invocation.taskId);
  }
  writeResult(result);
  if (!result.ok) process.exitCode = 1;
} catch (error) {
  writeResult(failureResult(normalizeError(error)));
  process.exitCode = 1;
}

function parseInvocation(args) {
  if (args.length === 1 && args[0] === "prepare") return { command: "prepare" };
  if (
    args.length === 3
    && (args[0] === "run" || args[0] === "cancel")
    && args[1] === "--task-id"
  ) {
    return { command: args[0], taskId: requireTaskId(args[2]) };
  }
  throw taskError(
    "INVALID_COMMAND",
    "用法：promptdex-task.mjs prepare | run --task-id <id> | cancel --task-id <id>；不再支持 stdin 请求",
  );
}

async function prepareTask() {
  const taskId = randomUUID();
  const taskDir = taskPath(taskId);
  const requestPath = join(taskDir, requestName);
  const now = new Date();
  const state = {
    version: 1,
    taskId,
    status: "prepared",
    projectRoot: resolve(process.cwd()),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };

  await mkdir(taskDir, { mode: 0o700 });
  try {
    await writeFile(requestPath, "", { encoding: "utf8", mode: 0o600, flag: "wx" });
    await writeState(taskDir, state, "wx");
  } catch (error) {
    await rm(taskDir, { recursive: true, force: true });
    throw error;
  }

  return {
    ok: true,
    command: "prepare",
    taskId,
    requestPath,
    expiresAt: new Date(now.getTime() + preparedMaxAgeMs).toISOString(),
  };
}

async function runTask(taskId) {
  const task = await loadManagedTask(taskId);
  if (task.state.status !== "prepared") {
    throw taskError("INVALID_TASK_STATE", "任务不是可执行的 prepared 状态");
  }
  await claimTask(task.taskDir);
  try {
    const request = validateRequest(await readRequestJson(task.requestPath));
    const runningState = {
      ...task.state,
      status: "running",
      updatedAt: new Date().toISOString(),
    };
    await writeState(task.taskDir, runningState);
    const inputsPath = join(task.taskDir, "inputs.json");
    const promptPath = join(task.taskDir, "prompt.txt");
    await writeFile(inputsPath, JSON.stringify(request.inputs), {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });

    const rendered = await runJsonChild(promptdexPath, [
      "render",
      "--template",
      request.template,
      "--inputs-file",
      inputsPath,
      "--prompt-file",
      promptPath,
    ], task.state.projectRoot);
    if (!rendered.ok) return failureResult(rendered.error);
    if (rendered.promptFile !== resolve(promptPath) || Object.hasOwn(rendered, "prompt")) {
      throw taskError("EXECUTION_ERROR", "Promptdex 未按文件模式返回完整提示词");
    }
    return await runImagemon(rendered, request.options, task.state.projectRoot);
  } catch (error) {
    return failureResult(normalizeError(error));
  } finally {
    await rm(task.taskDir, { recursive: true, force: true });
  }
}

async function cancelTask(taskId) {
  const task = await loadManagedTask(taskId);
  if (task.state.status !== "prepared") {
    throw taskError("INVALID_TASK_STATE", "只能取消 prepared 状态的任务");
  }
  await claimTask(task.taskDir);
  await rm(task.taskDir, { recursive: true, force: true });
  return { ok: true, command: "cancel", taskId };
}

async function claimTask(taskDir) {
  try {
    await writeFile(join(taskDir, claimName), "", { encoding: "utf8", mode: 0o600, flag: "wx" });
  } catch (error) {
    if (error?.code === "EEXIST") throw taskError("INVALID_TASK_STATE", "任务已被其他进程占用");
    throw error;
  }
}

async function loadManagedTask(taskId) {
  const taskDir = taskPath(requireTaskId(taskId));
  try {
    await assertManagedDirectory(taskDir);
    const statePath = join(taskDir, stateName);
    const requestPath = join(taskDir, requestName);
    await assertProtectedRegularFile(statePath);
    await assertProtectedRegularFile(requestPath);
    const state = validateState(JSON.parse(await readProtectedFile(statePath)), taskId);
    return { taskDir, requestPath, state };
  } catch (error) {
    if (typeof error?.code === "string" && error.code.startsWith("INVALID_")) throw error;
    throw taskError("INVALID_TASK", "任务不存在或受管任务文件无效");
  }
}

async function ensureTasksRoot() {
  await mkdir(tasksRoot, { recursive: true, mode: 0o700 });
  const stat = await lstat(tasksRoot);
  if (!stat.isDirectory() || stat.isSymbolicLink() || !isOwnedByCurrentUser(stat)) {
    throw taskError("INVALID_TASK", "任务根目录类型或归属无效");
  }
  await chmod(tasksRoot, 0o700);
  await assertManagedDirectory(tasksRoot, false);
}

async function cleanupStaleTasks() {
  const entries = await readdir(tasksRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || !taskIdPattern.test(entry.name)) continue;
    const taskDir = taskPath(entry.name);
    try {
      await assertManagedDirectory(taskDir);
      const statePath = join(taskDir, stateName);
      await assertProtectedRegularFile(statePath);
      const state = validateState(JSON.parse(await readProtectedFile(statePath)), entry.name);
      const age = Date.now() - Date.parse(state.updatedAt);
      const claimed = await hasProtectedClaim(taskDir);
      const maxAge = state.status === "prepared" && !claimed ? preparedMaxAgeMs : runningMaxAgeMs;
      if (age > maxAge) await rm(taskDir, { recursive: true, force: true });
    } catch {
      // 不操作无法证明属于本脚本的目录。
    }
  }
}

async function hasProtectedClaim(taskDir) {
  try {
    await assertProtectedRegularFile(join(taskDir, claimName));
    return true;
  } catch {
    return false;
  }
}

async function assertManagedDirectory(path, requireUuidName = true) {
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw taskError("INVALID_TASK", "任务目录无效");
  }
  if (requireUuidName && !taskIdPattern.test(basename(path))) {
    throw taskError("INVALID_TASK", "任务目录名称无效");
  }
  if ((stat.mode & 0o777) !== 0o700 || !isOwnedByCurrentUser(stat)) {
    throw taskError("INVALID_TASK", "任务目录权限或归属无效");
  }
}

async function assertProtectedRegularFile(path) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o600 || !isOwnedByCurrentUser(stat)) {
    throw taskError("INVALID_TASK", "任务文件类型、权限或归属无效");
  }
}

function isOwnedByCurrentUser(stat) {
  return typeof process.getuid !== "function" || stat.uid === process.getuid();
}

async function readProtectedFile(path) {
  const noFollow = constants.O_NOFOLLOW ?? 0;
  const handle = await open(path, constants.O_RDONLY | noFollow);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || (stat.mode & 0o777) !== 0o600 || !isOwnedByCurrentUser(stat)) {
      throw taskError("INVALID_TASK", "任务文件类型、权限或归属无效");
    }
    return await handle.readFile({ encoding: "utf8" });
  } finally {
    await handle.close();
  }
}

async function readRequestJson(path) {
  const source = await readProtectedFile(path);
  if (!source.trim()) throw taskError("INVALID_REQUEST", "请求文件必须包含任务 JSON");
  try {
    return JSON.parse(source);
  } catch {
    throw taskError("INVALID_REQUEST", "请求文件必须包含有效 JSON");
  }
}

async function writeState(taskDir, state, flag = "w") {
  await writeFile(join(taskDir, stateName), `${JSON.stringify(state)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag,
  });
  await chmod(join(taskDir, stateName), 0o600);
}

function validateState(state, taskId) {
  if (
    !isObject(state)
    || state.version !== 1
    || state.taskId !== taskId
    || !["prepared", "running"].includes(state.status)
    || typeof state.projectRoot !== "string"
    || resolve(state.projectRoot) !== state.projectRoot
    || !isValidDate(state.createdAt)
    || !isValidDate(state.updatedAt)
  ) {
    throw taskError("INVALID_TASK", "任务状态文件无效");
  }
  return state;
}

function isValidDate(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function taskPath(taskId) {
  return join(tasksRoot, requireTaskId(taskId));
}

function requireTaskId(taskId) {
  if (typeof taskId !== "string" || !taskIdPattern.test(taskId)) {
    throw taskError("INVALID_TASK_ID", "task-id 必须是 UUID v4");
  }
  return taskId;
}

async function runImagemon(rendered, options, cwd) {
  const args = [
    rendered.taskType,
    "--prompt-file",
    rendered.promptFile,
    "--size",
    options.size,
    "--quality",
    options.quality,
    "--format",
    options.format,
    "--n",
    String(options.n),
    "--out",
    options.out,
  ];
  if (rendered.taskType === "edit") {
    args.push("--image", requireRenderedPath(rendered, "image"));
    if (rendered.mask !== undefined) args.push("--mask", requireRenderedPath(rendered, "mask"));
  } else if (rendered.taskType !== "generate") {
    throw taskError("EXECUTION_ERROR", "Promptdex 返回了无效任务类型");
  }
  return runJsonChild(imagemonPath, args, cwd);
}

function requireRenderedPath(rendered, name) {
  if (typeof rendered[name] !== "string" || !rendered[name].trim()) {
    throw taskError("EXECUTION_ERROR", `Promptdex 未返回有效的 ${name}`);
  }
  return rendered[name];
}

function validateRequest(request) {
  if (!isObject(request)) throw taskError("INVALID_REQUEST", "任务必须是 JSON 对象");
  rejectUnknownFields(request, allowedRequestFields, "任务");
  requireNonEmptyString(request.template, "template");
  if (!isObject(request.inputs)) throw taskError("INVALID_REQUEST", "inputs 必须是 JSON 对象");
  if (request.options !== undefined && !isObject(request.options)) {
    throw taskError("INVALID_REQUEST", "options 必须是 JSON 对象");
  }

  const options = { ...defaults, ...(request.options ?? {}) };
  rejectUnknownFields(options, allowedOptionFields, "options");
  if (options.size !== "auto" && (typeof options.size !== "string" || !/^\d+x\d+$/.test(options.size))) {
    throw taskError("INVALID_REQUEST", "options.size 必须是 auto 或 WIDTHxHEIGHT");
  }
  if (!["auto", "low", "medium", "high"].includes(options.quality)) {
    throw taskError("INVALID_REQUEST", "options.quality 无效");
  }
  if (!["png", "jpeg", "webp"].includes(options.format)) {
    throw taskError("INVALID_REQUEST", "options.format 无效");
  }
  if (!Number.isInteger(options.n) || options.n < 1) {
    throw taskError("INVALID_REQUEST", "options.n 必须是正整数");
  }
  requireNonEmptyString(options.out, "options.out");
  return { template: request.template, inputs: request.inputs, options };
}

function rejectUnknownFields(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw taskError("INVALID_REQUEST", `${label} 包含未知字段：${key}`);
  }
}

function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw taskError("INVALID_REQUEST", `${label} 必须是非空字符串`);
  }
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function runJsonChild(scriptPath, args, cwd) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd,
      env: process.env,
      shell: false,
      stdio: ["ignore", "pipe", "ignore"],
    });
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.on("error", () => rejectPromise(taskError("EXECUTION_ERROR", `无法启动子进程：${scriptPath}`)));
    child.on("close", () => {
      const lines = stdout.trimEnd().split("\n");
      if (lines.length !== 1 || !lines[0]) {
        rejectPromise(taskError("EXECUTION_ERROR", `子进程未返回有效单行 JSON：${scriptPath}`));
        return;
      }
      try {
        const result = JSON.parse(lines[0]);
        if (!isObject(result) || typeof result.ok !== "boolean") {
          rejectPromise(taskError("EXECUTION_ERROR", `子进程返回了无效 JSON 协议：${scriptPath}`));
          return;
        }
        resolvePromise(result);
      } catch {
        rejectPromise(taskError("EXECUTION_ERROR", `子进程未返回有效单行 JSON：${scriptPath}`));
      }
    });
  });
}

function failureResult(error) {
  return { ok: false, files: [], metadataPath: null, error };
}

function taskError(code, message) {
  return Object.assign(new Error(message), { code });
}

function normalizeError(error) {
  return {
    code: typeof error?.code === "string" ? error.code : "EXECUTION_ERROR",
    message: error instanceof Error ? error.message : String(error),
  };
}

function writeResult(result) {
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
