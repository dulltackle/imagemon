// 多维表格个人授权码通道的 HTTP 封装（方案 1.1 节端点，spike 已验证）。
//
// - 统一前缀 https://base-api.feishu.cn/open-apis/bitable/v1/apps/:app_token
// - 仅注入 Authorization: Bearer <个人授权码>，错误说明里不带请求头/凭据。
// - JSON 请求 30 秒超时；素材上传独立使用 120 秒超时，并支持外部 AbortSignal 取消。
// - 响应 HTTP 非 2xx 或飞书信封 code !== 0 一律归一为结构化 BaseApiError。
// - 附件只经 bitable v1 单条 PUT 写入；batch_update 与 Base v3 附件端点均不兼容个人授权码。

import { MAX_BASE_MEDIA_UPLOAD_BYTES } from "../shared/base-media-upload";

export { MAX_BASE_MEDIA_UPLOAD_BYTES } from "../shared/base-media-upload";

export const BASE_API_ORIGIN = "https://base-api.feishu.cn";
export const DEFAULT_BASE_API_TIMEOUT_MS = 30_000;
export const DEFAULT_BASE_MEDIA_UPLOAD_TIMEOUT_MS = 120_000;

// 个人授权码兼容边界经实机验证：素材必须用 bitable_file；bitable_image 不可用。
export const BASE_MEDIA_PARENT_TYPE = "bitable_file";

// 多维表格字段类型。
export const BASE_FIELD_TYPE_TEXT = 1;
export const BASE_FIELD_TYPE_ATTACHMENT = 17;

export type BaseApiErrorKind =
  | "unauthorized"
  | "forbidden"
  | "rate_limited"
  | "not_found"
  | "api_error"
  | "server_error"
  | "network_error"
  | "timeout"
  | "cancelled"
  | "invalid_response";

export class BaseApiError extends Error {
  constructor(
    readonly kind: BaseApiErrorKind,
    /** 飞书信封业务错误码；HTTP 层错误为 null。 */
    readonly code: number | null,
    message: string,
  ) {
    super(message);
    this.name = "BaseApiError";
  }
}

export interface BaseTableSummary {
  table_id: string;
  name: string;
}

export interface BaseField {
  field_id: string;
  field_name: string;
  type: number;
}

export interface BaseRecord {
  record_id: string;
  fields: Record<string, unknown>;
}

export interface BasePage<T> {
  items: T[];
  pageToken: string | null;
  hasMore: boolean;
}

export interface CreateTableFieldSpec {
  field_name: string;
  type: number;
}

export interface RecordFieldsWrite {
  fields: Record<string, unknown>;
}

export interface RecordUpdateWrite {
  record_id: string;
  fields: Record<string, unknown>;
}

export interface BaseApiResponseLike {
  status: number;
  json(): Promise<unknown>;
}

export interface BaseApiFetchInit {
  method: string;
  headers: Record<string, string>;
  body?: string | BaseApiFormData;
  signal: AbortSignal;
}

export type BaseApiFetch = (
  url: string,
  init: BaseApiFetchInit,
) => Promise<BaseApiResponseLike>;

export interface BaseApiClientOptions {
  appToken: string;
  token: string;
  fetch?: BaseApiFetch;
  timeoutMs?: number;
  uploadTimeoutMs?: number;
  createFormData?: CreateBaseApiFormData;
}

export interface BaseApiRequestOptions {
  signal?: AbortSignal;
}

export interface BaseApiFormData {
  append(name: string, value: unknown): void;
}

export type CreateBaseApiFormData = () => BaseApiFormData;

export interface BaseMediaUploadFile {
  uri: string;
  name: string;
  type: string;
  size: number;
}

