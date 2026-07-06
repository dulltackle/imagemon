#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const hooksDir = resolve(rootDir, ".githooks");
const preCommitHook = resolve(hooksDir, "pre-commit");

if (!existsSync(preCommitHook)) {
  console.warn("未找到 .githooks/pre-commit，跳过 Git hook 安装");
  process.exit(0);
}

try {
  execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd: rootDir,
    stdio: "ignore",
  });
} catch {
  console.log("未检测到 Git 仓库，跳过 Git hook 安装");
  process.exit(0);
}

chmodSync(preCommitHook, 0o755);
execFileSync("git", ["config", "core.hooksPath", ".githooks"], {
  cwd: rootDir,
  stdio: "inherit",
});

console.log("已安装 Git hooks：core.hooksPath=.githooks");
