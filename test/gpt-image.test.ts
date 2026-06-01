import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  editGptImage,
  generateGptImage,
  type GenerateGptImageOptions,
  type GptImageClientOptions,
} from "../src/lib/gpt-image.js";

const originalCwd = process.cwd();
const originalEnv = {
  IMAGE_API_KEY: process.env.IMAGE_API_KEY,
  IMAGE_API_BASE_URL: process.env.IMAGE_API_BASE_URL,
  IMAGE_API_CONFIG_FILE: process.env.IMAGE_API_CONFIG_FILE,
};
let tempDirs: string[] = [];

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

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "gpt-image-test-"));
  tempDirs.push(dir);
  return dir;
}

function writeConfig(dir: string, content: unknown, fileName = "gpt-image.config.json"): string {
  const path = join(dir, fileName);
  writeFileSync(path, typeof content === "string" ? content : JSON.stringify(content));
  return path;
}

function getHeader(headers: HeadersInit | undefined, name: string): string | null {
  return new Headers(headers).get(name);
}

function clientOptions(fetchMock: typeof fetch): GptImageClientOptions {
  return {
    apiKey: "test-key",
    baseURL: "https://third-party.example/v1",
    fetch: fetchMock,
    maxRetries: 0,
  };
}

beforeEach(() => {
  delete process.env.IMAGE_API_KEY;
  delete process.env.IMAGE_API_BASE_URL;
  delete process.env.IMAGE_API_CONFIG_FILE;
  process.chdir(originalCwd);
});