export interface BaseApiClient {
  uploadMedia(
    file: BaseMediaUploadFile,
    options?: BaseApiRequestOptions,
  ): Promise<string>;
  listTables(
    params?: { pageSize?: number; pageToken?: string },
    options?: BaseApiRequestOptions,
  ): Promise<BasePage<BaseTableSummary>>;
  createTable(
    input: { name: string; fields: CreateTableFieldSpec[] },
    options?: BaseApiRequestOptions,
  ): Promise<string>;
  listFields(
    tableId: string,
    params?: { pageSize?: number; pageToken?: string },
    options?: BaseApiRequestOptions,
  ): Promise<BasePage<BaseField>>;
  createField(
    tableId: string,
    field: CreateTableFieldSpec,
    options?: BaseApiRequestOptions,
  ): Promise<string>;
  listRecords(
    tableId: string,
    params?: { pageSize?: number; pageToken?: string },
    options?: BaseApiRequestOptions,
  ): Promise<BasePage<BaseRecord>>;
  batchCreateRecords(
    tableId: string,
    records: RecordFieldsWrite[],
    options?: BaseApiRequestOptions,
  ): Promise<BaseRecord[]>;
  batchUpdateRecords(
    tableId: string,
    records: RecordUpdateWrite[],
    options?: BaseApiRequestOptions,
  ): Promise<BaseRecord[]>;
  updateRecord(
    tableId: string,
    recordId: string,
    fields: Record<string, unknown>,
    options?: BaseApiRequestOptions,
  ): Promise<BaseRecord>;
  batchDeleteRecords(
    tableId: string,
    recordIds: string[],
    options?: BaseApiRequestOptions,
  ): Promise<void>;
}

export function createBaseApiClient({
  appToken,
  token,
  fetch = defaultFetch,
  timeoutMs = DEFAULT_BASE_API_TIMEOUT_MS,
  uploadTimeoutMs = DEFAULT_BASE_MEDIA_UPLOAD_TIMEOUT_MS,
  createFormData = defaultCreateFormData,
}: BaseApiClientOptions): BaseApiClient {
  const appBase = `${BASE_API_ORIGIN}/open-apis/bitable/v1/apps/${encodeURIComponent(appToken)}`;

  async function request<T>(
    method: string,
    path: string,
    init: {
      query?: Record<string, string | number | undefined>;
      body?: unknown;
      signal?: AbortSignal;
    } = {},
  ): Promise<T> {
    const url = appendQuery(`${appBase}${path}`, init.query);
    return executeRequest<T>({
      url,
      method,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: init.signal,
      timeoutMs,
      fetch,
    });
  }

  return {
    async uploadMedia(file, options = {}) {
      assertValidMediaUploadFile(file);

      const body = createFormData();
      body.append("file_name", file.name);
      body.append("parent_type", BASE_MEDIA_PARENT_TYPE);
      body.append("parent_node", appToken);
      body.append("size", String(file.size));
      body.append("file", {
        uri: file.uri,
        name: file.name,
        type: file.type,
      });

      const data = await executeRequest<{ file_token?: unknown }>({
        url: `${BASE_API_ORIGIN}/open-apis/drive/v1/medias/upload_all`,
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
        body,
        signal: options.signal,
        timeoutMs: uploadTimeoutMs,
        fetch,
      });
      const fileToken = data.file_token;
      if (typeof fileToken !== "string" || fileToken === "") {
        throw new BaseApiError("invalid_response", null, "上传素材响应缺少 file_token。");
      }
      return fileToken;
    },

    async listTables(params = {}, options = {}) {
      const data = await request<RawListData<RawTable>>("GET", "/tables", {
        query: { page_size: params.pageSize, page_token: params.pageToken },
        signal: options.signal,
      });
      return mapPage(data, mapTable);
    },

    async createTable(input, options = {}) {
      const data = await request<{ table_id?: unknown }>("POST", "/tables", {
        body: { table: { name: input.name, fields: input.fields } },
        signal: options.signal,
      });
      const tableId = data.table_id;
      if (typeof tableId !== "string" || tableId === "") {
        throw new BaseApiError("invalid_response", null, "建表响应缺少 table_id。");
      }
      return tableId;
    },

    async listFields(tableId, params = {}, options = {}) {
      const data = await request<RawListData<RawField>>(
        "GET",
        `/tables/${encodeURIComponent(tableId)}/fields`,
        {
          query: { page_size: params.pageSize, page_token: params.pageToken },
          signal: options.signal,
        },
      );
      return mapPage(data, mapField);
    },

    async createField(tableId, field, options = {}) {
      const data = await request<{ field?: { field_id?: unknown } }>(
        "POST",
        `/tables/${encodeURIComponent(tableId)}/fields`,
        { body: field, signal: options.signal },
      );
      const fieldId = data.field?.field_id;
      if (typeof fieldId !== "string" || fieldId === "") {
        throw new BaseApiError("invalid_response", null, "补建字段响应缺少 field_id。");
      }
      return fieldId;
    },

    async listRecords(tableId, params = {}, options = {}) {
      const data = await request<RawListData<RawRecord>>(
        "GET",
        `/tables/${encodeURIComponent(tableId)}/records`,
        {
          query: { page_size: params.pageSize, page_token: params.pageToken },
          signal: options.signal,
        },
      );
      return mapPage(data, mapRecord);
    },

    async batchCreateRecords(tableId, records, options = {}) {
      const data = await request<{ records?: unknown }>(
        "POST",
        `/tables/${encodeURIComponent(tableId)}/records/batch_create`,
        { body: { records }, signal: options.signal },
      );
      return mapRecordList(data.records);
    },

    async batchUpdateRecords(tableId, records, options = {}) {
      const data = await request<{ records?: unknown }>(
        "POST",
        `/tables/${encodeURIComponent(tableId)}/records/batch_update`,
        { body: { records }, signal: options.signal },
      );
      return mapRecordList(data.records);
    },

    async updateRecord(tableId, recordId, fields, options = {}) {
      // 实机确认附件字段不能走 batch_update，标识与附件必须由这一单条 PUT 同时写入。
      const data = await request<{ record?: unknown }>(
        "PUT",
        `/tables/${encodeURIComponent(tableId)}/records/${encodeURIComponent(recordId)}`,
        { body: { fields }, signal: options.signal },
      );
      if (!isObject(data.record)) {
        throw new BaseApiError("invalid_response", null, "更新记录响应缺少 record。");
      }
      return mapRecord(data.record);
    },

    async batchDeleteRecords(tableId, recordIds, options = {}) {
      await request<unknown>(
        "POST",
        `/tables/${encodeURIComponent(tableId)}/records/batch_delete`,
        { body: { records: recordIds }, signal: options.signal },
      );
    },
  };
}

