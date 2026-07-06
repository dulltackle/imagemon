#!/usr/bin/env node
// 统一更新 monorepo 所有 workspace 包的版本号。
// 用法：
//   npm run version:sync -- patch
//   npm run version:sync -- minor
//   npm run version:sync -- major
//   npm run version:sync -- 1.2.3
//
// 脚本只负责修改 package.json，不自动 git commit/tag，
// 让后续 `npm run verify` 在提交前先校验版本一致性。

import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import semver from "semver";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const targets = [
  "package.json",
  "packages/core/package.json",
  "apps/mobile/package.json",
];

const arg = process.argv[2];
if (!arg) {
  console.error("用法: npm run version:sync -- <patch|minor|major|x.y.z>");
  process.exit(1);
}

async function readPkg(rel) {
  const abs = resolve(rootDir, rel);
  return [abs, JSON.parse(await readFile(abs, "utf8"))];
}

const [, rootPkg] = await readPkg("package.json");
const current = rootPkg.version;

const bump = /^(major|minor|patch|premajor|preminor|prepatch|prerelease)$/.test(arg);
const next = bump
  ? semver.inc(current, arg)
  : (semver.valid(arg) ?? null);

if (!next) {
  console.error(`无效版本参数: ${arg}（当前版本 ${current}）`);
  process.exit(1);
}
if (semver.lt(next, current)) {
  console.error(`不允许降版本: ${current} → ${next}`);
  process.exit(1);
}

for (const rel of targets) {
  const [abs, pkg] = await readPkg(rel);
  pkg.version = next;
  await writeFile(abs, `${JSON.stringify(pkg, null, 2)}\n`);
  console.log(`  ${rel}: ${pkg.version}`);
}
console.log(`✓ 已统一版本 ${current} → ${next}`);
