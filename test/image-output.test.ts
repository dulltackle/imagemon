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
});
