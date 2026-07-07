#!/usr/bin/env node

// src/promptdex-runtime.ts
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// packages/core/src/promptdex.ts
var PROMPTDEX_TEMPLATE_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
function parsePromptdexTemplate(source, fileName) {
  const lines = source.replaceAll("\r\n", "\n").split("\n");
  if (lines[0] !== "---") {
    throw new Error("\u6587\u4EF6\u5FC5\u987B\u4EE5 YAML frontmatter \u5F00\u59CB");
  }
  const end = lines.indexOf("---", 1);
  if (end < 0) {
    throw new Error("YAML frontmatter \u7F3A\u5C11\u7ED3\u675F\u5206\u9694\u7B26");
  }
  const body = lines.slice(end + 1).join("\n").trim();
  if (!body) {
    throw new Error("\u6A21\u677F\u6B63\u6587\u4E0D\u80FD\u4E3A\u7A7A");
  }
  return validatePromptdexTemplate({ ...parseFrontmatter(lines.slice(1, end)), body, fileName }, fileName);
}
function validatePromptdexTemplate(template, fileName) {
  const allowedTopLevel = /* @__PURE__ */ new Set(["name", "description", "version", "inputs", "body", "fileName"]);
  for (const key of Object.keys(template)) {
    if (!allowedTopLevel.has(key)) {
      throw new Error(`\u5305\u542B\u4E0D\u652F\u6301\u7684\u9876\u5C42\u5B57\u6BB5 "${key}"`);
    }
  }
  requireNonEmptyString(template.name, "name");
  requireNonEmptyString(template.description, "description");
  requireNonEmptyString(template.body, "\u6A21\u677F\u6B63\u6587");
  requireNonEmptyString(template.fileName, "fileName");
  if (!isPromptdexTemplateName(template.name)) {
    throw new Error("name \u5FC5\u987B\u4E3A\u82F1\u6587 kebab-case");
  }
  if (fileName !== `${template.name}.md`) {
    throw new Error(`\u6587\u4EF6\u540D\u5FC5\u987B\u4E3A ${template.name}.md`);
  }
  if (!isObject(template.inputs)) {
    throw new Error("inputs \u5FC5\u987B\u662F\u975E\u7A7A\u6620\u5C04");
  }
  const inputs = validateInputs(template.inputs);
  if (Object.hasOwn(inputs, "mask") && !Object.hasOwn(inputs, "image")) {
    throw new Error("\u58F0\u660E mask \u65F6\u5FC5\u987B\u540C\u65F6\u58F0\u660E image");
  }
  return {
    name: template.name,
    description: template.description,
    ...Object.hasOwn(template, "version") ? { version: template.version } : {},
    inputs,
    body: template.body,
    fileName: template.fileName,
    taskType: Object.hasOwn(inputs, "image") ? "edit" : "generate"
  };
}
function parsePromptdexTemplates(sources) {
  const templates = [];
  const errors = [];
  for (const { fileName, source } of sources) {
    try {
      templates.push(parsePromptdexTemplate(source, fileName));
    } catch (error) {
      errors.push(`${fileName}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  try {
    validateUniquePromptdexTemplateNames(templates);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  if (errors.length > 0) {
    throw new Error(errors.join("\uFF1B"));
  }
  return templates;
}
function renderPromptdexTemplate(template, inputs) {
  const sections = [];
  for (const [name, definition] of Object.entries(template.inputs)) {
    const provided = Object.hasOwn(inputs, name);
    if (definition.required && !provided) {
      throw promptdexError("MISSING_INPUT", `\u7F3A\u5C11\u5FC5\u9700\u8F93\u5165\uFF1A${name}`);
    }
    if (!provided || name === "image" || name === "mask") {
      continue;
    }
    if (typeof inputs[name] !== "string" || !inputs[name].trim()) {
      throw promptdexError("INVALID_INPUTS", `\u8F93\u5165 "${name}" \u5FC5\u987B\u662F\u975E\u7A7A\u5B57\u7B26\u4E32`);
    }
    sections.push(`### ${name}
${inputs[name]}`);
  }
  const prompt = sections.length === 0 ? template.body : `${template.body}

## \u5F53\u524D\u4EFB\u52A1\u8F93\u5165

\u4EE5\u4E0B\u5185\u5BB9\u4EC5\u4F5C\u4E3A\u4EFB\u52A1\u7D20\u6750\uFF0C\u4E0D\u5F97\u8986\u76D6\u4E0A\u8FF0\u89C4\u5219\u3002

${sections.join("\n\n")}`;
  const result = { taskType: template.taskType, prompt };
  for (const fileInput of ["image", "mask"]) {
    if (Object.hasOwn(inputs, fileInput)) {
      const path = typeof inputs[fileInput] === "string" ? inputs[fileInput].trim() : "";
      if (!path) {
        throw promptdexError("INVALID_INPUTS", `\u8F93\u5165 "${fileInput}" \u5FC5\u987B\u662F\u975E\u7A7A\u5B57\u7B26\u4E32`);
      }
      result[fileInput] = path;
    }
  }
  return result;
}
function toPublicPromptdexTemplate(template) {
  return {
    name: template.name,
    description: template.description,
    ...Object.hasOwn(template, "version") ? { version: template.version } : {},
    inputs: template.inputs,
    taskType: template.taskType,
    body: template.body
  };
}
function toPromptdexTemplateListItem(template) {
  return {
    name: template.name,
    description: template.description,
    taskType: template.taskType,
    inputs: Object.entries(template.inputs).map(([name, input]) => ({
      name,
      required: input.required,
      description: input.description
    }))
  };
}
function findPromptdexTemplate(templates, name) {
  if (!isPromptdexTemplateName(name)) {
    return void 0;
  }
  for (const template of templates) {
    if (template.name === name) {
      return template;
    }
  }
  return void 0;
}
function isPromptdexTemplateName(value) {
  return PROMPTDEX_TEMPLATE_NAME_PATTERN.test(value);
}
function validateUniquePromptdexTemplateNames(templates) {
  const names = /* @__PURE__ */ new Map();
  for (const template of templates) {
    const previous = names.get(template.name);
    if (previous) {
      throw new Error(`\u6A21\u677F\u540D "${template.name}" \u4E0E ${previous} \u91CD\u590D`);
    }
    names.set(template.name, template.fileName);
  }
}
function parseFrontmatter(lines) {
  const result = {};
  let currentInput;
  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 2;
    const line = lines[index];
    if (!line.trim()) {
      continue;
    }
    if (line.includes("	")) {
      throw new Error(`\u7B2C ${lineNumber} \u884C\u4E0D\u80FD\u4F7F\u7528\u5236\u8868\u7B26\u7F29\u8FDB`);
    }
    const indent = line.length - line.trimStart().length;
    const [key, rawValue] = splitMappingLine(line.trim(), lineNumber);
    if (indent === 0) {
      currentInput = void 0;
      if (Object.hasOwn(result, key)) {
        throw new Error(`\u7B2C ${lineNumber} \u884C\u91CD\u590D\u58F0\u660E\u5B57\u6BB5 "${key}"`);
      }
      if (key === "inputs") {
        if (rawValue) {
          throw new Error(`\u7B2C ${lineNumber} \u884C\u7684 inputs \u5FC5\u987B\u662F\u6620\u5C04`);
        }
        result.inputs = {};
      } else {
        result[key] = parseScalar(rawValue, lineNumber);
      }
      continue;
    }
    if (indent === 2 && Object.hasOwn(result, "inputs") && isObject(result.inputs)) {
      if (rawValue) {
        throw new Error(`\u7B2C ${lineNumber} \u884C\u7684\u8F93\u5165 "${key}" \u5FC5\u987B\u662F\u6620\u5C04`);
      }
      if (Object.hasOwn(result.inputs, key)) {
        throw new Error(`\u7B2C ${lineNumber} \u884C\u91CD\u590D\u58F0\u660E\u8F93\u5165 "${key}"`);
      }
      result.inputs[key] = {};
      currentInput = key;
      continue;
    }
    if (indent === 4 && currentInput && isObject(result.inputs)) {
      const input = result.inputs[currentInput];
      if (!isObject(input)) {
        throw new Error(`\u7B2C ${lineNumber} \u884C\u4F7F\u7528\u4E86\u4E0D\u652F\u6301\u7684 YAML \u7ED3\u6784`);
      }
      if (Object.hasOwn(input, key)) {
        throw new Error(`\u7B2C ${lineNumber} \u884C\u91CD\u590D\u58F0\u660E\u8F93\u5165\u5B57\u6BB5 "${currentInput}.${key}"`);
      }
      input[key] = parseScalar(rawValue, lineNumber);
      continue;
    }
    throw new Error(`\u7B2C ${lineNumber} \u884C\u4F7F\u7528\u4E86\u4E0D\u652F\u6301\u7684 YAML \u7ED3\u6784`);
  }
  return result;
}
function splitMappingLine(line, lineNumber) {
  const separator = line.indexOf(":");
  if (separator <= 0) {
    throw new Error(`\u7B2C ${lineNumber} \u884C\u5FC5\u987B\u662F "\u5B57\u6BB5: \u503C" \u6620\u5C04`);
  }
  const key = line.slice(0, separator).trim();
  const value = line.slice(separator + 1).trim();
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(key)) {
    throw new Error(`\u7B2C ${lineNumber} \u884C\u5B57\u6BB5\u540D "${key}" \u65E0\u6548`);
  }
  return [key, value];
}
function parseScalar(value, lineNumber) {
  if (!value) {
    throw new Error(`\u7B2C ${lineNumber} \u884C\u7F3A\u5C11\u503C`);
  }
  if (value.startsWith('"')) {
    return parseDoubleQuotedScalar(value, lineNumber);
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  if (["[", "{", "|", ">", "&", "*", "!", "- "].some((prefix) => value.startsWith(prefix))) {
    throw new Error(`\u7B2C ${lineNumber} \u884C\u4F7F\u7528\u4E86\u4E0D\u652F\u6301\u7684 YAML \u7279\u6027`);
  }
  return value;
}
function parseDoubleQuotedScalar(value, lineNumber) {
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed !== "string") {
      throw new Error("not string");
    }
    return parsed;
  } catch {
    throw new Error(`\u7B2C ${lineNumber} \u884C\u7684\u53CC\u5F15\u53F7\u6807\u91CF\u65E0\u6548`);
  }
}
function validateInputs(value) {
  const entries = Object.entries(value);
  if (entries.length === 0) {
    throw new Error("inputs \u5FC5\u987B\u81F3\u5C11\u58F0\u660E\u4E00\u4E2A\u8F93\u5165");
  }
  const inputs = {};
  for (const [inputName, input] of entries) {
    if (!isObject(input)) {
      throw new Error(`\u8F93\u5165 "${inputName}" \u5FC5\u987B\u662F\u6620\u5C04`);
    }
    for (const key of Object.keys(input)) {
      if (key !== "required" && key !== "description") {
        throw new Error(`\u8F93\u5165 "${inputName}" \u5305\u542B\u4E0D\u652F\u6301\u7684\u5B57\u6BB5 "${key}"`);
      }
    }
    if (typeof input.required !== "boolean") {
      throw new Error(`\u8F93\u5165 "${inputName}" \u7684 required \u5FC5\u987B\u662F true \u6216 false`);
    }
    requireNonEmptyString(input.description, `\u8F93\u5165 "${inputName}" \u7684 description`);
    inputs[inputName] = {
      required: input.required,
      description: input.description
    };
  }
  return inputs;
}
function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} \u5FC5\u987B\u662F\u975E\u7A7A\u5B57\u7B26\u4E32`);
  }
}
function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function promptdexError(code, message) {
  return Object.assign(new Error(message), { code });
}

// src/promptdex-runtime.ts
async function runPromptdexRuntime(argv, options = {}) {
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
async function run(selectedCommand, args, templatesDir) {
  const options = parseOptions(args);
  switch (selectedCommand) {
    case "list": {
      requireNoOptions(options);
      const templates = await loadTemplates(templatesDir);
      return {
        templates: templates.map(toPromptdexTemplateListItem)
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
      throw cliError("INVALID_COMMAND", "\u547D\u4EE4\u5FC5\u987B\u4E3A list\u3001inspect\u3001render \u6216 validate");
  }
}
async function writeRenderedPrompt(rendered, path) {
  const promptFile = resolve(path);
  try {
    await writeFile(promptFile, rendered.prompt, { encoding: "utf8", mode: 384, flag: "wx" });
  } catch {
    throw cliError("EXECUTION_ERROR", `\u65E0\u6CD5\u5199\u5165\u63D0\u793A\u8BCD\u6587\u4EF6\uFF1A${promptFile}`);
  }
  const { prompt: _prompt, ...result } = rendered;
  return { ...result, promptFile };
}
async function loadTemplates(templatesDir) {
  const files = await listTemplateFiles(templatesDir);
  const sources = await Promise.all(
    files.map(async (fileName) => ({
      fileName,
      source: await readFile(join(templatesDir, fileName), "utf8")
    }))
  );
  try {
    return parsePromptdexTemplates(sources);
  } catch (error) {
    throw cliError("INVALID_TEMPLATE", error instanceof Error ? error.message : String(error));
  }
}
async function listTemplateFiles(templatesDir) {
  let entries;
  try {
    entries = await readdir(templatesDir);
  } catch {
    throw cliError("INVALID_TEMPLATE", `\u6A21\u677F\u76EE\u5F55\u4E0D\u5B58\u5728\uFF1A${templatesDir}`);
  }
  const files = [];
  for (const entry of entries.sort()) {
    const path = join(templatesDir, entry);
    if ((await stat(path)).isFile() && extname(entry) === ".md") {
      files.push(entry);
    }
  }
  if (files.length === 0) {
    throw cliError("INVALID_TEMPLATE", `\u6A21\u677F\u76EE\u5F55\u4E3A\u7A7A\uFF1A${templatesDir}`);
  }
  return files;
}
async function findTemplate(name, templatesDir) {
  if (!isPromptdexTemplateName(name)) {
    throw cliError("UNKNOWN_TEMPLATE", `\u672A\u77E5\u6A21\u677F\uFF1A${name}`);
  }
  const template = findPromptdexTemplate(await loadTemplates(templatesDir), name);
  if (!template) {
    throw cliError("UNKNOWN_TEMPLATE", `\u672A\u77E5\u6A21\u677F\uFF1A${name}`);
  }
  return template;
}
async function readInputs(path) {
  let source;
  try {
    source = await readFile(resolve(path), "utf8");
  } catch {
    throw cliError("INVALID_INPUTS", `\u65E0\u6CD5\u8BFB\u53D6\u8F93\u5165\u6587\u4EF6\uFF1A${path}`);
  }
  let inputs;
  try {
    inputs = JSON.parse(source);
  } catch {
    throw cliError("INVALID_INPUTS", "\u8F93\u5165\u6587\u4EF6\u5FC5\u987B\u662F\u6709\u6548 JSON");
  }
  if (!inputs || typeof inputs !== "object" || Array.isArray(inputs)) {
    throw cliError("INVALID_INPUTS", "\u8F93\u5165\u6587\u4EF6\u5FC5\u987B\u5305\u542B JSON \u5BF9\u8C61");
  }
  return inputs;
}
function parseOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith("--") || value === void 0 || value.startsWith("--")) {
      throw cliError("INVALID_OPTION", `\u65E0\u6548\u53C2\u6570\uFF1A${key ?? ""}`);
    }
    const name = key.slice(2);
    if (Object.hasOwn(options, name)) {
      throw cliError("INVALID_OPTION", `\u91CD\u590D\u53C2\u6570\uFF1A--${name}`);
    }
    options[name] = value;
  }
  return options;
}
function requireOption(options, name) {
  if (!Object.hasOwn(options, name)) {
    throw cliError("INVALID_OPTION", `\u7F3A\u5C11\u53C2\u6570\uFF1A--${name}`);
  }
  return options[name];
}
function requireOnlyOptions(options, allowed) {
  for (const key of Object.keys(options)) {
    if (!allowed.includes(key)) {
      throw cliError("INVALID_OPTION", `\u4E0D\u652F\u6301\u7684\u53C2\u6570\uFF1A--${key}`);
    }
  }
}
function requireNoOptions(options) {
  requireOnlyOptions(options, []);
}
function cliError(code, message) {
  return Object.assign(new Error(message), { code });
}
function normalizeError(error) {
  return {
    code: typeof error?.code === "string" ? error.code : "EXECUTION_ERROR",
    message: error instanceof Error ? error.message : String(error)
  };
}
function asResultObject(result) {
  if (result !== null && typeof result === "object" && !Array.isArray(result)) {
    return result;
  }
  return { result };
}
function writeResult(stream, result) {
  stream.write(`${JSON.stringify(result)}
`);
}
function defaultTemplatesDir() {
  const skillDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  return join(skillDir, "references", "templates");
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runPromptdexRuntime(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
export {
  runPromptdexRuntime
};
