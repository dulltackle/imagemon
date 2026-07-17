import { describe, expect, it, vi } from "vitest";

import {
  BASE_API_ORIGIN,
  BASE_FIELD_TYPE_ATTACHMENT,
  BASE_MEDIA_PARENT_TYPE,
  DEFAULT_BASE_MEDIA_UPLOAD_TIMEOUT_MS,
  MAX_BASE_MEDIA_UPLOAD_BYTES,
  BaseApiError,
  type BaseApiFormData,
  type BaseApiFetch,
  type BaseApiFetchInit,
  createBaseApiClient,
} from "./base-api-client";

interface RecordedCall {
  url: string;
  init: BaseApiFetchInit;
}

class FakeFormData implements BaseApiFormData {
  readonly fields: Array<{ name: string; value: unknown }> = [];

  append(name: string, value: unknown): void {
    this.fields.push({ name, value });
  }
}

function jsonResponse(status: number, body: unknown) {
  return {
    status,
    async json() {
      return body;
    },
  };
}

function envelope(data: unknown) {
  return { code: 0, msg: "success", data };
}

function recordingFetch(
  responder: (call: RecordedCall) => ReturnType<BaseApiFetch>,
): { fetch: BaseApiFetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetch: BaseApiFetch = async (url, init) => {
    const call = { url, init };
    calls.push(call);
    return responder(call);
  };
  return { fetch, calls };
}

const APP_TOKEN = "bascnApp";

function parseJsonBody(call: RecordedCall): unknown {
  expect(typeof call.init.body).toBe("string");
  return JSON.parse(call.init.body as string);
}

function uploadFile(size = 1024) {
  return {
    uri: "file:///document/image-results/result-1.png",
    name: "result-1.png",
    type: "image/png",
    size,
  };
}

