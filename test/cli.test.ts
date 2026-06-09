import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
      error: { message: "--prompt is required" },
    });
  });

  it("edit 缺少 image 时返回非 0 和结构化错误", async () => {
    const { fetchMock, requests } = createJsonFetchRecorder();
    const { streams, readStdout } = createStreams();

    const code = await runImagemonCli(["edit", "--prompt", "编辑图片"], { fetch: fetchMock, streams });

    expect(code).toBe(1);
    expect(requests).toHaveLength(0);
    expect(JSON.parse(readStdout()).error.message).toBe("--image is required for edit");
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
    expect(JSON.parse(readStdout()).error.message).toBe("Unknown option: --unknown");
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
    expect(JSON.parse(readStdout()).error.message).toContain("Output path is not a directory");
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
