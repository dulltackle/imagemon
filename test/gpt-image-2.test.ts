import { describe, expect, it } from "vitest";
import {
  editGptImage2,
  generateGptImage2,
  type GenerateGptImage2Options,
  type GptImage2ClientOptions,
} from "../src/lib/gpt-image-2.js";

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

function clientOptions(fetchMock: typeof fetch): GptImage2ClientOptions {
  return {
    apiKey: "test-key",
    baseURL: "https://third-party.example/v1",
    fetch: fetchMock,
    maxRetries: 0,
  };
}

describe("generateGptImage2", () => {
  it("固定使用 gpt-image-2 并请求兼容平台的 images/generations 路径", async () => {
    const { fetchMock, requests } = createJsonFetchRecorder();

    const result = await generateGptImage2(
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

    const options: GenerateGptImage2Options = {
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

    const result = await generateGptImage2(options, clientOptions(fetchMock));

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

    await expect(generateGptImage2({ prompt: " " }, opts)).rejects.toThrow("prompt is required");
    await expect(generateGptImage2({ prompt: "x", n: 0 }, opts)).rejects.toThrow("n must be");
    await expect(generateGptImage2({ prompt: "x", partial_images: 4 }, opts)).rejects.toThrow("partial_images");
    await expect(generateGptImage2({ prompt: "x", output_compression: 101 }, opts)).rejects.toThrow(
      "output_compression",
    );
    await expect(generateGptImage2({ prompt: "x", background: "transparent" as never }, opts)).rejects.toThrow(
      "background",
    );
    await expect(generateGptImage2({ prompt: "x", size: "1001x1024" }, opts)).rejects.toThrow("divisible by 16");
    await expect(generateGptImage2({ prompt: "x", size: "3088x1024" }, opts)).rejects.toThrow("aspect ratio");
    await expect(generateGptImage2({ prompt: "x", size: "3856x1024" }, opts)).rejects.toThrow("3840px");
    await expect(generateGptImage2({ prompt: "x", size: "800x800" }, opts)).rejects.toThrow("total pixels");
    await expect(generateGptImage2({ prompt: "x", size: "3840x3840" }, opts)).rejects.toThrow("total pixels");
  });
});

describe("editGptImage2", () => {
  it("固定使用 gpt-image-2 并请求兼容平台的 images/edits 路径", async () => {
    const { fetchMock, requests } = createJsonFetchRecorder();
    const image = new File(["fake"], "input.png", { type: "image/png" });
    const mask = new File(["fake"], "mask.png", { type: "image/png" });

    const result = await editGptImage2(
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

  it("拒绝空图片数组", async () => {
    const { fetchMock } = createJsonFetchRecorder();

    await expect(
      editGptImage2({ image: [], prompt: "编辑图片" }, clientOptions(fetchMock)),
    ).rejects.toThrow("image must contain at least one input image");
  });

  it("拒绝 gpt-image-2 不支持的 input_fidelity", async () => {
    const { fetchMock } = createJsonFetchRecorder();
    const image = new File(["fake"], "input.png", { type: "image/png" });

    await expect(
      editGptImage2(
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