describe("createBaseApiClient", () => {
  it("导出实测确认的附件与素材上传常量", () => {
    expect(BASE_FIELD_TYPE_ATTACHMENT).toBe(17);
    expect(BASE_MEDIA_PARENT_TYPE).toBe("bitable_file");
    expect(MAX_BASE_MEDIA_UPLOAD_BYTES).toBe(20 * 1024 * 1024);
    expect(DEFAULT_BASE_MEDIA_UPLOAD_TIMEOUT_MS).toBe(120_000);
  });

  it("向正确前缀发请求并注入 Bearer 授权头", async () => {
    const { fetch, calls } = recordingFetch(() =>
      Promise.resolve(jsonResponse(200, envelope({ items: [], has_more: false }))),
    );
    const client = createBaseApiClient({ appToken: APP_TOKEN, token: "pt-secret", fetch });

    await client.listTables({ pageSize: 50 });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      `${BASE_API_ORIGIN}/open-apis/bitable/v1/apps/${APP_TOKEN}/tables?page_size=50`,
    );
    expect(calls[0].init.method).toBe("GET");
    expect(calls[0].init.headers.Authorization).toBe("Bearer pt-secret");
  });

  it("解析分页数据表列表", async () => {
    const { fetch } = recordingFetch(() =>
      Promise.resolve(
        jsonResponse(
          200,
          envelope({
            items: [{ table_id: "tbl1", name: "备份" }],
            page_token: "next",
            has_more: true,
          }),
        ),
      ),
    );
    const client = createBaseApiClient({ appToken: APP_TOKEN, token: "pt", fetch });

    const page = await client.listTables();
    expect(page.items).toEqual([{ table_id: "tbl1", name: "备份" }]);
    expect(page.pageToken).toBe("next");
    expect(page.hasMore).toBe(true);
  });

  it("建表返回 table_id 并携带字段定义 body", async () => {
    const { fetch, calls } = recordingFetch(() =>
      Promise.resolve(jsonResponse(200, envelope({ table_id: "tblNew" }))),
    );
    const client = createBaseApiClient({ appToken: APP_TOKEN, token: "pt", fetch });

    const tableId = await client.createTable({
      name: "Imagemon 图鉴备份",
      fields: [{ field_name: "名称", type: 1 }],
    });

    expect(tableId).toBe("tblNew");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers["Content-Type"]).toBe("application/json");
    expect(parseJsonBody(calls[0])).toEqual({
      table: { name: "Imagemon 图鉴备份", fields: [{ field_name: "名称", type: 1 }] },
    });
  });

  it("上传素材固定使用 bitable_file multipart 且不手设 Content-Type", async () => {
    const form = new FakeFormData();
    const { fetch, calls } = recordingFetch(() =>
      Promise.resolve(
        jsonResponse(200, envelope({ file_token: "file-token-1", version: 7 })),
      ),
    );
    const client = createBaseApiClient({
      appToken: APP_TOKEN,
      token: "pt-secret",
      fetch,
      createFormData: () => form,
    });

    await expect(client.uploadMedia(uploadFile())).resolves.toBe("file-token-1");

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      `${BASE_API_ORIGIN}/open-apis/drive/v1/medias/upload_all`,
    );
    expect(calls[0].init).toMatchObject({
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: "Bearer pt-secret",
      },
      body: form,
    });
    expect(calls[0].init.headers).not.toHaveProperty("Content-Type");
    expect(form.fields).toEqual([
      { name: "file_name", value: "result-1.png" },
      { name: "parent_type", value: "bitable_file" },
      { name: "parent_node", value: APP_TOKEN },
      { name: "size", value: "1024" },
      {
        name: "file",
        value: {
          uri: "file:///document/image-results/result-1.png",
          name: "result-1.png",
          type: "image/png",
        },
      },
    ]);
  });

  it("上传素材接受 20 MB 边界并在超限或空文件时不发请求", async () => {
    const { fetch, calls } = recordingFetch(() =>
      Promise.resolve(jsonResponse(200, envelope({ file_token: "file-token" }))),
    );
    const client = createBaseApiClient({
      appToken: APP_TOKEN,
      token: "pt",
      fetch,
      createFormData: () => new FakeFormData(),
    });

    await expect(
      client.uploadMedia(uploadFile(MAX_BASE_MEDIA_UPLOAD_BYTES)),
    ).resolves.toBe("file-token");
    await expect(
      client.uploadMedia(uploadFile(MAX_BASE_MEDIA_UPLOAD_BYTES + 1)),
    ).rejects.toMatchObject({ kind: "api_error" } satisfies Partial<BaseApiError>);
    await expect(client.uploadMedia(uploadFile(0))).rejects.toMatchObject({
      kind: "api_error",
    } satisfies Partial<BaseApiError>);
    expect(calls).toHaveLength(1);
  });

  it("上传响应必须包含非空 file_token", async () => {
    const { fetch } = recordingFetch(() =>
      Promise.resolve(jsonResponse(200, envelope({ version: 1 }))),
    );
    const client = createBaseApiClient({
      appToken: APP_TOKEN,
      token: "pt",
      fetch,
      createFormData: () => new FakeFormData(),
    });

    await expect(client.uploadMedia(uploadFile())).rejects.toMatchObject({
      kind: "invalid_response",
    } satisfies Partial<BaseApiError>);
  });

  it("上传素材使用独立 120 秒超时", async () => {
    vi.useFakeTimers();
    const fetch: BaseApiFetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        });
      });
    const client = createBaseApiClient({
      appToken: APP_TOKEN,
      token: "pt",
      fetch,
      createFormData: () => new FakeFormData(),
    });

    try {
      const pending = client.uploadMedia(uploadFile()).catch((caught) => caught);
      await vi.advanceTimersByTimeAsync(DEFAULT_BASE_MEDIA_UPLOAD_TIMEOUT_MS - 1);
      let settled = false;
      void pending.then(() => {
        settled = true;
      });
      await Promise.resolve();
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      await expect(pending).resolves.toMatchObject({ kind: "timeout" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("外部 AbortSignal 可取消素材上传", async () => {
    const controller = new AbortController();
    const fetch: BaseApiFetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        });
      });
    const client = createBaseApiClient({
      appToken: APP_TOKEN,
      token: "pt",
      fetch,
      createFormData: () => new FakeFormData(),
    });

    const pending = client
      .uploadMedia(uploadFile(), { signal: controller.signal })
      .catch((caught) => caught);
    controller.abort();

    await expect(pending).resolves.toMatchObject({ kind: "cancelled" });
  });

  it("单条 PUT 更新记录并严格读取 data.record", async () => {
    const { fetch, calls } = recordingFetch(() =>
      Promise.resolve(
        jsonResponse(
          200,
          envelope({
            record: {
              record_id: "rec-1",
              fields: { 展示图标识: "image-1", 展示图: [{ file_token: "file-1" }] },
            },
          }),
        ),
      ),
    );
    const client = createBaseApiClient({ appToken: APP_TOKEN, token: "pt", fetch });
    const fields = {
      展示图标识: "image-1",
      展示图: [{ file_token: "file-1" }],
    };

    await expect(client.updateRecord("tbl/1", "rec/1", fields)).resolves.toEqual({
      record_id: "rec-1",
      fields,
    });
    expect(calls[0].url).toBe(
      `${BASE_API_ORIGIN}/open-apis/bitable/v1/apps/${APP_TOKEN}/tables/tbl%2F1/records/rec%2F1`,
    );
    expect(calls[0].init.method).toBe("PUT");
    expect(parseJsonBody(calls[0])).toEqual({ fields });
  });

  it("单条更新不接受批量 records 响应形态", async () => {
    const { fetch } = recordingFetch(() =>
      Promise.resolve(
        jsonResponse(200, envelope({ records: [{ record_id: "rec-1", fields: {} }] })),
      ),
    );
    const client = createBaseApiClient({ appToken: APP_TOKEN, token: "pt", fetch });

    await expect(client.updateRecord("tbl-1", "rec-1", {})).rejects.toMatchObject({
      kind: "invalid_response",
    } satisfies Partial<BaseApiError>);
  });

  it("批量删除记录传入 record_id 数组", async () => {
    const { fetch, calls } = recordingFetch(() =>
      Promise.resolve(jsonResponse(200, envelope({}))),
    );
    const client = createBaseApiClient({ appToken: APP_TOKEN, token: "pt", fetch });

    await client.batchDeleteRecords("tbl1", ["rec1", "rec2"]);
    expect(calls[0].url).toContain("/tables/tbl1/records/batch_delete");
    expect(parseJsonBody(calls[0])).toEqual({ records: ["rec1", "rec2"] });
  });

  it("信封 code !== 0 归一为结构化错误且不泄露凭据", async () => {
    const { fetch } = recordingFetch(() =>
      Promise.resolve(jsonResponse(200, { code: 1254045, msg: "table not found", data: {} })),
    );
    const client = createBaseApiClient({ appToken: APP_TOKEN, token: "pt-secret", fetch });

    const error = await client.listFields("tblGone").catch((caught) => caught);
    expect(error).toBeInstanceOf(BaseApiError);
    expect((error as BaseApiError).kind).toBe("not_found");
    expect((error as BaseApiError).code).toBe(1254045);
    expect((error as BaseApiError).message).not.toContain("pt-secret");
  });

  it("HTTP 401 归一为 unauthorized", async () => {
    const { fetch } = recordingFetch(() =>
      Promise.resolve(jsonResponse(401, { code: 99991663, msg: "invalid token" })),
    );
    const client = createBaseApiClient({ appToken: APP_TOKEN, token: "pt", fetch });

    const error = await client.listTables().catch((caught) => caught);
    expect(error).toBeInstanceOf(BaseApiError);
    expect((error as BaseApiError).kind).toBe("unauthorized");
  });

  it("HTTP 429 归一为 rate_limited", async () => {
    const { fetch } = recordingFetch(() =>
      Promise.resolve(jsonResponse(429, { code: 0, msg: "" })),
    );
    const client = createBaseApiClient({ appToken: APP_TOKEN, token: "pt", fetch });

    const error = await client.listTables().catch((caught) => caught);
    expect((error as BaseApiError).kind).toBe("rate_limited");
  });

  it("请求超时归一为 timeout", async () => {
    vi.useFakeTimers();
    const fetch: BaseApiFetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        });
      });
    const client = createBaseApiClient({
      appToken: APP_TOKEN,
      token: "pt",
      fetch,
      timeoutMs: 1_000,
    });

    const pending = client.listTables().catch((caught) => caught);
    await vi.advanceTimersByTimeAsync(1_000);
    const error = await pending;
    vi.useRealTimers();

    expect(error).toBeInstanceOf(BaseApiError);
    expect((error as BaseApiError).kind).toBe("timeout");
  });

  it("读取响应体期间超时仍归一为 timeout", async () => {
    vi.useFakeTimers();
    const fetch: BaseApiFetch = (_url, init) =>
      Promise.resolve({
        status: 200,
        json: () =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener("abort", () => {
              reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
            });
          }),
      });
    const client = createBaseApiClient({
      appToken: APP_TOKEN,
      token: "pt",
      fetch,
      timeoutMs: 1_000,
    });

    try {
      const pending = client.listTables().catch((caught) => caught);
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(1_000);
      await expect(pending).resolves.toMatchObject({ kind: "timeout" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("外部 AbortSignal 取消归一为 cancelled", async () => {
    const controller = new AbortController();
    const fetch: BaseApiFetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        });
      });
    const client = createBaseApiClient({ appToken: APP_TOKEN, token: "pt", fetch });

    const pending = client
      .listTables(undefined, { signal: controller.signal })
      .catch((caught) => caught);
    controller.abort();
    const error = await pending;

    expect(error).toBeInstanceOf(BaseApiError);
    expect((error as BaseApiError).kind).toBe("cancelled");
  });

  it("读取响应体期间外部取消仍归一为 cancelled", async () => {
    const controller = new AbortController();
    const fetch: BaseApiFetch = (_url, init) =>
      Promise.resolve({
        status: 200,
        json: () =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener("abort", () => {
              reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
            });
          }),
      });
    const client = createBaseApiClient({ appToken: APP_TOKEN, token: "pt", fetch });

    const pending = client
      .listTables(undefined, { signal: controller.signal })
      .catch((caught) => caught);
    await Promise.resolve();
    controller.abort();

    await expect(pending).resolves.toMatchObject({ kind: "cancelled" });
  });

  it("网络故障归一为 network_error", async () => {
    const fetch: BaseApiFetch = () => Promise.reject(new TypeError("Failed to fetch"));
    const client = createBaseApiClient({ appToken: APP_TOKEN, token: "pt", fetch });

    const error = await client.listTables().catch((caught) => caught);
    expect((error as BaseApiError).kind).toBe("network_error");
  });
});
