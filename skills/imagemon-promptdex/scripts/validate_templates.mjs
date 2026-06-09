#!/usr/bin/env node

import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const skillDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const templatesDir = join(skillDir, "references", "templates");

const errors = [];
const names = new Map();

for (const fileName of await listTemplateFiles(templatesDir)) {
  const filePath = join(templatesDir, fileName);

  try {
    const template = parseTemplate(await readFile(filePath, "utf8"), fileName);
    validateTemplate(template, fileName);

    if (typeof template.name === "string" && template.name.trim()) {
      const previous = names.get(template.name);
      if (previous) {
        errors.push(`${fileName}: 模板名 "${template.name}" 与 ${previous} 重复`);
      } else {
        names.set(template.name, fileName);
      }
    }
  } catch (error) {
    errors.push(`${fileName}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (errors.length > 0) {
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exitCode = 1;
} else {
  console.log(`已验证 ${names.size} 个提示词模板`);
}

async function listTemplateFiles(directory) {
  const entries = await readdir(directory);
  const files = [];

  for (const entry of entries.sort()) {
    const path = join(directory, entry);
    if ((await stat(path)).isFile() && extname(entry) === ".md") {
      files.push(entry);
    }
  }

  if (files.length === 0) {
    throw new Error(`模板目录为空: ${directory}`);
  }

  return files;
}

function parseTemplate(source, fileName) {
  const lines = source.replaceAll("\r\n", "\n").split("\n");
  if (lines[0] !== "---") {
    throw new Error("文件必须以 YAML frontmatter 开始");
  }

  const end = lines.indexOf("---", 1);
  if (end < 0) {
    throw new Error("YAML frontmatter 缺少结束分隔符");
  }

  const body = lines.slice(end + 1).join("\n").trim();
  if (!body) {
    throw new Error("模板正文不能为空");
  }

  return { ...parseFrontmatter(lines.slice(1, end), fileName), body };
}

function parseFrontmatter(lines, fileName) {
  const result = {};
  let currentInput;

  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 2;
    const line = lines[index];

    if (!line.trim()) {
      continue;
    }
    if (line.includes("\t")) {
      throw new Error(`第 ${lineNumber} 行不能使用制表符缩进`);
    }

    const indent = line.length - line.trimStart().length;
    const [key, rawValue] = splitMappingLine(line.trim(), lineNumber);

    if (indent === 0) {
      currentInput = undefined;
      if (Object.hasOwn(result, key)) {
        throw new Error(`第 ${lineNumber} 行重复声明字段 "${key}"`);
      }
      if (key === "inputs") {
        if (rawValue) {
          throw new Error(`第 ${lineNumber} 行的 inputs 必须是映射`);
        }
        result.inputs = {};
      } else {
        result[key] = parseScalar(rawValue, lineNumber);
      }
      continue;
    }

    if (indent === 2 && Object.hasOwn(result, "inputs")) {
      if (rawValue) {
        throw new Error(`第 ${lineNumber} 行的输入 "${key}" 必须是映射`);
      }
      if (Object.hasOwn(result.inputs, key)) {
        throw new Error(`第 ${lineNumber} 行重复声明输入 "${key}"`);
      }
      result.inputs[key] = {};
      currentInput = key;
      continue;
    }

    if (indent === 4 && currentInput) {
      if (Object.hasOwn(result.inputs[currentInput], key)) {
        throw new Error(`第 ${lineNumber} 行重复声明输入字段 "${currentInput}.${key}"`);
      }
      result.inputs[currentInput][key] = parseScalar(rawValue, lineNumber);
      continue;
    }

    throw new Error(`第 ${lineNumber} 行使用了不支持的 YAML 结构`);
  }

  return result;
}

function splitMappingLine(line, lineNumber) {
  const separator = line.indexOf(":");
  if (separator <= 0) {
    throw new Error(`第 ${lineNumber} 行必须是 "字段: 值" 映射`);
  }

  const key = line.slice(0, separator).trim();
  const value = line.slice(separator + 1).trim();
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(key)) {
    throw new Error(`第 ${lineNumber} 行字段名 "${key}" 无效`);
  }
  return [key, value];
}

function parseScalar(value, lineNumber) {
  if (!value) {
    throw new Error(`第 ${lineNumber} 行缺少值`);
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  const unsupportedPrefixes = ["[", "{", "|", ">", "&", "*", "!", "- "];
  if (unsupportedPrefixes.some((prefix) => value.startsWith(prefix))) {
    throw new Error(`第 ${lineNumber} 行使用了不支持的 YAML 特性`);
  }
  return value;
}

function validateTemplate(template, fileName) {
  requireNonEmptyString(template.name, `${fileName}: name`);
  requireNonEmptyString(template.description, `${fileName}: description`);

  if (!template.inputs || typeof template.inputs !== "object" || Array.isArray(template.inputs)) {
    errors.push(`${fileName}: inputs 必须是非空映射`);
    return;
  }

  const inputEntries = Object.entries(template.inputs);
  if (inputEntries.length === 0) {
    errors.push(`${fileName}: inputs 必须至少声明一个输入`);
  }

  for (const [inputName, input] of inputEntries) {
    const keys = Object.keys(input);
    for (const key of keys) {
      if (key !== "required" && key !== "description") {
        errors.push(`${fileName}: 输入 "${inputName}" 包含不支持的字段 "${key}"`);
      }
    }
    if (typeof input.required !== "boolean") {
      errors.push(`${fileName}: 输入 "${inputName}" 的 required 必须是 true 或 false`);
    }
    requireNonEmptyString(input.description, `${fileName}: 输入 "${inputName}" 的 description`);
  }

  if (Object.hasOwn(template.inputs, "mask") && !Object.hasOwn(template.inputs, "image")) {
    errors.push(`${fileName}: 声明 mask 时必须同时声明 image`);
  }
}

function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    errors.push(`${label} 必须是非空字符串`);
  }
}
