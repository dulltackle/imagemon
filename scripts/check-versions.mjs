#!/usr/bin/env node
// 校验 monorepo 根与所有 workspace 子包的版本号一致。
// 不一致则打印差异并 exit 1，供 `verify` 与 CI 拦截不同步的发版。

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packages = [
  ["imagemon", "package.json"],
  ["@imagemon/core", "packages/core/package.json"],
  ["@imagemon/mobile", "apps/mobile/package.json"],
];

const rows = packages.map(([name, rel]) => {
  const abs = resolve(rootDir, rel);
  const pkg = JSON.parse(readFileSync(abs, "utf8"));
  return { name, rel, version: pkg.version };
});

const versions = new Set(rows.map((r) => r.version));
if (versions.size !== 1) {
  console.error("✗ monorepo 版本号不一致：");
  for (const { version, name } of rows) {
    console.error(`  ${version}\t${name}`);
  }
  process.exit(1);
}

console.log(`✓ 版本一致：${[...versions][0]}`);
