#!/usr/bin/env node

import { readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rootDir = parseRoot(process.argv.slice(2));
const requirements = {
  imagemon: [
    "SKILL.md",
    "references/cli-contract.md",
    "scripts/imagemon.mjs",
    "evals/trigger-cases.json",
  ],
  "imagemon-promptdex": [
    "SKILL.md",
    "references/template-contract.md",
    "references/templates/light-infographic.md",
    "scripts/imagemon.mjs",
    "scripts/promptdex.mjs",
    "evals/trigger-cases.json",
  ],
  "imagemon-promptdex-builder": [
    "SKILL.md",
    "references/refinement-policy.md",
    "references/proposal-format.md",
    "evals/trigger-cases.json",
  ],
};

for (const [skillName, files] of Object.entries(requirements)) {
  const skillDir = resolve(rootDir, "skills", skillName);
  for (const file of files) assertFile(resolve(skillDir, file));

  const skillPath = resolve(skillDir, "SKILL.md");
  const skillSource = readFileSync(skillPath, "utf8");
  validateFrontmatter(skillSource, skillName);
  validateTriggerCases(resolve(skillDir, "evals", "trigger-cases.json"), skillName);

  if (skillName === "imagemon-promptdex" || skillName === "imagemon-promptdex-builder") {
    validateRelativeLinks(skillSource, skillPath);
  }
  if (skillName === "imagemon-promptdex") validatePromptdexExecutionContract(skillSource);
}

console.log("三项 Skill 结构校验通过");

function parseRoot(args) {
  if (args.length === 0) return defaultRoot;
  if (args.length === 2 && args[0] === "--root" && args[1]) return resolve(args[1]);
  fail("用法：node scripts/check-skills.mjs [--root <path>]");
}

function validateFrontmatter(source, skillName) {
  const match = source.match(/^---\n([\s\S]*?)\n---\n/);
  assert(match, `${skillName}/SKILL.md 缺少合法 frontmatter`);
  const fields = {};
  for (const line of match[1].split("\n")) {
    const separator = line.indexOf(":");
    if (separator > 0) fields[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  assert(fields.name === skillName, `${skillName}/SKILL.md 的 name 必须与目录名一致`);
  assert(typeof fields.description === "string" && fields.description.length > 0, `${skillName}/SKILL.md 缺少非空 description`);
}

function validateTriggerCases(path, skillName) {
  let document;
  try {
    document = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    fail(`${skillName} 的 trigger-cases.json 必须是合法 JSON`);
  }
  assert(document?.skill === skillName, `${skillName} 的 trigger-cases.json 中 skill 必须与目录名一致`);
  assert(Array.isArray(document.cases), `${skillName} 的 trigger-cases.json 缺少 cases 数组`);
  const ids = new Set();
  let positive = false;
  let negative = false;
  for (const [index, triggerCase] of document.cases.entries()) {
    const label = `${skillName} 的第 ${index + 1} 个 trigger case`;
    assert(isNonEmptyString(triggerCase?.id), `${label} 缺少非空 id`);
    assert(!ids.has(triggerCase.id), `${skillName} 的 trigger case id 重复：${triggerCase.id}`);
    ids.add(triggerCase.id);
    assert(isNonEmptyString(triggerCase.prompt), `${label} 缺少非空 prompt`);
    assert(typeof triggerCase.shouldTrigger === "boolean", `${label} 的 shouldTrigger 必须是布尔值`);
    assert(isNonEmptyString(triggerCase.reason), `${label} 缺少非空 reason`);
    positive ||= triggerCase.shouldTrigger === true;
    negative ||= triggerCase.shouldTrigger === false;
  }
  assert(positive && negative, `${skillName} 必须同时包含正向和负向触发样本`);
}

function validateRelativeLinks(source, skillPath) {
  const linkPattern = /\]\(([^)]+)\)/g;
  for (const match of source.matchAll(linkPattern)) {
    const target = match[1].split("#", 1)[0];
    if (!target || /^[a-z]+:/i.test(target) || target.startsWith("#")) continue;
    assertFile(resolve(dirname(skillPath), target));
  }
}

function validatePromptdexExecutionContract(source) {
  assert(
    source.includes("保持 `<project-root>` 为当前工作目录") && source.includes("不得切换到 `<skill-root>`"),
    "imagemon-promptdex/SKILL.md 必须声明保持调用方项目工作目录",
  );
  assert(
    source.includes("相对输出目录") && source.includes("相对于 `<project-root>` 解析"),
    "imagemon-promptdex/SKILL.md 必须声明相对输出目录基于调用方项目工作目录解析",
  );
  assert(
    !/\bnode\s+scripts\/(?:promptdex|imagemon)\.mjs\b/.test(source),
    "imagemon-promptdex/SKILL.md 不得使用相对于 skill 目录的裸脚本路径",
  );
  for (const script of ["promptdex.mjs", "imagemon.mjs"]) {
    assert(
      source.includes(`node <skill-root>/scripts/${script}`),
      `imagemon-promptdex/SKILL.md 必须使用 <skill-root> 绝对路径调用 ${script}`,
    );
  }
}

function assertFile(path) {
  try {
    assert(statSync(path).isFile(), `缺少必需文件：${path}`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("缺少必需文件：")) throw error;
    fail(`缺少必需文件：${path}`);
  }
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function fail(message) {
  throw new Error(message);
}
