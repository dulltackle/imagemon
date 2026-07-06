#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skillInputPaths = [
  "package.json",
  "packages/core/package.json",
  "src",
  "packages/core/src",
  "scripts/build-skill.mjs",
];
const skillBundlePaths = [
  ".agents/skills/imagemon/scripts/imagemon.mjs",
  ".agents/skills/imagemon-promptdex/scripts/imagemon.mjs",
  ".agents/skills/imagemon-promptdex/scripts/promptdex.mjs",
];

const unstagedInputs = listUnstagedInputFiles();
if (unstagedInputs.length > 0) {
  console.error("Skill bundle 输入文件存在未暂存改动，请先暂存或清理后再提交：");
  for (const path of unstagedInputs) {
    console.error(`  ${path}`);
  }
  process.exit(1);
}

run("npm", ["run", "build:skill"]);
run("git", ["add", ...skillBundlePaths]);
run("npm", ["run", "check:skill"]);

console.log("Skill bundle 已同步并校验通过");

function listUnstagedInputFiles() {
  return uniqueSorted([
    ...gitLines(["diff", "--name-only", "--", ...skillInputPaths]),
    ...gitLines(["ls-files", "--others", "--exclude-standard", "--", ...skillInputPaths]),
  ]);
}

function gitLines(args) {
  const output = execFileSync("git", args, {
    cwd: rootDir,
    encoding: "utf8",
  });
  return output.trim().split(/\r?\n/).filter(Boolean);
}

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

function run(command, args) {
  const result = spawnSync(commandForPlatform(command), args, {
    cwd: rootDir,
    stdio: "inherit",
    shell: false,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function commandForPlatform(command) {
  if (process.platform === "win32" && command === "npm") {
    return "npm.cmd";
  }
  return command;
}
