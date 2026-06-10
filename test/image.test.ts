import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_IMAGE_MODEL,
  GPT_IMAGE_2_UNIQUE_SIZES,
  createImageClient,
  editImage,
  generateImage,
  getImageModelPresetSizes,
  type GenerateImageOptions,
  type ImageClientOptions,
} from "../src/lib/image.js";

const originalCwd = process.cwd();
const originalEnv = {
  IMAGEMON_API_KEY: process.env.IMAGEMON_API_KEY,
  IMAGEMON_API_BASE_URL: process.env.IMAGEMON_API_BASE_URL,
  IMAGEMON_API_CONFIG_FILE: process.env.IMAGEMON_API_CONFIG_FILE,
  IMAGEMON_API_TIMEOUT_MS: process.env.IMAGEMON_API_TIMEOUT_MS,
  IMAGEMON_API_MAX_RETRIES: process.env.IMAGEMON_API_MAX_RETRIES,
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
  const dir = mkdtempSync(join(tmpdir(), "image-test-"));
  tempDirs.push(dir);
  return dir;
}

function writeConfig(dir: string, content: unknown, fileName = "imagemon.config.json"): string {
  const path = join(dir, fileName);
  writeFileSync(path, typeof content === "string" ? content : JSON.stringify(content));
  return path;
}

function getHeader(headers: HeadersInit | undefined, name: string): string | null {
  return new Headers(headers).get(name);
}

function getClientTimeout(client: unknown): number {
  return (client as { timeout: number }).timeout;
}

function getClientMaxRetries(client: unknown): number {
  return (client as { maxRetries: number }).maxRetries;
}

function clientOptions(fetchMock: typeof fetch): ImageClientOptions {
  return {
    apiKey: "test-key",
    baseURL: "https://third-party.example/v1",
    fetch: fetchMock,
    maxRetries: 0,
  };
}

beforeEach(() => {
  for (const name of Object.keys(originalEnv) as Array<keyof typeof originalEnv>) {
    delete process.env[name];
  }
  process.chdir(originalCwd);
});

