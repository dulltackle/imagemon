import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { runImagemonCli as RunImagemonCli } from "../src/cli.js";

const bundlePath = resolve("skills/imagemon/scripts/imagemon.mjs");
const promptdexBundlePath = resolve("skills/imagemon-promptdex/scripts/imagemon.mjs");
const bundle = (await import(pathToFileURL(bundlePath).href)) as {
  runImagemonCli: typeof RunImagemonCli;
};
const { runImagemonCli } = bundle;

let tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "imagemon-skill-bundle-test-"));
  tempDirs.push(dir);
  return dir;
}

function createStreams() {
  let stdout = "";
  let stderr = "";

  return {
    streams: {
      stdout: { write: (chunk: string) => Boolean((stdout += chunk)) },
      stderr: { write: (chunk: string) => Boolean((stderr += chunk)) },
    },
    readStdout: () => stdout,
    readStderr: () => stderr,
  };
}

function createFetchMock(imageContent: string) {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fetchMock: typeof fetch = async (input, init) => {
    requests.push({ url: String(input), init });
    return new Response(
      JSON.stringify({
        created: 1,
        data: [{ b64_json: Buffer.from(imageContent).toString("base64") }],
        usage: { total_tokens: 1 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
  return { fetchMock, requests };
}

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

describe("自包含 skill bundle", () => {
  it("两个正式 bundle 字节一致", () => {
    expect(readFileSync(promptdexBundlePath).equals(readFileSync(bundlePath))).toBe(true);
  });

  it("Promptdex bundle 在隔离目录中不依赖仓库文件运行", () => {
    const cwd = createTempDir();
    const isolatedBundle = join(cwd, "imagemon.mjs");
    copyFileSync(promptdexBundlePath, isolatedBundle);

    const version = spawnSync(process.execPath, [isolatedBundle, "--version"], { cwd, encoding: "utf8" });
    const failure = spawnSync(process.execPath, [isolatedBundle, "generate"], { cwd, encoding: "utf8" });

    expect(version.status).toBe(0);
    expect(version.stdout).toBe("");
    expect(version.stderr).toMatch(/^imagemon \d+\.\d+\.\d+\n$/);
    expect(failure.status).not.toBe(0);
    expect(JSON.parse(failure.stdout)).toMatchObject({ ok: false, error: { code: "INVALID_OPTION" } });
  });

  it("两个 bundle 的版本和输出协议一致", () => {
    const cwd = createTempDir();
    for (const path of [bundlePath, promptdexBundlePath]) {
      const version = spawnSync(process.execPath, [path, "--version"], { cwd, encoding: "utf8" });
      const failure = spawnSync(process.execPath, [path, "generate"], { cwd, encoding: "utf8" });
      expect(version.stderr).toBe("imagemon 0.2.0\n");
      expect(failure.stdout.trimEnd().split("\n")).toHaveLength(1);
      expect(JSON.parse(failure.stdout).error.code).toBe("INVALID_OPTION");
    }
  });

  it("generate 使用模拟请求并输出稳定 JSON", async () => {
    const cwd = createTempDir();
    const outDir = join(cwd, "outputs");
    const { fetchMock, requests } = createFetchMock("generated");
    const output = createStreams();

    const code = await runImagemonCli(
      [
        "generate",
        "--prompt",
        "生成图片",
        "--out",
        outDir,
        "--api-key",
        "test-key",
        "--base-url",
        "https://api.openai.com/v1",
      ],
      { fetch: fetchMock, streams: output.streams },
    );

    expect(code).toBe(0);
    expect(output.readStderr()).toBe("");
    const result = JSON.parse(output.readStdout());
    expect(result).toMatchObject({ ok: true, usage: { total_tokens: 1 } });
    expect(readFileSync(result.files[0], "utf8")).toBe("generated");
    expect(requests[0]?.url).toBe("https://api.openai.com/v1/images/generations");
  });

  it("edit 使用模拟请求并上传本地图片", async () => {
    const cwd = createTempDir();
    const inputPath = join(cwd, "input.png");
    writeFileSync(inputPath, "input");
    const { fetchMock, requests } = createFetchMock("edited");
    const output = createStreams();

    const code = await runImagemonCli(
      [
        "edit",
        "--image",
        inputPath,
        "--prompt",
        "编辑图片",
        "--out",
        join(cwd, "outputs"),
        "--api-key",
        "test-key",
        "--base-url",
        "https://api.openai.com/v1",
      ],
      { fetch: fetchMock, streams: output.streams },
    );

    expect(code).toBe(0);
    const result = JSON.parse(output.readStdout());
    expect(readFileSync(result.files[0], "utf8")).toBe("edited");
    expect(requests[0]?.url).toBe("https://api.openai.com/v1/images/edits");
    expect(requests[0]?.init?.body).toBeInstanceOf(FormData);
  });

  it("相对输出目录和配置文件基于调用方工作目录解析", async () => {
    const cwd = createTempDir();
    const previousCwd = process.cwd();
    writeFileSync(
      join(cwd, "imagemon.config.json"),
      JSON.stringify({ apiKey: "config-key", baseURL: "https://config.example/v1" }),
    );
    const { fetchMock, requests } = createFetchMock("relative");
    const output = createStreams();

    try {
      process.chdir(cwd);
      const code = await runImagemonCli(
        [
          "generate",
          "--prompt",
          "生成图片",
          "--out",
          "relative-output",
          "--config",
          "imagemon.config.json",
        ],
        { fetch: fetchMock, streams: output.streams },
      );

      expect(code).toBe(0);
      const result = JSON.parse(output.readStdout());
      expect(result.files[0]).toMatch(new RegExp(`^${escapeRegExp(resolve(cwd, "relative-output"))}`));
      expect(requests[0]?.url).toBe("https://config.example/v1/images/generations");
    } finally {
      process.chdir(previousCwd);
    }
  });
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