interface ExecuteRequestOptions {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string | BaseApiFormData;
  signal?: AbortSignal;
  timeoutMs: number;
  fetch: BaseApiFetch;
}

async function executeRequest<T>({
  url,
  method,
  headers,
  body: requestBody,
  signal,
  timeoutMs,
  fetch,
}: ExecuteRequestOptions): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  const onExternalAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener("abort", onExternalAbort);
    }
  }

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: requestBody,
      signal: controller.signal,
    });

    if (!response || typeof response.status !== "number") {
      throw new BaseApiError("invalid_response", null, "飞书接口返回无法解析。");
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      // 读取响应体期间同样可能发生外部取消或内部超时，交给外层统一归一。
      if (signal?.aborted || controller.signal.aborted) {
        throw error;
      }
      throw new BaseApiError("invalid_response", null, "飞书接口返回无法解析。");
    }

    if (response.status < 200 || response.status >= 300) {
      throw httpStatusError(response.status, body);
    }

    return unwrapEnvelope<T>(body);
  } catch (error) {
    if (error instanceof BaseApiError) {
      throw error;
    }
    if (signal?.aborted) {
      throw new BaseApiError("cancelled", null, "操作已取消。");
    }
    if (controller.signal.aborted) {
      throw new BaseApiError("timeout", null, "飞书接口请求超时。");
    }
    if (error instanceof TypeError) {
      throw new BaseApiError("network_error", null, "网络连接失败。");
    }
    throw new BaseApiError("api_error", null, "飞书接口调用失败。");
  } finally {
    clearTimeout(timeout);
    if (signal) {
      signal.removeEventListener("abort", onExternalAbort);
    }
  }
}

interface RawListData<T> {
  items?: unknown;
  page_token?: unknown;
  has_more?: unknown;
}

interface RawTable {
  table_id?: unknown;
  name?: unknown;
}

interface RawField {
  field_id?: unknown;
  field_name?: unknown;
  type?: unknown;
}

interface RawRecord {
  record_id?: unknown;
  fields?: unknown;
}

function unwrapEnvelope<T>(body: unknown): T {
  if (!isObject(body) || typeof body.code !== "number") {
    throw new BaseApiError("invalid_response", null, "飞书接口返回缺少状态码。");
  }
  if (body.code !== 0) {
    throw envelopeError(body.code, typeof body.msg === "string" ? body.msg : "");
  }
  return (body.data ?? {}) as T;
}

