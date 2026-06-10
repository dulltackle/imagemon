import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it, vi } from "vitest";
import { downloadImage, type ImageDownloadLookup } from "../src/lib/image-download.js";

const PUBLIC_URL = "https://8.8.8.8/image.png";

function imageResponse(body: BodyInit = "image", init: ResponseInit = {}): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "image/png" },
    ...init,
  });
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as AddressInfo).port;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

describe("downloadImage", () => {
  it("下载合法 URL 图片", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => imageResponse("image"));

    const bytes = await downloadImage(PUBLIC_URL, { fetch: fetchMock, allowPrivateNetwork: true });

    expect(bytes.toString()).toBe("image");
    expect(fetchMock).toHaveBeenCalledWith(new URL(PUBLIC_URL), {
      redirect: "manual",
      signal: expect.any(AbortSignal),
    });
  });

  it("拒绝非 2xx 响应", async () => {
    const fetchMock: typeof fetch = async () => new Response("missing", { status: 404 });

    await expect(downloadImage(PUBLIC_URL, { fetch: fetchMock, allowPrivateNetwork: true })).rejects.toThrow(
      "status 404",
    );
  });

  it("下载错误不包含 URL 查询参数或凭据", async () => {
    const fetchMock: typeof fetch = async () => new Response("failed", { status: 500 });
    const error = await downloadImage("https://8.8.8.8/image.png?token=secret", {
      fetch: fetchMock,
      allowPrivateNetwork: true,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain("secret");
    await expect(
      downloadImage("https://user:password@8.8.8.8/image.png", { fetch: fetchMock, allowPrivateNetwork: true }),
    ).rejects.toThrow("credentials are not allowed");
  });

  it("拒绝非图片 Content-Type", async () => {
    const fetchMock: typeof fetch = async () =>
      new Response("not image", { headers: { "content-type": "text/plain" } });

    await expect(downloadImage(PUBLIC_URL, { fetch: fetchMock, allowPrivateNetwork: true })).rejects.toThrow(
      "Content-Type is not allowed: text/plain",
    );
  });

  it("根据 Content-Length 拒绝超限响应", async () => {
    const fetchMock: typeof fetch = async () =>
      imageResponse("image", { headers: { "content-type": "image/png", "content-length": "6" } });

    await expect(
      downloadImage(PUBLIC_URL, { fetch: fetchMock, allowPrivateNetwork: true, maxBytes: 5 }),
    ).rejects.toThrow(
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

    await expect(
      downloadImage(PUBLIC_URL, { fetch: fetchMock, allowPrivateNetwork: true, maxBytes: 5 }),
    ).rejects.toThrow(
      "exceeds maximum size of 5 bytes",
    );
  });

  it("下载超时时失败", async () => {
    const fetchMock: typeof fetch = async () => new Promise<Response>(() => undefined);

    await expect(
      downloadImage(PUBLIC_URL, { fetch: fetchMock, allowPrivateNetwork: true, timeoutMs: 10 }),
    ).rejects.toThrow(
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

      await expect(downloadImage(url, { fetch: fetchMock, allowPrivateNetwork: true })).rejects.toThrow(
        "protocol is not allowed",
      );
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
      await expect(downloadImage(url)).rejects.toThrow("target is not allowed");
    },
  );

  it("自定义 fetch 必须显式接管私网安全责任", async () => {
    const fetchMock = vi.fn<typeof fetch>();

    await expect(downloadImage(PUBLIC_URL, { fetch: fetchMock })).rejects.toThrow(
      "Custom image download fetch requires allowPrivateNetwork: true",
    );
    expect(fetchMock).not.toHaveBeenCalled();
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

  it("默认传输只使用一次已校验的 DNS 解析结果并保留原始 Host", async () => {
    let host: string | undefined;
    const server = createServer((request, response) => {
      host = request.headers.host;
      response.writeHead(200, { "content-type": "image/png" });
      response.end("bound image");
    });
    const port = await listen(server);
    const lookupMock = vi.fn<ImageDownloadLookup>(async () => [{ address: "127.0.0.1", family: 4 }]);

    try {
      const bytes = await downloadImage(`http://image.example:${port}/image.png`, {
        allowHttp: true,
        allowPrivateNetwork: true,
        lookup: lookupMock,
      });

      expect(bytes.toString()).toBe("bound image");
      expect(lookupMock).toHaveBeenCalledTimes(1);
      expect(host).toBe(`image.example:${port}`);
    } finally {
      await close(server);
    }
  });

  it("默认传输不会在连接时使用后续 rebinding 解析结果", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "image/png" });
      response.end("first address");
    });
    const port = await listen(server);
    const lookupMock = vi
      .fn<ImageDownloadLookup>()
      .mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }])
      .mockResolvedValueOnce([{ address: "127.0.0.2", family: 4 }]);

    try {
      const bytes = await downloadImage(`http://rebind.example:${port}/image.png`, {
        allowHttp: true,
        allowPrivateNetwork: true,
        lookup: lookupMock,
      });

      expect(bytes.toString()).toBe("first address");
      expect(lookupMock).toHaveBeenCalledTimes(1);
    } finally {
      await close(server);
    }
  });

  it("域名任一解析结果为私网时在请求前失败", async () => {
    const lookupMock = vi.fn<ImageDownloadLookup>(async () => [
      { address: "8.8.8.8", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]);

    await expect(downloadImage("https://mixed.example/image.png", { lookup: lookupMock })).rejects.toThrow(
      "target is not allowed",
    );
    expect(lookupMock).toHaveBeenCalledTimes(1);
  });

  it("每次重定向都重新解析并绑定目标", async () => {
    const server = createServer((request, response) => {
      if (request.url === "/first") {
        response.writeHead(302, { location: "/second" });
        response.end();
        return;
      }
      response.writeHead(200, { "content-type": "image/png" });
      response.end("redirected");
    });
    const port = await listen(server);
    const lookupMock = vi.fn<ImageDownloadLookup>(async () => [{ address: "127.0.0.1", family: 4 }]);

    try {
      const bytes = await downloadImage(`http://redirect.example:${port}/first`, {
        allowHttp: true,
        allowPrivateNetwork: true,
        lookup: lookupMock,
      });

      expect(bytes.toString()).toBe("redirected");
      expect(lookupMock).toHaveBeenCalledTimes(2);
    } finally {
      await close(server);
    }
  });
});
