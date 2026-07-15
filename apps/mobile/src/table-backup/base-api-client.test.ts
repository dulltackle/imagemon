import { describe, expect, it, vi } from "vitest";

import {
  BASE_API_ORIGIN,
  BaseApiError,
  type BaseApiFetch,
  type BaseApiFetchInit,
  createBaseApiClient,
} from "./base-api-client";

interface RecordedCall {
  url: string;
  init: BaseApiFetchInit;
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

describe("createBaseApiClient", () => {
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
    expect(JSON.parse(calls[0].init.body ?? "")).toEqual({
      table: { name: "Imagemon 图鉴备份", fields: [{ field_name: "名称", type: 1 }] },
    });
  });

  it("批量删除记录传入 record_id 数组", async () => {
    const { fetch, calls } = recordingFetch(() =>
      Promise.resolve(jsonResponse(200, envelope({}))),
    );
    const client = createBaseApiClient({ appToken: APP_TOKEN, token: "pt", fetch });

    await client.batchDeleteRecords("tbl1", ["rec1", "rec2"]);
    expect(calls[0].url).toContain("/tables/tbl1/records/batch_delete");
    expect(JSON.parse(calls[0].init.body ?? "")).toEqual({ records: ["rec1", "rec2"] });
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

  it("网络故障归一为 network_error", async () => {
    const fetch: BaseApiFetch = () => Promise.reject(new TypeError("Failed to fetch"));
    const client = createBaseApiClient({ appToken: APP_TOKEN, token: "pt", fetch });

    const error = await client.listTables().catch((caught) => caught);
    expect((error as BaseApiError).kind).toBe("network_error");
  });
});