function httpStatusError(status: number, body: unknown): BaseApiError {
  const envelopeCode =
    isObject(body) && typeof body.code === "number" ? body.code : null;
  const envelopeMsg =
    isObject(body) && typeof body.msg === "string" ? body.msg : "";
  const kind: BaseApiErrorKind =
    status === 401
      ? "unauthorized"
      : status === 403
        ? "forbidden"
        : status === 404
          ? "not_found"
          : status === 429
            ? "rate_limited"
            : status >= 500
              ? "server_error"
              : "api_error";
  return new BaseApiError(kind, envelopeCode, httpMessage(kind, envelopeMsg));
}

function envelopeError(code: number, msg: string): BaseApiError {
  // 飞书业务错误码分类：鉴权/权限/限流/找不到，其余归一为 api_error。
  const kind: BaseApiErrorKind =
    code === 99991663 || code === 99991661
      ? "unauthorized"
      : code === 91402 || code === 91403
        ? "not_found"
        : code === 1254607 || code === 1254045
          ? "not_found"
          : "api_error";
  const detail = msg ? `${msg}（错误码 ${code}）` : `飞书接口错误码 ${code}。`;
  return new BaseApiError(kind, code, detail);
}

function httpMessage(kind: BaseApiErrorKind, msg: string): string {
  const base =
    kind === "unauthorized"
      ? "个人授权码未通过认证。"
      : kind === "forbidden"
        ? "个人授权码没有该多维表格的访问权限。"
        : kind === "not_found"
          ? "目标多维表格或数据表不存在。"
          : kind === "rate_limited"
            ? "请求受到限流。"
            : kind === "server_error"
              ? "飞书服务返回服务器错误。"
              : "飞书接口调用失败。";
  return msg ? `${base}（${msg}）` : base;
}

function mapPage<Raw, T>(
  data: RawListData<Raw>,
  mapItem: (raw: Raw) => T,
): BasePage<T> {
  const rawItems = Array.isArray(data.items) ? data.items : [];
  return {
    items: rawItems.map((item) => mapItem(item as Raw)),
    pageToken:
      typeof data.page_token === "string" && data.page_token !== ""
        ? data.page_token
        : null,
    hasMore: data.has_more === true,
  };
}

function mapTable(raw: RawTable): BaseTableSummary {
  if (typeof raw.table_id !== "string") {
    throw new BaseApiError("invalid_response", null, "数据表列表缺少 table_id。");
  }
  return {
    table_id: raw.table_id,
    name: typeof raw.name === "string" ? raw.name : "",
  };
}

function mapField(raw: RawField): BaseField {
  if (typeof raw.field_id !== "string" || typeof raw.field_name !== "string") {
    throw new BaseApiError("invalid_response", null, "字段列表缺少必要属性。");
  }
  return {
    field_id: raw.field_id,
    field_name: raw.field_name,
    type: typeof raw.type === "number" ? raw.type : -1,
  };
}

function mapRecord(raw: RawRecord): BaseRecord {
  if (!isObject(raw) || typeof raw.record_id !== "string" || raw.record_id === "") {
    throw new BaseApiError("invalid_response", null, "记录列表缺少 record_id。");
  }
  return {
    record_id: raw.record_id,
    fields: isObject(raw.fields) ? raw.fields : {},
  };
}

function mapRecordList(value: unknown): BaseRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => mapRecord(item as RawRecord));
}

function appendQuery(
  url: string,
  query?: Record<string, string | number | undefined>,
): string {
  if (!query) {
    return url;
  }
  const parts: string[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) {
      continue;
    }
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return parts.length > 0 ? `${url}?${parts.join("&")}` : url;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertValidMediaUploadFile(file: BaseMediaUploadFile): void {
  if (
    file.uri.trim() === "" ||
    file.name.trim() === "" ||
    file.type.trim() === "" ||
    !Number.isSafeInteger(file.size) ||
    file.size <= 0
  ) {
    throw new BaseApiError("api_error", null, "上传素材文件描述无效或文件为空。");
  }
  if (file.size > MAX_BASE_MEDIA_UPLOAD_BYTES) {
    throw new BaseApiError("api_error", null, "上传素材超过 20 MB 大小上限。");
  }
}

function defaultCreateFormData(): BaseApiFormData {
  return new FormData() as unknown as BaseApiFormData;
}

async function defaultFetch(
  url: string,
  init: BaseApiFetchInit,
): Promise<BaseApiResponseLike> {
  if (typeof globalThis.fetch !== "function") {
    throw new TypeError("fetch is unavailable");
  }
  return globalThis.fetch(url, init as unknown as RequestInit);
}