afterEach(() => {
  process.chdir(originalCwd);
  restoreEnv("IMAGE_API_KEY", originalEnv.IMAGE_API_KEY);
  restoreEnv("IMAGE_API_BASE_URL", originalEnv.IMAGE_API_BASE_URL);
  restoreEnv("IMAGE_API_CONFIG_FILE", originalEnv.IMAGE_API_CONFIG_FILE);

  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

function restoreEnv(name: "IMAGE_API_KEY" | "IMAGE_API_BASE_URL" | "IMAGE_API_CONFIG_FILE", value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

describe("generateGptImage", () => {
  it("默认使用 gpt-image-2 并请求兼容平台的 images/generations 路径", async () => {
    const { fetchMock, requests } = createJsonFetchRecorder();

    const result = await generateGptImage(
      {
        prompt: "生成一张图片",
        size: "1536x1024",
        quality: "high",
      },
      clientOptions(fetchMock),
    );

    expect(result.images).toEqual([{ b64_json: "abc" }]);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://third-party.example/v1/images/generations");
    expect(requests[0]?.body).toMatchObject({
      model: "gpt-image-2",
      prompt: "生成一张图片",
      size: "1536x1024",
      quality: "high",
    });
  });

  it("支持为生成请求指定 GPT Image 系列模型", async () => {
    const { fetchMock, requests } = createJsonFetchRecorder();

    await generateGptImage(
      {
        model: "gpt-image-3",
        prompt: "生成一张图片",
      },
      clientOptions(fetchMock),
    );

    expect(requests[0]?.body).toMatchObject({
      model: "gpt-image-3",
      prompt: "生成一张图片",
    });
  });

  it("透传所有生成配置字段且不暴露 response_format/style", async () => {
    const { fetchMock, requests } = createJsonFetchRecorder({
      created: 456,
      data: [{ b64_json: "def" }],
      usage: { total_tokens: 1, input_tokens: 1, output_tokens: 0 },
      size: "1024x1024",
      quality: "medium",
      output_format: "webp",
      background: "opaque",
    });

    const options: GenerateGptImageOptions = {
      prompt: "生成一张图片",
      size: "1024x1024",
      quality: "medium",
      n: 2,
      output_format: "webp",
      output_compression: 80,
      background: "opaque",
      moderation: "low",
      partial_images: 0,
      user: "user-1",
    };

    const result = await generateGptImage(options, clientOptions(fetchMock));

    expect(result).toMatchObject({
      created: 456,
      images: [{ b64_json: "def" }],
      size: "1024x1024",
      quality: "medium",
      output_format: "webp",
      background: "opaque",
    });
    expect(requests[0]?.body).toEqual({ ...options, model: "gpt-image-2" });
    expect(requests[0]?.body).not.toHaveProperty("response_format");
    expect(requests[0]?.body).not.toHaveProperty("style");
  });

  it("拒绝非法参数", async () => {
    const { fetchMock } = createJsonFetchRecorder();
    const opts = clientOptions(fetchMock);

    await expect(generateGptImage({ prompt: " " }, opts)).rejects.toThrow("prompt is required");
    await expect(generateGptImage({ prompt: "x", n: 0 }, opts)).rejects.toThrow("n must be");
    await expect(generateGptImage({ prompt: "x", partial_images: 4 }, opts)).rejects.toThrow("partial_images");
    await expect(generateGptImage({ prompt: "x", output_compression: 101 }, opts)).rejects.toThrow(
      "output_compression",
    );
    await expect(generateGptImage({ prompt: "x", background: "transparent" as never }, opts)).rejects.toThrow(
      "background",
    );
    await expect(generateGptImage({ prompt: "x", size: "1001x1024" }, opts)).rejects.toThrow("divisible by 16");
    await expect(generateGptImage({ prompt: "x", size: "3088x1024" }, opts)).rejects.toThrow("aspect ratio");
    await expect(generateGptImage({ prompt: "x", size: "3856x1024" }, opts)).rejects.toThrow("3840px");
    await expect(generateGptImage({ prompt: "x", size: "800x800" }, opts)).rejects.toThrow("total pixels");
    await expect(generateGptImage({ prompt: "x", size: "3840x3840" }, opts)).rejects.toThrow("total pixels");
  });

  it("默认读取当前工作目录的 gpt-image.config.json", async () => {
    const dir = createTempDir();
    writeConfig(dir, {
      apiKey: "file-key",
      baseURL: "https://file.example/v1",
    });
    process.chdir(dir);
    const { fetchMock, requests } = createJsonFetchRecorder();

    await generateGptImage({ prompt: "生成一张图片" }, { fetch: fetchMock, maxRetries: 0 });

    expect(requests[0]?.url).toBe("https://file.example/v1/images/generations");
    expect(getHeader(requests[0]?.init.headers, "authorization")).toBe("Bearer file-key");
  });

  it("支持通过 clientOptions.configPath 指定配置文件路径", async () => {
    const dir = createTempDir();
    const configPath = writeConfig(dir, {
      apiKey: "path-key",
      baseURL: "https://path.example/v1",
    });
    const { fetchMock, requests } = createJsonFetchRecorder();

    await generateGptImage({ prompt: "生成一张图片" }, { configPath, fetch: fetchMock, maxRetries: 0 });

    expect(requests[0]?.url).toBe("https://path.example/v1/images/generations");
    expect(getHeader(requests[0]?.init.headers, "authorization")).toBe("Bearer path-key");
  });

  it("支持通过 IMAGE_API_CONFIG_FILE 指定配置文件路径", async () => {
    const dir = createTempDir();
    process.env.IMAGE_API_CONFIG_FILE = writeConfig(dir, {
      apiKey: "env-file-key",
      baseURL: "https://env-file.example/v1",
    });
    const { fetchMock, requests } = createJsonFetchRecorder();

    await generateGptImage({ prompt: "生成一张图片" }, { fetch: fetchMock, maxRetries: 0 });

    expect(requests[0]?.url).toBe("https://env-file.example/v1/images/generations");
    expect(getHeader(requests[0]?.init.headers, "authorization")).toBe("Bearer env-file-key");
  });

  it("配置优先级为参数大于配置文件大于环境变量", async () => {
    process.env.IMAGE_API_KEY = "env-key";
    process.env.IMAGE_API_BASE_URL = "https://env.example/v1";
    const dir = createTempDir();
    const configPath = writeConfig(dir, {
      apiKey: "file-key",
      baseURL: "https://file.example/v1",
    });
    const fileRecorder = createJsonFetchRecorder();

    await generateGptImage({ prompt: "生成一张图片" }, { configPath, fetch: fileRecorder.fetchMock, maxRetries: 0 });

    expect(fileRecorder.requests[0]?.url).toBe("https://file.example/v1/images/generations");
    expect(getHeader(fileRecorder.requests[0]?.init.headers, "authorization")).toBe("Bearer file-key");

    const optionRecorder = createJsonFetchRecorder();
    await generateGptImage(
      { prompt: "生成一张图片" },
      {
        apiKey: "option-key",
        baseURL: "https://option.example/v1",
        configPath,
        fetch: optionRecorder.fetchMock,
        maxRetries: 0,
      },
    );

    expect(optionRecorder.requests[0]?.url).toBe("https://option.example/v1/images/generations");
    expect(getHeader(optionRecorder.requests[0]?.init.headers, "authorization")).toBe("Bearer option-key");
  });

  it("默认配置文件不存在时仍支持环境变量", async () => {
    const dir = createTempDir();
    process.chdir(dir);
    process.env.IMAGE_API_KEY = "env-key";
    process.env.IMAGE_API_BASE_URL = "https://env.example/v1";
    const { fetchMock, requests } = createJsonFetchRecorder();

    await generateGptImage({ prompt: "生成一张图片" }, { fetch: fetchMock, maxRetries: 0 });

    expect(requests[0]?.url).toBe("https://env.example/v1/images/generations");
    expect(getHeader(requests[0]?.init.headers, "authorization")).toBe("Bearer env-key");
  });

  it("拒绝非法配置文件内容", async () => {
    const dir = createTempDir();
    const invalidJsonPath = writeConfig(dir, "{");
    const nonStringApiKeyPath = writeConfig(dir, { apiKey: 123 }, "non-string-api-key.json");
    const nonStringBaseUrlPath = writeConfig(dir, { baseURL: 123 }, "non-string-base-url.json");
    const emptyBaseUrlPath = writeConfig(dir, { apiKey: "file-key", baseURL: " " }, "empty-base-url.json");
    const endpointBaseUrlPath = writeConfig(
      dir,
      { apiKey: "file-key", baseURL: "https://file.example/v1/images/generations" },
      "endpoint-base-url.json",
    );
    const { fetchMock } = createJsonFetchRecorder();

    await expect(
      generateGptImage({ prompt: "生成一张图片" }, { configPath: invalidJsonPath, fetch: fetchMock }),
    ).rejects.toThrow("valid JSON");
    await expect(
      generateGptImage({ prompt: "生成一张图片" }, { configPath: nonStringApiKeyPath, fetch: fetchMock }),
    ).rejects.toThrow("apiKey must be a string");
    await expect(
      generateGptImage({ prompt: "生成一张图片" }, { configPath: nonStringBaseUrlPath, fetch: fetchMock }),
    ).rejects.toThrow("baseURL must be a string");
    await expect(
      generateGptImage({ prompt: "生成一张图片" }, { configPath: emptyBaseUrlPath, fetch: fetchMock }),
    ).rejects.toThrow("IMAGE_API_BASE_URL cannot be empty");
    await expect(
      generateGptImage({ prompt: "生成一张图片" }, { configPath: endpointBaseUrlPath, fetch: fetchMock }),
    ).rejects.toThrow("must end at the API version prefix");
  });
});

describe("editGptImage", () => {
  it("默认使用 gpt-image-2 并请求兼容平台的 images/edits 路径", async () => {
    const { fetchMock, requests } = createJsonFetchRecorder();
    const image = new File(["fake"], "input.png", { type: "image/png" });
    const mask = new File(["fake"], "mask.png", { type: "image/png" });

    const result = await editGptImage(
      {
        image,
        mask,
        prompt: "编辑图片",
        size: "1024x1536",
        quality: "low",
      },
      clientOptions(fetchMock),
    );

    expect(result.images).toEqual([{ b64_json: "abc" }]);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://third-party.example/v1/images/edits");
    expect(requests[0]?.init.body).toBeInstanceOf(FormData);

    const formData = requests[0]?.init.body as FormData;
    expect(formData.get("model")).toBe("gpt-image-2");
    expect(formData.get("prompt")).toBe("编辑图片");
    expect(formData.get("size")).toBe("1024x1536");
    expect(formData.get("quality")).toBe("low");
    expect(formData.has("input_fidelity")).toBe(false);
    expect(formData.get("image")).toBeInstanceOf(File);
    expect(formData.get("mask")).toBeInstanceOf(File);
  });

  it("支持为编辑请求指定 GPT Image 系列模型", async () => {
    const { fetchMock, requests } = createJsonFetchRecorder();
    const image = new File(["fake"], "input.png", { type: "image/png" });

    await editGptImage(
      {
        model: "gpt-image-3",
        image,
        prompt: "编辑图片",
      },
      clientOptions(fetchMock),
    );

    const formData = requests[0]?.init.body as FormData;
    expect(formData.get("model")).toBe("gpt-image-3");
    expect(formData.get("prompt")).toBe("编辑图片");
  });

  it("拒绝空图片数组", async () => {
    const { fetchMock } = createJsonFetchRecorder();

    await expect(editGptImage({ image: [], prompt: "编辑图片" }, clientOptions(fetchMock))).rejects.toThrow(
      "image must contain at least one input image",
    );
  });

  it("拒绝 GPT Image 系列不支持的 input_fidelity", async () => {
    const { fetchMock } = createJsonFetchRecorder();
    const image = new File(["fake"], "input.png", { type: "image/png" });

    await expect(
      editGptImage(
        {
          image,
          prompt: "编辑图片",
          input_fidelity: "high",
        } as never,
        clientOptions(fetchMock),
      ),
    ).rejects.toThrow("input_fidelity");
  });
});