afterEach(() => {
  process.chdir(originalCwd);
  for (const [name, value] of Object.entries(originalEnv) as Array<[keyof typeof originalEnv, string | undefined]>) {
    restoreEnv(name, value);
  }

  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

function restoreEnv(name: keyof typeof originalEnv, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

describe("generateImage", () => {
  it("按模型返回推荐预设尺寸", () => {
    const commonSizes = ["auto", "1024x1024", "1536x1024", "1024x1536"];

    expect(getImageModelPresetSizes()).toEqual([...commonSizes, ...GPT_IMAGE_2_UNIQUE_SIZES]);
    expect(getImageModelPresetSizes("gpt-image-2")).toEqual([...commonSizes, ...GPT_IMAGE_2_UNIQUE_SIZES]);
    expect(getImageModelPresetSizes("gpt-image-2-2026-04-21")).toEqual([
      ...commonSizes,
      ...GPT_IMAGE_2_UNIQUE_SIZES,
    ]);
    expect(getImageModelPresetSizes("gpt-image-3")).toEqual(commonSizes);
    expect(getImageModelPresetSizes("compatible-image-model")).toBeUndefined();
  });

  it("默认使用 gpt-image-2 并请求兼容平台的 images/generations 路径", async () => {
    const { fetchMock, requests } = createJsonFetchRecorder();

    const result = await generateImage(
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
      model: DEFAULT_IMAGE_MODEL,
      prompt: "生成一张图片",
      size: "1536x1024",
      quality: "high",
    });
  });

  it("支持为生成请求指定 GPT Image 系列模型", async () => {
    const { fetchMock, requests } = createJsonFetchRecorder();

    await generateImage(
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

    const options: GenerateImageOptions = {
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

    const result = await generateImage(options, clientOptions(fetchMock));

    expect(result).toMatchObject({
      created: 456,
      images: [{ b64_json: "def" }],
      size: "1024x1024",
      quality: "medium",
      output_format: "webp",
      background: "opaque",
    });
    expect(requests[0]?.body).toEqual({ ...options, model: DEFAULT_IMAGE_MODEL });
    expect(requests[0]?.body).not.toHaveProperty("response_format");
    expect(requests[0]?.body).not.toHaveProperty("style");
  });

  it("拒绝非法参数", async () => {
    const { fetchMock } = createJsonFetchRecorder();
    const opts = clientOptions(fetchMock);

    await expect(generateImage({ prompt: " " }, opts)).rejects.toThrow("prompt is required");
    await expect(generateImage({ prompt: "x", n: 0 }, opts)).rejects.toThrow("n must be");
    await expect(generateImage({ prompt: "x", partial_images: 4 }, opts)).rejects.toThrow("partial_images");
    await expect(generateImage({ prompt: "x", output_compression: 101 }, opts)).rejects.toThrow(
      "output_compression",
    );
    await expect(generateImage({ prompt: "x", background: "transparent" }, opts)).rejects.toThrow(
      "transparent background",
    );
    await expect(
      generateImage({ model: "gpt-image-1.5", prompt: "x", background: "transparent", output_format: "jpeg" }, opts),
    ).rejects.toThrow("transparent background requires");
    await expect(generateImage({ prompt: "x", size: "1001x1024" }, opts)).rejects.toThrow("divisible by 16");
    await expect(generateImage({ prompt: "x", size: "3088x1024" }, opts)).rejects.toThrow("aspect ratio");
    await expect(generateImage({ prompt: "x", size: "3856x1024" }, opts)).rejects.toThrow("3840px");
    await expect(generateImage({ prompt: "x", size: "800x800" }, opts)).rejects.toThrow("total pixels");
    await expect(generateImage({ prompt: "x", size: "3840x3840" }, opts)).rejects.toThrow("total pixels");
    await expect(generateImage({ model: "gpt-image-1", prompt: "x", size: "2048x2048" }, opts)).rejects.toThrow(
      "does not support custom size",
    );
  });

  it("未知模型不会因本地能力表缺失而拒绝模型能力参数", async () => {
    const { fetchMock, requests } = createJsonFetchRecorder();
    const options = {
      model: "compatible-image-model",
      prompt: "生成一张图片",
      background: "transparent" as const,
      output_format: "png" as const,
      size: "vendor-size",
    };

    await generateImage(options, clientOptions(fetchMock));

    expect(requests[0]?.body).toEqual(options);
  });

  it("支持自定义尺寸的已知模型允许使用 gpt-image-2 便捷预设", async () => {
    const { fetchMock, requests } = createJsonFetchRecorder();

    await generateImage(
      {
        model: "gpt-image-3",
        prompt: "生成一张图片",
        size: "3840x2160",
      },
      clientOptions(fetchMock),
    );

    expect(requests[0]?.body).toMatchObject({
      model: "gpt-image-3",
      size: "3840x2160",
    });
  });

  it("gpt-image-2 允许并透传全部便捷预设", async () => {
    for (const size of GPT_IMAGE_2_UNIQUE_SIZES) {
      const { fetchMock, requests } = createJsonFetchRecorder();

      await generateImage({ prompt: "生成一张图片", size }, clientOptions(fetchMock));

      expect(requests[0]?.body).toMatchObject({
        model: DEFAULT_IMAGE_MODEL,
        size,
      });
    }
  });

  it("默认读取当前工作目录的 imagemon.config.json", async () => {
    const dir = createTempDir();
    writeConfig(dir, {
      apiKey: "file-key",
      baseURL: "https://file.example/v1",
      timeout: 45_000,
      maxRetries: 3,
    });
    process.chdir(dir);
    const { fetchMock, requests } = createJsonFetchRecorder();

    await generateImage({ prompt: "生成一张图片" }, { fetch: fetchMock, maxRetries: 0 });

    expect(requests[0]?.url).toBe("https://file.example/v1/images/generations");
    expect(getHeader(requests[0]?.init.headers, "authorization")).toBe("Bearer file-key");
    expect(getClientTimeout(createImageClient({ fetch: fetchMock, maxRetries: 0 }))).toBe(45_000);
    expect(getClientMaxRetries(createImageClient({ fetch: fetchMock }))).toBe(3);
  });

  it("支持通过 clientOptions.configPath 指定配置文件路径", async () => {
    const dir = createTempDir();
    const configPath = writeConfig(dir, {
      apiKey: "path-key",
      baseURL: "https://path.example/v1",
    });
    const { fetchMock, requests } = createJsonFetchRecorder();

    await generateImage({ prompt: "生成一张图片" }, { configPath, fetch: fetchMock, maxRetries: 0 });

    expect(requests[0]?.url).toBe("https://path.example/v1/images/generations");
    expect(getHeader(requests[0]?.init.headers, "authorization")).toBe("Bearer path-key");
  });

  it("支持通过 IMAGEMON_API_CONFIG_FILE 指定配置文件路径", async () => {
    const dir = createTempDir();
    process.env.IMAGEMON_API_CONFIG_FILE = writeConfig(dir, {
      apiKey: "env-file-key",
      baseURL: "https://env-file.example/v1",
    });
    const { fetchMock, requests } = createJsonFetchRecorder();

    await generateImage({ prompt: "生成一张图片" }, { fetch: fetchMock, maxRetries: 0 });

    expect(requests[0]?.url).toBe("https://env-file.example/v1/images/generations");
    expect(getHeader(requests[0]?.init.headers, "authorization")).toBe("Bearer env-file-key");
  });

  it("配置优先级为参数大于配置文件大于环境变量", async () => {
    process.env.IMAGEMON_API_KEY = "env-key";
    process.env.IMAGEMON_API_BASE_URL = "https://env.example/v1";
    process.env.IMAGEMON_API_TIMEOUT_MS = "1000";
    process.env.IMAGEMON_API_MAX_RETRIES = "1";
    const dir = createTempDir();
    const configPath = writeConfig(dir, {
      apiKey: "file-key",
      baseURL: "https://file.example/v1",
      timeout: 45_000,
      maxRetries: 2,
    });
    const fileRecorder = createJsonFetchRecorder();

    await generateImage({ prompt: "生成一张图片" }, { configPath, fetch: fileRecorder.fetchMock, maxRetries: 0 });

    expect(fileRecorder.requests[0]?.url).toBe("https://file.example/v1/images/generations");
    expect(getHeader(fileRecorder.requests[0]?.init.headers, "authorization")).toBe("Bearer file-key");
    expect(getClientTimeout(createImageClient({ configPath, fetch: fileRecorder.fetchMock, maxRetries: 0 }))).toBe(
      45_000,
    );
    expect(getClientMaxRetries(createImageClient({ configPath, fetch: fileRecorder.fetchMock }))).toBe(2);

    const optionRecorder = createJsonFetchRecorder();
    await generateImage(
      { prompt: "生成一张图片" },
      {
        apiKey: "option-key",
        baseURL: "https://option.example/v1",
        timeout: 90_000,
        configPath,
        fetch: optionRecorder.fetchMock,
        maxRetries: 0,
      },
    );

    expect(optionRecorder.requests[0]?.url).toBe("https://option.example/v1/images/generations");
    expect(getHeader(optionRecorder.requests[0]?.init.headers, "authorization")).toBe("Bearer option-key");
    expect(
      getClientTimeout(
        createImageClient({
          apiKey: "option-key",
          baseURL: "https://option.example/v1",
          timeout: 90_000,
          configPath,
          fetch: optionRecorder.fetchMock,
          maxRetries: 0,
        }),
      ),
    ).toBe(90_000);
    expect(
      getClientMaxRetries(
        createImageClient({
          apiKey: "option-key",
          configPath,
          fetch: optionRecorder.fetchMock,
          maxRetries: 4,
        }),
      ),
    ).toBe(4);
  });

  it("配置文件未提供 maxRetries 时读取环境变量", () => {
    process.env.IMAGEMON_API_KEY = "env-key";
    process.env.IMAGEMON_API_MAX_RETRIES = "5";

    expect(getClientMaxRetries(createImageClient())).toBe(5);
  });

  it("默认配置文件不存在时仍支持环境变量", async () => {
    const dir = createTempDir();
    process.chdir(dir);
    process.env.IMAGEMON_API_KEY = "env-key";
    process.env.IMAGEMON_API_BASE_URL = "https://env.example/v1";
    const { fetchMock, requests } = createJsonFetchRecorder();

    await generateImage({ prompt: "生成一张图片" }, { fetch: fetchMock, maxRetries: 0 });

    expect(requests[0]?.url).toBe("https://env.example/v1/images/generations");
    expect(getHeader(requests[0]?.init.headers, "authorization")).toBe("Bearer env-key");
  });

  it("不读取旧默认配置文件和旧环境变量", async () => {
    const dir = createTempDir();
    writeConfig(
      dir,
      {
        apiKey: "old-file-key",
        baseURL: "https://old-file.example/v1",
      },
      "gpt-image.config.json",
    );
    process.chdir(dir);
    process.env.IMAGE_API_KEY = "old-env-key";
    process.env.IMAGE_API_BASE_URL = "https://old-env.example/v1";
    const { fetchMock, requests } = createJsonFetchRecorder();

    await expect(generateImage({ prompt: "生成一张图片" }, { fetch: fetchMock, maxRetries: 0 })).rejects.toThrow(
      "IMAGEMON_API_KEY",
    );

    expect(requests).toHaveLength(0);
    delete process.env.IMAGE_API_KEY;
    delete process.env.IMAGE_API_BASE_URL;
  });

  it("拒绝非法配置文件内容", async () => {
    const dir = createTempDir();
    const invalidJsonPath = writeConfig(dir, "{");
    const nonStringApiKeyPath = writeConfig(dir, { apiKey: 123 }, "non-string-api-key.json");
    const nonStringBaseUrlPath = writeConfig(dir, { baseURL: 123 }, "non-string-base-url.json");
    const nonNumberTimeoutPath = writeConfig(dir, { timeout: "60000" }, "non-number-timeout.json");
    const decimalTimeoutPath = writeConfig(dir, { timeout: 1.5 }, "decimal-timeout.json");
    const negativeTimeoutPath = writeConfig(dir, { timeout: -1 }, "negative-timeout.json");
    const nonNumberMaxRetriesPath = writeConfig(dir, { maxRetries: "2" }, "non-number-max-retries.json");
    const decimalMaxRetriesPath = writeConfig(dir, { maxRetries: 1.5 }, "decimal-max-retries.json");
    const negativeMaxRetriesPath = writeConfig(dir, { maxRetries: -1 }, "negative-max-retries.json");
    const emptyBaseUrlPath = writeConfig(dir, { apiKey: "file-key", baseURL: " " }, "empty-base-url.json");
    const endpointBaseUrlPath = writeConfig(
      dir,
      { apiKey: "file-key", baseURL: "https://file.example/v1/images/generations" },
      "endpoint-base-url.json",
    );
    const { fetchMock } = createJsonFetchRecorder();

    await expect(
      generateImage({ prompt: "生成一张图片" }, { configPath: invalidJsonPath, fetch: fetchMock }),
    ).rejects.toThrow("valid JSON");
    await expect(
      generateImage({ prompt: "生成一张图片" }, { configPath: nonStringApiKeyPath, fetch: fetchMock }),
    ).rejects.toThrow("apiKey must be a string");
    await expect(
      generateImage({ prompt: "生成一张图片" }, { configPath: nonStringBaseUrlPath, fetch: fetchMock }),
    ).rejects.toThrow("baseURL must be a string");
    await expect(
      generateImage({ prompt: "生成一张图片" }, { configPath: nonNumberTimeoutPath, fetch: fetchMock }),
    ).rejects.toThrow("timeout must be a number");
    await expect(
      generateImage({ prompt: "生成一张图片" }, { configPath: decimalTimeoutPath, fetch: fetchMock }),
    ).rejects.toThrow("timeout must be a non-negative integer");
    await expect(
      generateImage({ prompt: "生成一张图片" }, { configPath: negativeTimeoutPath, fetch: fetchMock }),
    ).rejects.toThrow("timeout must be a non-negative integer");
    await expect(
      generateImage({ prompt: "生成一张图片" }, { configPath: nonNumberMaxRetriesPath, fetch: fetchMock }),
    ).rejects.toThrow("maxRetries must be a number");
    await expect(
      generateImage({ prompt: "生成一张图片" }, { configPath: decimalMaxRetriesPath, fetch: fetchMock }),
    ).rejects.toThrow("maxRetries must be a non-negative integer");
    await expect(
      generateImage({ prompt: "生成一张图片" }, { configPath: negativeMaxRetriesPath, fetch: fetchMock }),
    ).rejects.toThrow("maxRetries must be a non-negative integer");
    await expect(
      generateImage({ prompt: "生成一张图片" }, { configPath: emptyBaseUrlPath, fetch: fetchMock }),
    ).rejects.toThrow("IMAGEMON_API_BASE_URL cannot be empty");
    await expect(
      generateImage({ prompt: "生成一张图片" }, { configPath: endpointBaseUrlPath, fetch: fetchMock }),
    ).rejects.toThrow("must end at the API version prefix");
  });
});

describe("editImage", () => {
  it("gpt-image-2 编辑请求允许并透传全部便捷预设", async () => {
    for (const size of GPT_IMAGE_2_UNIQUE_SIZES) {
      const { fetchMock, requests } = createJsonFetchRecorder();
      const image = new File(["fake"], "input.png", { type: "image/png" });

      await editImage(
        {
          image,
          prompt: "编辑图片",
          size,
        },
        clientOptions(fetchMock),
      );

      const formData = requests[0]?.init.body as FormData;
      expect(formData.get("size")).toBe(size);
    }
  });

  it("默认使用 gpt-image-2 并请求兼容平台的 images/edits 路径", async () => {
    const { fetchMock, requests } = createJsonFetchRecorder();
    const image = new File(["fake"], "input.png", { type: "image/png" });
    const mask = new File(["fake"], "mask.png", { type: "image/png" });

    const result = await editImage(
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
    expect(formData.get("model")).toBe(DEFAULT_IMAGE_MODEL);
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

    await editImage(
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

    await expect(editImage({ image: [], prompt: "编辑图片" }, clientOptions(fetchMock))).rejects.toThrow(
      "image must contain at least one input image",
    );
  });

  it("支持已知模型的透明背景和 input_fidelity", async () => {
    const { fetchMock, requests } = createJsonFetchRecorder();
    const image = new File(["fake"], "input.png", { type: "image/png" });

    await editImage(
      {
        model: "gpt-image-1.5",
        image,
        prompt: "编辑图片",
        background: "transparent",
        output_format: "webp",
        input_fidelity: "high",
      },
      clientOptions(fetchMock),
    );

    const formData = requests[0]?.init.body as FormData;
    expect(formData.get("background")).toBe("transparent");
    expect(formData.get("input_fidelity")).toBe("high");
  });

  it("已知模型在请求前拒绝不支持的 input_fidelity", async () => {
    const { fetchMock, requests } = createJsonFetchRecorder();
    const image = new File(["fake"], "input.png", { type: "image/png" });

    await expect(
      editImage(
        {
          model: "gpt-image-1-mini",
          image,
          prompt: "编辑图片",
          input_fidelity: "high",
        },
        clientOptions(fetchMock),
      ),
    ).rejects.toThrow("input_fidelity");
    expect(requests).toHaveLength(0);
  });

  it("未知模型透传 input_fidelity", async () => {
    const { fetchMock, requests } = createJsonFetchRecorder();
    const image = new File(["fake"], "input.png", { type: "image/png" });

    await editImage(
      {
        model: "compatible-image-model",
        image,
        prompt: "编辑图片",
        input_fidelity: "high",
      },
      clientOptions(fetchMock),
    );

    const formData = requests[0]?.init.body as FormData;
    expect(formData.get("input_fidelity")).toBe("high");
  });
});
