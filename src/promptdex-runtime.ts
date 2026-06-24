#!/usr/bin/env node
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  findPromptdexTemplate,
  isPromptdexTemplateName,
  parsePromptdexTemplates,
  renderPromptdexTemplate,
  toPromptdexTemplateListItem,
  toPublicPromptdexTemplate,
  type PromptdexTemplate,
} from "@imagemon/core/promptdex";

interface CliStreams {
  stdout: Pick<NodeJS.WriteStream, "write">;
}

export interface RunPromptdexRuntimeOptions {
  templatesDir?: string;
  streams?: CliStreams;
}

export async function runPromptdexRuntime(
  argv: string[],
  options: RunPromptdexRuntimeOptions = {},
): Promise<number> {
  const streams = options.streams ?? { stdout: process.stdout };
  const command = argv[0] ?? "";

  try {
    const result = await run(command, argv.slice(1), options.templatesDir ?? defaultTemplatesDir());
    writeResult(streams.stdout, { ok: true, command, ...asResultObject(result) });
    return 0;
  } catch (error) {
    const normalized = normalizeError(error);
    writeResult(streams.stdout, { ok: false, command, error: normalized });
    return 1;
  }
}

async function run(selectedCommand: string, args: string[], templatesDir: string): Promise<unknown> {
  const options = parseOptions(args);

  switch (selectedCommand) {
    case "list": {
      requireNoOptions(options);
      const templates = await loadTemplates(templatesDir);
      return {
        templates: templates.map(toPromptdexTemplateListItem),
      };
    }
    case "inspect": {
      requireOnlyOptions(options, ["template"]);
      const template = await findTemplate(requireOption(options, "template"), templatesDir);
      return { template: toPublicPromptdexTemplate(template) };
    }
    case "render": {
      requireOnlyOptions(options, ["template", "inputs-file", "prompt-file"]);
      const template = await findTemplate(requireOption(options, "template"), templatesDir);
      const inputs = await readInputs(requireOption(options, "inputs-file"));
      const rendered = renderPromptdexTemplate(template, inputs);
      if (!Object.hasOwn(options, "prompt-file")) {
        return rendered;
      }
      return await writeRenderedPrompt(rendered, options["prompt-file"]);
    }
    case "validate": {
      requireNoOptions(options);
      const templates = await loadTemplates(templatesDir);
      return { templates: templates.length };
    }
    default:
      throw cliError("INVALID_COMMAND", "命令必须为 list、inspect、render 或 validate");
  }
}

async function writeRenderedPrompt(
  rendered: ReturnType<typeof renderPromptdexTemplate>,
  path: string,
): Promise<unknown> {
  const promptFile = resolve(path);
  try {
    await writeFile(promptFile, rendered.prompt, { encoding: "utf8", mode: 0o600, flag: "wx" });
  } catch {
    throw cliError("EXECUTION_ERROR", `无法写入提示词文件：${promptFile}`);
  }
  const { prompt: _prompt, ...result } = rendered;
  return { ...result, promptFile };
}

async function loadTemplates(templatesDir: string): Promise<PromptdexTemplate[]> {
  const files = await listTemplateFiles(templatesDir);
  const sources = await Promise.all(
    files.map(async (fileName) => ({
      fileName,
      source: await readFile(join(templatesDir, fileName), "utf8"),
    })),
  );

  try {
    return parsePromptdexTemplates(sources);
  } catch (error) {
    throw cliError("INVALID_TEMPLATE", error instanceof Error ? error.message : String(error));
  }
}

async function listTemplateFiles(templatesDir: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(templatesDir);
  } catch {
    throw cliError("INVALID_TEMPLATE", `模板目录不存在：${templatesDir}`);
  }

  const files: string[] = [];
  for (const entry of entries.sort()) {
    const path = join(templatesDir, entry);
    if ((await stat(path)).isFile() && extname(entry) === ".md") {
      files.push(entry);
    }
  }
  if (files.length === 0) {
    throw cliError("INVALID_TEMPLATE", `模板目录为空：${templatesDir}`);
  }
  return files;
}

async function findTemplate(name: string, templatesDir: string): Promise<PromptdexTemplate> {
  if (!isPromptdexTemplateName(name)) {
    throw cliError("UNKNOWN_TEMPLATE", `未知模板：${name}`);
  }

  const template = findPromptdexTemplate(await loadTemplates(templatesDir), name);
  if (!template) {
    throw cliError("UNKNOWN_TEMPLATE", `未知模板：${name}`);
  }
  return template;
}

async function readInputs(path: string): Promise<Record<string, unknown>> {
  let source: string;
  try {
    source = await readFile(resolve(path), "utf8");
  } catch {
    throw cliError("INVALID_INPUTS", `无法读取输入文件：${path}`);
  }

  let inputs: unknown;
  try {
    inputs = JSON.parse(source);
  } catch {
    throw cliError("INVALID_INPUTS", "输入文件必须是有效 JSON");
  }

  if (!inputs || typeof inputs !== "object" || Array.isArray(inputs)) {
    throw cliError("INVALID_INPUTS", "输入文件必须包含 JSON 对象");
  }
  return inputs as Record<string, unknown>;
}

function parseOptions(args: string[]): Record<string, string> {
  const options: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw cliError("INVALID_OPTION", `无效参数：${key ?? ""}`);
    }
    const name = key.slice(2);
    if (Object.hasOwn(options, name)) {
      throw cliError("INVALID_OPTION", `重复参数：--${name}`);
    }
    options[name] = value;
  }
  return options;
}

function requireOption(options: Record<string, string>, name: string): string {
  if (!Object.hasOwn(options, name)) {
    throw cliError("INVALID_OPTION", `缺少参数：--${name}`);
  }
  return options[name];
}

function requireOnlyOptions(options: Record<string, string>, allowed: readonly string[]): void {
  for (const key of Object.keys(options)) {
    if (!allowed.includes(key)) {
      throw cliError("INVALID_OPTION", `不支持的参数：--${key}`);
    }
  }
}

function requireNoOptions(options: Record<string, string>): void {
  requireOnlyOptions(options, []);
}

function cliError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

function normalizeError(error: unknown): { code: string; message: string } {
  return {
    code: typeof (error as { code?: unknown })?.code === "string" ? (error as { code: string }).code : "EXECUTION_ERROR",
    message: error instanceof Error ? error.message : String(error),
  };
}

function asResultObject(result: unknown): Record<string, unknown> {
  if (result !== null && typeof result === "object" && !Array.isArray(result)) {
    return result as Record<string, unknown>;
  }
  return { result };
}

function writeResult(stream: Pick<NodeJS.WriteStream, "write">, result: unknown): void {
  stream.write(`${JSON.stringify(result)}\n`);
}

function defaultTemplatesDir(): string {
  const skillDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  return join(skillDir, "references", "templates");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runPromptdexRuntime(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
