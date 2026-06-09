import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { saveImageResult } from "../src/lib/image-output.js";

let tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "image-output-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

describe("saveImageResult", () => {
  it("将多张 base64 图片和元数据写入输出目录", async () => {
    const outDir = createTempDir();
    const result = await saveImageResult(
      {
        created: 123,
        images: [
          { b64_json: Buffer.from("image-0").toString("base64") },
          { b64_json: Buffer.from("image-1").toString("base64") },
        ],
        usage: { total_tokens: 3, input_tokens: 1, output_tokens: 2 },
        size: "1024x1024",
        quality: "high",
        output_format: "webp",
      },
      {
        outDir,
        baseName: "sample",
        createdAt: new Date("2026-06-01T00:00:00.000Z"),
        request: {
          model: "gpt-image-2",
          prompt: "生成一张图片",
        },
      },
    );

    expect(result.files).toEqual([join(outDir, "sample-0.webp"), join(outDir, "sample-1.webp")]);
    expect(readFileSync(result.files[0], "utf8")).toBe("image-0");
    expect(readFileSync(result.files[1], "utf8")).toBe("image-1");
    expect(result.metadataPath).toBe(join(outDir, "sample.json"));

    const metadata = JSON.parse(readFileSync(result.metadataPath, "utf8"));
    expect(metadata).toMatchObject({
      createdAt: "2026-06-01T00:00:00.000Z",
      request: {
        model: "gpt-image-2",
        prompt: "生成一张图片",
      },
      result: {
        created: 123,
        size: "1024x1024",
        quality: "high",
        output_format: "webp",
        usage: { total_tokens: 3, input_tokens: 1, output_tokens: 2 },
      },
    });
    expect(metadata.files).toHaveLength(2);
    expect(metadata.files[0]).toMatchObject({ index: 0, format: "webp", bytes: 7 });
  });

  it("输出目录路径是文件时拒绝写入", async () => {
    const dir = createTempDir();
    const filePath = join(dir, "not-dir");
    rmSync(filePath, { force: true });
    await import("node:fs").then(({ writeFileSync }) => writeFileSync(filePath, "x"));

    await expect(
      saveImageResult(
        {
          created: 123,
          images: [{ b64_json: Buffer.from("image").toString("base64") }],
        },
        { outDir: filePath },
      ),
    ).rejects.toThrow("Output path is not a directory");
    expect(existsSync(filePath)).toBe(true);
    expect(statSync(filePath).isFile()).toBe(true);
  });

  it("使用安全下载配置保存 URL 图片", async () => {
    const outDir = createTempDir();
    const fetchMock: typeof fetch = async () =>
      new Response("url-image", { headers: { "content-type": "image/png" } });

    const result = await saveImageResult(
      {
        created: 123,
        images: [{ url: "http://127.0.0.1/image.png" }],
        output_format: "png",
      },
      {
        outDir,
        baseName: "url-sample",
        download: {
          fetch: fetchMock,
          allowHttp: true,
          allowPrivateNetwork: true,
        },
      },
    );

    expect(readFileSync(result.files[0], "utf8")).toBe("url-image");
  });

  it("固定相同时间的自动基础名仍生成不同路径", async () => {
    const outDir = createTempDir();
    const imageResult = {
      created: 123,
      images: [{ b64_json: Buffer.from("image").toString("base64") }],
      output_format: "png" as const,
    };
    const options = {
      outDir,
      createdAt: new Date("2026-06-01T00:00:00.000Z"),
    };

    const [first, second] = await Promise.all([
      saveImageResult(imageResult, options),
      saveImageResult(imageResult, options),
    ]);

    expect(first.files[0]).toMatch(/2026-06-01T00-00-00-000Z-[0-9a-f]{6}-0\.png$/);
    expect(second.files[0]).toMatch(/2026-06-01T00-00-00-000Z-[0-9a-f]{6}-0\.png$/);
    expect(first.files[0]).not.toBe(second.files[0]);
    expect(first.metadataPath).not.toBe(second.metadataPath);
  });

  it("显式基础名默认拒绝覆盖已有输出", async () => {
    const outDir = createTempDir();
    const imageResult = {
      created: 123,
      images: [{ b64_json: Buffer.from("first").toString("base64") }],
    };

    await saveImageResult(imageResult, { outDir, baseName: "sample" });

    await expect(saveImageResult(imageResult, { outDir, baseName: "sample" })).rejects.toThrow(
      "Output file already exists",
    );
    expect(readFileSync(join(outDir, "sample-0.png"), "utf8")).toBe("first");
  });

  it("overwrite 为 true 时允许覆盖显式基础名输出", async () => {
    const outDir = createTempDir();

    await saveImageResult(
      {
        created: 123,
        images: [{ b64_json: Buffer.from("first").toString("base64") }],
      },
      { outDir, baseName: "sample" },
    );
    await saveImageResult(
      {
        created: 456,
        images: [{ b64_json: Buffer.from("second").toString("base64") }],
      },
      { outDir, baseName: "sample", overwrite: true },
    );

    expect(readFileSync(join(outDir, "sample-0.png"), "utf8")).toBe("second");
    expect(JSON.parse(readFileSync(join(outDir, "sample.json"), "utf8")).result.created).toBe(456);
  });

  it("多图片结果共享同一个随机基础名", async () => {
    const outDir = createTempDir();
    const result = await saveImageResult(
      {
        created: 123,
        images: [
          { b64_json: Buffer.from("image-0").toString("base64") },
          { b64_json: Buffer.from("image-1").toString("base64") },
        ],
      },
      { outDir, createdAt: new Date("2026-06-01T00:00:00.000Z") },
    );

    const baseName = result.metadataPath.replace(/\.json$/, "");
    expect(result.files).toEqual([`${baseName}-0.png`, `${baseName}-1.png`]);
  });
});
