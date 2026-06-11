#!/usr/bin/env node

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const promptdexPath = join(scriptsDir, "promptdex.mjs");
const imagemonPath = join(scriptsDir, "imagemon.mjs");
const allowedRequestFields = new Set(["template", "inputs", "options"]);
const allowedOptionFields = new Set(["size", "quality", "format", "n", "out"]);
const defaults = {
  size: "1536x1024",
  quality: "high",
  format: "png",
  n: 1,
  out: "./outputs",
};

let tempDir;
try {
  if (process.argv.length > 2) throw taskError("INVALID_REQUEST", "任务请求只能通过 stdin 传入");
  const request = validateRequest(await readStdinJson());
  tempDir = await mkdtemp(join(tmpdir(), "imagemon-promptdex-"));
  const inputsPath = join(tempDir, "inputs.json");
  const promptPath = join(tempDir, "prompt.txt");
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
  ]);
  if (!rendered.ok) {
    writeResult(failureResult(rendered.error));
    process.exitCode = 1;
  } else {
    if (rendered.promptFile !== resolve(promptPath) || Object.hasOwn(rendered, "prompt")) {
      throw taskError("EXECUTION_ERROR", "Promptdex 未按文件模式返回完整提示词");
    }
    const result = await runImagemon(rendered, request.options);
    writeResult(result);
    if (!result.ok) process.exitCode = 1;
  }
} catch (error) {
  writeResult(failureResult(normalizeError(error)));
  process.exitCode = 1;
} finally {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
}

async function runImagemon(rendered, options) {
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
  return runJsonChild(imagemonPath, args);
}

function requireRenderedPath(rendered, name) {
  if (typeof rendered[name] !== "string" || !rendered[name].trim()) {
    throw taskError("EXECUTION_ERROR", `Promptdex 未返回有效的 ${name}`);
  }
  return rendered[name];
}

async function readStdinJson() {
  let source = "";
  for await (const chunk of process.stdin) source += chunk;
  if (!source.trim()) throw taskError("INVALID_REQUEST", "stdin 必须包含任务 JSON");
  try {
    return JSON.parse(source);
  } catch {
    throw taskError("INVALID_REQUEST", "stdin 必须包含有效 JSON");
  }
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

function runJsonChild(scriptPath, args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: process.cwd(),
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
