import { describe, expect, it, vi } from "vitest";
import { downloadImage } from "../src/lib/image-download.js";

const PUBLIC_URL = "https://8.8.8.8/image.png";

function imageResponse(body: BodyInit = "image", init: ResponseInit = {}): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "image/png" },
    ...init,
  });
}

describe("downloadImage", () => {
  it("下载合法 URL 图片", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => imageResponse("image"));

    const bytes = await downloadImage(PUBLIC_URL, { fetch: fetchMock });

    expect(bytes.toString()).toBe("image");
    expect(fetchMock).toHaveBeenCalledWith(new URL(PUBLIC_URL), {
      redirect: "manual",
      signal: expect.any(AbortSignal),
    });
  });

  it("拒绝非 2xx 响应", async () => {
    const fetchMock: typeof fetch = async () => new Response("missing", { status: 404 });

    await expect(downloadImage(PUBLIC_URL, { fetch: fetchMock })).rejects.toThrow("status 404");
  });

  it("下载错误不包含 URL 查询参数或凭据", async () => {
    const fetchMock: typeof fetch = async () => new Response("failed", { status: 500 });
    const error = await downloadImage("https://8.8.8.8/image.png?token=secret", { fetch: fetchMock }).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain("secret");
    await expect(
      downloadImage("https://user:password@8.8.8.8/image.png", { fetch: fetchMock }),
    ).rejects.toThrow("credentials are not allowed");
  });

  it("拒绝非图片 Content-Type", async () => {
    const fetchMock: typeof fetch = async () =>
      new Response("not image", { headers: { "content-type": "text/plain" } });

    await expect(downloadImage(PUBLIC_URL, { fetch: fetchMock })).rejects.toThrow(
      "Content-Type is not allowed: text/plain",
    );
  });

  it("根据 Content-Length 拒绝超限响应", async () => {
    const fetchMock: typeof fetch = async () =>
      imageResponse("image", { headers: { "content-type": "image/png", "content-length": "6" } });

    await expect(downloadImage(PUBLIC_URL, { fetch: fetchMock, maxBytes: 5 })).rejects.toThrow(
      "exceeds maximum size of 5 bytes",
    );
  });

  it("流式读取时拒绝超限响应", async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.enqueue(new Uint8Array([4, 5, 6]));
        controller.close();
      },
    });
    const fetchMock: typeof fetch = async () => imageResponse(body);

    await expect(downloadImage(PUBLIC_URL, { fetch: fetchMock, maxBytes: 5 })).rejects.toThrow(
      "exceeds maximum size of 5 bytes",
    );
  });

  it("下载超时时失败", async () => {
    const fetchMock: typeof fetch = async () => new Promise<Response>(() => undefined);

    await expect(downloadImage(PUBLIC_URL, { fetch: fetchMock, timeoutMs: 10 })).rejects.toThrow(
      "timed out after 10ms",
    );
  });

  it.each([
    "http://8.8.8.8/image.png",
    "file:///tmp/image.png",
    "data:image/png;base64,aW1hZ2U=",
    "ftp://8.8.8.8/image.png",
  ])(
    "拒绝非允许协议 %s",
    async (url) => {
      const fetchMock = vi.fn<typeof fetch>();

      await expect(downloadImage(url, { fetch: fetchMock })).rejects.toThrow("protocol is not allowed");
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    "https://127.0.0.1/image.png",
    "https://10.0.0.1/image.png",
    "https://[::1]/image.png",
    "https://[::ffff:7f00:1]/image.png",
    "https://[fec0::1]/image.png",
  ])(
    "拒绝环回或私网地址 %s",
    async (url) => {
      const fetchMock = vi.fn<typeof fetch>();

      await expect(downloadImage(url, { fetch: fetchMock })).rejects.toThrow("target is not allowed");
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("拒绝重定向到私网地址", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(null, { status: 302, headers: { location: "https://127.0.0.1/image.png" } }),
    );

    await expect(downloadImage(PUBLIC_URL, { fetch: fetchMock })).rejects.toThrow("target is not allowed");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("显式允许 HTTP 和私网时使用注入 fetch", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => imageResponse("private image"));

    const bytes = await downloadImage("http://127.0.0.1/image.png", {
      fetch: fetchMock,
      allowHttp: true,
      allowPrivateNetwork: true,
    });

    expect(bytes.toString()).toBe("private image");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
