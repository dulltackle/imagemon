import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skillDir = resolve(rootDir, "skills/imagemon");
const bundlePath = resolve(skillDir, "scripts/imagemon.mjs");
const packageJson = JSON.parse(readFileSync(resolve(rootDir, "package.json"), "utf8"));
const tempDir = mkdtempSync(join(tmpdir(), "imagemon-skill-check-"));

try {
  assertFile(resolve(skillDir, "SKILL.md"));
  assertFile(resolve(skillDir, "references/cli-contract.md"));
  assertFile(bundlePath);
  validateFrontmatter(readFileSync(resolve(skillDir, "SKILL.md"), "utf8"));

  const rebuiltPath = resolve(tempDir, "imagemon.mjs");
  execFileSync(process.execPath, [resolve(rootDir, "scripts/build-skill.mjs"), rebuiltPath], {
    cwd: rootDir,
    stdio: "pipe",
  });
  if (!readFileSync(bundlePath).equals(readFileSync(rebuiltPath))) {
    fail("已提交的 skill bundle 与源码不一致，请运行 npm run build:skill");
  }

  const help = runBundle(["--help"]);
  assert(help.status === 0, "--help 应以 0 退出");
  assert(help.stdout === "", "--help 不应写入 stdout");
  assert(help.stderr.includes("Usage: imagemon <generate|edit>"), "--help 缺少用法说明");

  const version = runBundle(["--version"]);
  assert(version.status === 0, "--version 应以 0 退出");
  assert(version.stdout === "", "--version 不应写入 stdout");
  assert(version.stderr === `imagemon ${packageJson.version}\n`, "bundle 版本与 package.json 不一致");

  const arbitraryCwd = resolve(tempDir, "arbitrary-cwd");
  mkdirSync(arbitraryCwd);
  const missingPrompt = runBundle(["generate"], arbitraryCwd);
  assert(missingPrompt.status !== 0, "缺少 --prompt 应以非 0 退出");
  assertSingleLineFailure(missingPrompt.stdout, "INVALID_OPTION");

  const relativeOut = "relative-output";
  const relativeRun = runBundle(["generate", "--prompt", "测试", "--out", relativeOut], arbitraryCwd);
  assert(relativeRun.status !== 0, "缺少 API 配置时应以非 0 退出");
  assertSingleLineFailure(relativeRun.stdout, "EXECUTION_ERROR");
  assert(statSync(resolve(arbitraryCwd, relativeOut)).isDirectory(), "相对输出目录应基于调用方工作目录创建");

  console.log("Imagemon skill 校验通过");
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

function runBundle(args, cwd = tempDir) {
  const result = spawnSync(process.execPath, [bundlePath, ...args], {
    cwd,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      HOME: tempDir,
    },
  });

  if (result.error) {
    throw result.error;
  }

  return result;
}

function assertFile(path) {
  try {
    assert(statSync(path).isFile(), `缺少必需文件：${path}`);
  } catch {
    fail(`缺少必需文件：${path}`);
  }
}

function validateFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n/);
  assert(match, "SKILL.md 缺少合法 frontmatter");
  assert(/^name:\s*imagemon\s*$/m.test(match[1]), "SKILL.md frontmatter 的 name 必须为 imagemon");
  assert(/^description:\s*\S.+$/m.test(match[1]), "SKILL.md frontmatter 缺少非空 description");
}

function assertSingleLineFailure(stdout, expectedCode) {
  const lines = stdout.trimEnd().split("\n");
  assert(lines.length === 1, "CLI stdout 必须是唯一一行 JSON");
  const parsed = JSON.parse(lines[0]);
  assert(parsed.ok === false, "失败输出的 ok 必须为 false");
  assert(parsed.error?.code === expectedCode, `失败输出错误码应为 ${expectedCode}`);
}

function assert(condition, message) {
  if (!condition) {
    fail(message);
  }
}

function fail(message) {
  throw new Error(message);
}
