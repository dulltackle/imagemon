import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import packageJson from "../package.json" with { type: "json" };
import { runImagemonCli } from "../src/cli.js";
import { DEFAULT_IMAGE_MODEL } from "../src/lib/image.js";

const originalEnv = {
  IMAGEMON_API_KEY: process.env.IMAGEMON_API_KEY,
  IMAGEMON_API_BASE_URL: process.env.IMAGEMON_API_BASE_URL,
  IMAGEMON_API_CONFIG_FILE: process.env.IMAGEMON_API_CONFIG_FILE,
  IMAGEMON_API_TIMEOUT_MS: process.env.IMAGEMON_API_TIMEOUT_MS,
  IMAGEMON_API_MAX_RETRIES: process.env.IMAGEMON_API_MAX_RETRIES,
};
let tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "image-cli-test-"));
  tempDirs.push(dir);
  return dir;
}

function createJsonFetchRecorder(responseBody: unknown = { created: 123, data: [{ b64_json: "abc" }] }) {
  const requests: Array<{ url: string; init: RequestInit; body: unknown }> = [];
  const fetchMock: typeof fetch = async (input, init = {}) => {
    const body = typeof init.body === "string" ? JSON.parse(init.body) : init.body;
    requests.push({ url: String(input), init, body });

    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  return { fetchMock, requests };
}

function createStreams() {
  let stdout = "";
  let stderr = "";

  return {
    streams: {
      stdout: {
        write(chunk: string) {
          stdout += chunk;
          return true;
        },
      },
      stderr: {
        write(chunk: string) {
          stderr += chunk;
          return true;
        },
      },
    },
    readStdout: () => stdout,
    readStderr: () => stderr,
  };
}

function restoreEnv(name: keyof typeof originalEnv, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

beforeEach(() => {
  delete process.env.IMAGEMON_API_KEY;
  delete process.env.IMAGEMON_API_BASE_URL;
  delete process.env.IMAGEMON_API_CONFIG_FILE;
  delete process.env.IMAGEMON_API_TIMEOUT_MS;
  delete process.env.IMAGEMON_API_MAX_RETRIES;
});

afterEach(() => {
  restoreEnv("IMAGEMON_API_KEY", originalEnv.IMAGEMON_API_KEY);
  restoreEnv("IMAGEMON_API_BASE_URL", originalEnv.IMAGEMON_API_BASE_URL);
  restoreEnv("IMAGEMON_API_CONFIG_FILE", originalEnv.IMAGEMON_API_CONFIG_FILE);
  restoreEnv("IMAGEMON_API_TIMEOUT_MS", originalEnv.IMAGEMON_API_TIMEOUT_MS);
  restoreEnv("IMAGEMON_API_MAX_RETRIES", originalEnv.IMAGEMON_API_MAX_RETRIES);

  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

describe("runImagemonCli", () => {
  it("generate 调用 images/generations 并写出图片和元数据", async () => {
    const outDir = createTempDir();
    const { fetchMock, requests } = createJsonFetchRecorder({
      created: 456,
      data: [{ b64_json: Buffer.from("generated").toString("base64") }],
      usage: { total_tokens: 5, input_tokens: 2, output_tokens: 3 },
      size: "1024x1024",
      quality: "medium",
      output_format: "webp",
    });
    const { streams, readStdout, readStderr } = createStreams();

    const code = await runImagemonCli(
      [
        "generate",
        "--prompt",
        "生成一张图片",
        "--out",
        outDir,
        "--format",
        "webp",
        "--api-key",
        "test-key",
        "--base-url",
        "https://third-party.example/v1",
      ],
      { fetch: fetchMock, streams, now: new Date("2026-06-01T00:00:00.000Z") },
    );

    expect(code).toBe(0);
    expect(readStderr()).toBe("");
    const output = JSON.parse(readStdout());
    expect(output).toMatchObject({
      ok: true,
      usage: { total_tokens: 5, input_tokens: 2, output_tokens: 3 },
    });
    expect(output.files).toHaveLength(1);
    expect(output.files[0]).toMatch(
      new RegExp(`^${escapeRegExp(join(outDir, "2026-06-01T00-00-00-000Z-"))}[0-9a-f]{6}-0\\.webp$`),
    );
    expect(output.metadataPath).toBe(output.files[0].replace(/-0\.webp$/, ".json"));
    expect(readFileSync(output.files[0], "utf8")).toBe("generated");
    expect(JSON.parse(readFileSync(output.metadataPath, "utf8"))).toMatchObject({
      request: {
        command: "generate",
        model: DEFAULT_IMAGE_MODEL,
        prompt: "生成一张图片",
        output_format: "webp",
      },
    });
    expect(requests[0]?.url).toBe("https://third-party.example/v1/images/generations");
    expect(requests[0]?.body).toMatchObject({
      model: DEFAULT_IMAGE_MODEL,
      prompt: "生成一张图片",
      output_format: "webp",
    });
  });

  it("gpt-image-2 便捷尺寸写入请求和元数据", async () => {
    const outDir = createTempDir();
    const { fetchMock, requests } = createJsonFetchRecorder({
      created: 456,
      data: [{ b64_json: Buffer.from("generated").toString("base64") }],
    });
    const { streams, readStdout } = createStreams();

    const code = await runImagemonCli(
      [
        "generate",
        "--model",
        "gpt-image-2",
        "--prompt",
        "生成一张图片",
        "--size",
        "3840x2160",
        "--out",
        outDir,
        "--api-key",
        "test-key",
        "--base-url",
        "https://third-party.example/v1",
      ],
      { fetch: fetchMock, streams, now: new Date("2026-06-01T00:00:00.000Z") },
    );

    expect(code).toBe(0);
    const output = JSON.parse(readStdout());
    expect(requests[0]?.body).toMatchObject({ model: "gpt-image-2", size: "3840x2160" });
    expect(JSON.parse(readFileSync(output.metadataPath, "utf8"))).toMatchObject({
      request: { model: "gpt-image-2", size: "3840x2160" },
    });
  });

  it("edit 读取本地图片并调用 images/edits", async () => {
    const outDir = createTempDir();
    const inputPath = join(outDir, "input.png");
    writeFileSync(inputPath, "input");
    const { fetchMock, requests } = createJsonFetchRecorder({
      created: 456,
      data: [{ b64_json: Buffer.from("edited").toString("base64") }],
      output_format: "png",
    });
    const { streams, readStdout } = createStreams();

    const code = await runImagemonCli(
      [
        "edit",
        "--image",
        inputPath,
        "--prompt",
        "编辑图片",
        "--out",
        outDir,
        "--api-key",
        "test-key",
        "--base-url",
        "https://third-party.example/v1",
      ],
      { fetch: fetchMock, streams, now: new Date("2026-06-01T00:00:00.000Z") },
    );

    expect(code).toBe(0);
    const output = JSON.parse(readStdout());
    expect(readFileSync(output.files[0], "utf8")).toBe("edited");
    expect(requests[0]?.url).toBe("https://third-party.example/v1/images/edits");
    expect(requests[0]?.init.body).toBeInstanceOf(FormData);

    const formData = requests[0]?.init.body as FormData;
    expect(formData.get("model")).toBe(DEFAULT_IMAGE_MODEL);
    expect(formData.get("prompt")).toBe("编辑图片");
    expect(formData.get("image")).toBeInstanceOf(File);
  });

  it("缺少必填参数时返回非 0 和结构化错误", async () => {
    const { fetchMock, requests } = createJsonFetchRecorder();
    const { streams, readStdout } = createStreams();

    const code = await runImagemonCli(["generate"], { fetch: fetchMock, streams });

    expect(code).toBe(1);
    expect(JSON.parse(readStdout())).toEqual({
      ok: false,
      files: [],
      metadataPath: null,
      error: { code: "INVALID_OPTION", message: "--prompt is required" },
    });
    expect(requests).toHaveLength(0);
  });

  it("--prompt-file 原样读取超长特殊字符提示词", async () => {
    const dir = createTempDir();
    const promptPath = join(dir, "prompt.txt");
    const prompt = `反引号 \` 引号 " 尖括号 <tag> # 标题\n${"很长的内容".repeat(800)}`;
    writeFileSync(promptPath, prompt);
    const { fetchMock, requests } = createJsonFetchRecorder();
    const { streams } = createStreams();

    const code = await runImagemonCli(
      ["generate", "--prompt-file", promptPath, "--out", dir, "--api-key", "test-key"],
      { fetch: fetchMock, streams },
    );

    expect(code).toBe(0);
    expect(requests[0]?.body).toMatchObject({ prompt });
  });

  it("--prompt-file 冲突、缺失、不可读或为空时在请求前失败", async () => {
    const dir = createTempDir();
    const emptyPath = join(dir, "empty.txt");
    writeFileSync(emptyPath, "");
    for (const argv of [
      ["generate", "--prompt", "x", "--prompt-file", emptyPath],
      ["generate", "--prompt-file", join(dir, "missing.txt")],
      ["generate", "--prompt-file", emptyPath],
    ]) {
      const { fetchMock, requests } = createJsonFetchRecorder();
      const { streams, readStdout } = createStreams();
      expect(await runImagemonCli(argv, { fetch: fetchMock, streams })).toBe(1);
      expect(JSON.parse(readStdout()).ok).toBe(false);
      expect(requests).toHaveLength(0);
    }
  });

  it("edit 缺少 image 时返回非 0 和结构化错误", async () => {
    const { fetchMock, requests } = createJsonFetchRecorder();
    const { streams, readStdout } = createStreams();

    const code = await runImagemonCli(["edit", "--prompt", "编辑图片"], { fetch: fetchMock, streams });

    expect(code).toBe(1);
    expect(requests).toHaveLength(0);
    expect(JSON.parse(readStdout()).error).toEqual({
      code: "INVALID_OPTION",
      message: "--image is required for edit",
    });
  });

  it("未知参数时返回非 0 和结构化错误", async () => {
    const { fetchMock, requests } = createJsonFetchRecorder();
    const { streams, readStdout } = createStreams();

    const code = await runImagemonCli(["generate", "--prompt", "生成一张图片", "--unknown", "x"], {
      fetch: fetchMock,
      streams,
    });

    expect(code).toBe(1);
    expect(requests).toHaveLength(0);
    expect(JSON.parse(readStdout()).error).toEqual({
      code: "INVALID_OPTION",
      message: "Unknown option: --unknown",
    });
  });

  it("非法 quality 在网络请求前失败", async () => {
    const { fetchMock, requests } = createJsonFetchRecorder();
    const { streams, readStdout } = createStreams();

    const code = await runImagemonCli(["generate", "--prompt", "生成一张图片", "--quality", "ultra"], {
      fetch: fetchMock,
      streams,
    });

    expect(code).toBe(1);
    expect(requests).toHaveLength(0);
    expect(JSON.parse(readStdout()).error).toEqual({
      code: "INVALID_OPTION",
      message: "--quality must be one of auto, low, medium, or high",
    });
  });

  it("非法 size 在网络请求前失败", async () => {
    const { fetchMock, requests } = createJsonFetchRecorder();
    const { streams, readStdout } = createStreams();

    const code = await runImagemonCli(["generate", "--prompt", "生成一张图片", "--size", "large"], {
      fetch: fetchMock,
      streams,
    });

    expect(code).toBe(1);
    expect(requests).toHaveLength(0);
    expect(JSON.parse(readStdout()).error).toEqual({
      code: "INVALID_OPTION",
      message: "--size must be auto or a WIDTHxHEIGHT string",
    });
  });

  it("重复参数在网络请求前失败", async () => {
    const { fetchMock, requests } = createJsonFetchRecorder();
    const { streams, readStdout } = createStreams();

    const code = await runImagemonCli(
      ["generate", "--prompt", "第一张图片", "--prompt=第二张图片"],
      { fetch: fetchMock, streams },
    );

    expect(code).toBe(1);
    expect(requests).toHaveLength(0);
    expect(JSON.parse(readStdout()).error).toEqual({
      code: "INVALID_OPTION",
      message: "Duplicate option: --prompt",
    });
  });

  it("--json=value 在网络请求前失败", async () => {
    const { fetchMock, requests } = createJsonFetchRecorder();
    const { streams, readStdout } = createStreams();

    const code = await runImagemonCli(["generate", "--prompt", "生成一张图片", "--json=true"], {
      fetch: fetchMock,
      streams,
    });

    expect(code).toBe(1);
    expect(requests).toHaveLength(0);
    expect(JSON.parse(readStdout()).error).toEqual({
      code: "INVALID_OPTION",
      message: "--json does not accept a value",
    });
  });

  it("空字符串参数和非整数 n 在网络请求前失败", async () => {
    for (const argv of [
      ["generate", "--prompt", "生成一张图片", "--model="],
      ["generate", "--prompt", "生成一张图片", "--n", "1.5"],
    ]) {
      const { fetchMock, requests } = createJsonFetchRecorder();
      const { streams, readStdout } = createStreams();

      const code = await runImagemonCli(argv, { fetch: fetchMock, streams });

      expect(code).toBe(1);
      expect(requests).toHaveLength(0);
      expect(JSON.parse(readStdout()).error.code).toBe("INVALID_OPTION");
    }
  });

  it("--help 和 --version 使用 stderr 输出稳定信息", async () => {
    const help = createStreams();
    const version = createStreams();

    expect(await runImagemonCli(["--help"], { streams: help.streams })).toBe(0);
    expect(help.readStdout()).toBe("");
    expect(help.readStderr()).toContain("Usage: imagemon <generate|edit>");

    expect(await runImagemonCli(["--version"], { streams: version.streams })).toBe(0);
    expect(version.readStdout()).toBe("");
    expect(version.readStderr()).toBe(`imagemon ${packageJson.version}\n`);
  });

  it("输出路径是文件时返回非 0 和结构化错误", async () => {
    const dir = createTempDir();
    const outPath = join(dir, "not-dir");
    writeFileSync(outPath, "x");
    const { fetchMock, requests } = createJsonFetchRecorder();
    const { streams, readStdout } = createStreams();

    const code = await runImagemonCli(
      [
        "generate",
        "--prompt",
        "生成一张图片",
        "--out",
        outPath,
        "--api-key",
        "test-key",
        "--base-url",
        "https://third-party.example/v1",
      ],
      { fetch: fetchMock, streams },
    );

    expect(code).toBe(1);
    expect(requests).toHaveLength(0);
    expect(JSON.parse(readStdout()).error).toMatchObject({
      code: "EXECUTION_ERROR",
      message: expect.stringContaining("Output path is not a directory"),
    });
  });

  it("format 参数决定默认文件扩展名", async () => {
    const outDir = createTempDir();
    const { fetchMock } = createJsonFetchRecorder({
      created: 456,
      data: [{ b64_json: Buffer.from("generated").toString("base64") }],
    });
    const { streams, readStdout } = createStreams();

    const code = await runImagemonCli(
      [
        "generate",
        "--prompt",
        "生成一张图片",
        "--out",
        outDir,
        "--format",
        "jpeg",
        "--api-key",
        "test-key",
        "--base-url",
        "https://third-party.example/v1",
      ],
      { fetch: fetchMock, streams, now: new Date("2026-06-01T00:00:00.000Z") },
    );

    expect(code).toBe(0);
    expect(JSON.parse(readStdout()).files[0]).toMatch(
      new RegExp(`^${escapeRegExp(join(outDir, "2026-06-01T00-00-00-000Z-"))}[0-9a-f]{6}-0\\.jpeg$`),
    );
  });
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
