#!/usr/bin/env node

import { readdirSync } from "node:fs";
import { basename, dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".expo",
  "build",
  "coverage",
  "dist",
  "node_modules",
]);
const ADR_FILE_PATTERN = /^(\d{4})-(.+)\.md$/;

const root = parseRoot(process.argv.slice(2));
const adrFiles = collectAdrFiles(root);

if (adrFiles.length === 0) {
  fail("未找到任何 docs/adr 目录中的 ADR Markdown 文件");
}

const invalidFiles = [];
const filesByNumber = new Map();

for (const file of adrFiles) {
  const match = ADR_FILE_PATTERN.exec(basename(file));
  const relativePath = normalizePath(relative(root, file));
  if (!match) {
    invalidFiles.push(relativePath);
    continue;
  }

  const number = match[1];
  const files = filesByNumber.get(number) ?? [];
  files.push(relativePath);
  filesByNumber.set(number, files);
}

const duplicateNumbers = [...filesByNumber.entries()]
  .filter(([, files]) => files.length > 1)
  .sort(([left], [right]) => left.localeCompare(right));

if (invalidFiles.length > 0 || duplicateNumbers.length > 0) {
  if (invalidFiles.length > 0) {
    console.error("ADR 文件名必须使用 <四位编号>-<slug>.md 格式：");
    for (const file of invalidFiles.sort()) console.error(`  ${file}`);
  }

  for (const [number, files] of duplicateNumbers) {
    console.error(`ADR 编号 ${number} 重复：`);
    for (const file of files.sort()) console.error(`  ${file}`);
  }
  process.exit(1);
}

console.log(`ADR 编号校验通过：${adrFiles.length} 份 ADR 全局唯一`);

function parseRoot(args) {
  if (args.length === 0) return DEFAULT_ROOT;
  if (args.length === 2 && args[0] === "--root" && args[1]) {
    return resolve(args[1]);
  }
  fail("用法：node scripts/check-adrs.mjs [--root <path>]");
}

function collectAdrFiles(rootDirectory) {
  const files = [];
  walk(rootDirectory, files);
  return files.sort();
}

function walk(directory, files) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;

    const absolutePath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      walk(absolutePath, files);
      continue;
    }

    if (
      entry.isFile()
      && entry.name.endsWith(".md")
      && basename(directory) === "adr"
      && basename(dirname(directory)) === "docs"
    ) {
      files.push(absolutePath);
    }
  }
}

function normalizePath(path) {
  return path.split(sep).join("/");
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
