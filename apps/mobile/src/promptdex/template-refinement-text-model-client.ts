import { normalizeBaseUrl } from "../model-configurations";
import type { TemplateRefinementFailureReason } from "./template-refinement-draft-repository";

export interface TemplateRefinementTextModelClient {
  generateProposalJson(input: TemplateRefinementTextModelInput): Promise<unknown>;
}

export interface TemplateRefinementTextModelInput {
  baseUrl: string;
  apiKey: string;
  modelName: string;
  externalPrompt: string;
  plannedUse: string;
}

export interface TemplateRefinementTextModelFetchResponseLike {
  status: number;
  json(): Promise<unknown>;
}

export interface TemplateRefinementTextModelFetchInitLike {
  method: "POST";
  headers: Record<string, string>;
  body: string;
  signal?: AbortSignal;
}

export type TemplateRefinementTextModelFetchLike = (
  url: string,
  init: TemplateRefinementTextModelFetchInitLike,
) => Promise<TemplateRefinementTextModelFetchResponseLike>;

export interface CreateFetchTemplateRefinementTextModelClientOptions {
  fetch?: TemplateRefinementTextModelFetchLike;
  timeoutMs?: number;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;

export class TemplateRefinementTextModelClientError extends Error {
  constructor(
    readonly reason: TemplateRefinementFailureReason,
    message: string,
    readonly statusCode?: number,
    readonly providerCode?: string,
  ) {
    super(message);
    this.name = "TemplateRefinementTextModelClientError";
    Object.setPrototypeOf(this, TemplateRefinementTextModelClientError.prototype);
  }
}

const TEMPLATE_REFINEMENT_SYSTEM_PROMPT = `你是 Imagemon Promptdex 模板提炼器。你必须把外部完整提示词提炼为可复用的 Promptdex 图鉴条目方案。

只输出一个 JSON 对象文本，不要输出 Markdown、解释、代码块或额外前后缀。

JSON 对象必须包含：
- template: object，包含 name、description、可选 version、inputs、body。
- taskTypeRationale: string，说明如何从 inputs 推断任务类型。
- retainedRules: string[]，概述保留的可复用规则。
- removedRules: array，每项包含 summary 与 reason。
- additions: array，每项包含 summary、reason 与 impactIfRejected。

约束：
- 不要输出 taskType 字段；应用会从 inputs 推断任务类型。
- name 必须是英文 kebab-case。
- inputs 必须是非空对象；每个输入包含 required:boolean 与 description:string。
- body 必须是将写入图鉴条目的逐字正文，不要包含外部完整提示词来源、URL 或提炼过程。
- additions 只能包含外部完整提示词未提供、但为计划用途补足模板所需的新规则；没有补充时输出空数组。`;

export function createFetchTemplateRefinementTextModelClient(
  options: CreateFetchTemplateRefinementTextModelClientOptions = {},
): TemplateRefinementTextModelClient {
  const fetch = options.fetch ?? defaultFetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;

  return {
    async generateProposalJson(input) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(
          `${normalizeBaseUrl(input.baseUrl)}/chat/completions`,
          {
            method: "POST",
            headers: {
              Accept: "application/json",
              Authorization: `Bearer ${input.apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: input.modelName,
              messages: [
                {
                  role: "system",
                  content: TEMPLATE_REFINEMENT_SYSTEM_PROMPT,
                },
                {
                  role: "user",
                  content: buildTemplateRefinementUserMessage(input),
                },
              ],
              response_format: { type: "json_object" },
            }),
            signal: controller.signal,
          },
        );

        if (!response || typeof response.status !== "number") {
          throw createClientError("invalid_response");
        }

        if (response.status < 200 || response.status >= 300) {
          const body = await tryReadJson(response);
          const providerCode = extractProviderCode(body);
          throw createClientError(mapResponseFailureReason(response.status), {
            statusCode: response.status,
            providerCode,
          });
        }

        const body = await tryReadJson(response);
        const content = extractAssistantTextContent(body);
        return parseJsonObjectText(content);
      } catch (error) {
        if (error instanceof TemplateRefinementTextModelClientError) {
          throw error;
        }
        // 请求超时被 AbortController 中止，或底层网络失败，都归类为网络错误，
        // 以便上层将草稿转入失败态并释放模型调用锁。
        if (isAbortError(error) || isNetworkLikeError(error)) {
          throw createClientError("network_error");
        }
        throw createClientError("unknown");
      } finally {
        clearTimeout(timeoutId);
      }
    },
  };
}

function buildTemplateRefinementUserMessage(
  input: TemplateRefinementTextModelInput,
): string {
  return [
    "请根据以下计划用途提炼外部完整提示词，输出符合约束的 JSON 对象。",
    "",
    "## 计划用途",
    input.plannedUse,
    "",
    "## 外部完整提示词",
    input.externalPrompt,
  ].join("\n");
}

function mapResponseFailureReason(
  statusCode: number,
): TemplateRefinementFailureReason {
  if (statusCode === 401 || statusCode === 403) {
    return "unauthorized";
  }
  if (statusCode === 429) {
    return "rate_limited";
  }
  if (statusCode >= 500 && statusCode < 600) {
    return "server_error";
  }
  return "invalid_response";
}

function extractAssistantTextContent(body: unknown): string {
  if (!isObject(body) || !Array.isArray(body.choices)) {
    throw createClientError("invalid_response");
  }

  const firstChoice = body.choices[0];
  if (!isObject(firstChoice) || !isObject(firstChoice.message)) {
    throw createClientError("invalid_response");
  }

  const content = firstChoice.message.content;
  if (typeof content !== "string" || !content.trim()) {
    throw createClientError("invalid_response");
  }
  return content;
}

function parseJsonObjectText(content: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw createClientError("invalid_response", { cause: error });
  }
  if (!isObject(parsed)) {
    throw createClientError("invalid_response");
  }
  return parsed;
}

async function tryReadJson(
  response: TemplateRefinementTextModelFetchResponseLike,
): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function extractProviderCode(body: unknown): string | undefined {
  if (!isObject(body) || !isObject(body.error)) {
    return undefined;
  }

  const code = body.error.code;
  if (
    typeof code !== "string" ||
    code.length === 0 ||
    code.length > 128 ||
    !/^[A-Za-z0-9._:-]+$/.test(code)
  ) {
    return undefined;
  }
  return code;
}

function createClientError(
  reason: TemplateRefinementFailureReason,
  options: {
    statusCode?: number;
    providerCode?: string;
    cause?: unknown;
  } = {},
): TemplateRefinementTextModelClientError {
  const error = new TemplateRefinementTextModelClientError(
    reason,
    failureMessage(reason),
    options.statusCode,
    options.providerCode,
  );
  if (options.cause !== undefined) {
    error.cause = options.cause;
  }
  return error;
}

function failureMessage(reason: TemplateRefinementFailureReason): string {
  switch (reason) {
    case "missing_text_model_configuration":
      return "缺少就绪的默认文本模型配置。";
    case "missing_credential":
      return "默认文本模型配置缺少 API Key。";
    case "offline":
      return "当前设备离线，不能发起模板提炼。";
    case "unauthorized":
      return "API Key 未通过认证，请检查凭据。";
    case "rate_limited":
      return "模型服务请求受到限流，请稍后重试。";
    case "server_error":
      return "模型服务暂时不可用，请稍后重试。";
    case "network_error":
      return "无法连接模型服务，请检查网络或 base URL。";
    case "invalid_response":
      return "模型服务没有返回有效的提炼方案 JSON。";
    case "promptdex_contract_invalid":
      return "提炼方案不符合 Promptdex 图鉴条目契约。";
    case "unknown":
      return "模板提炼失败，请稍后重试或检查模型配置。";
  }
}

async function defaultFetch(
  url: string,
  init: TemplateRefinementTextModelFetchInitLike,
): Promise<TemplateRefinementTextModelFetchResponseLike> {
  if (typeof globalThis.fetch !== "function") {
    throw new TypeError("fetch is unavailable");
  }
  return globalThis.fetch(url, init);
}

function isAbortError(error: unknown): boolean {
  return isObject(error) && error.name === "AbortError";
}

function isNetworkLikeError(error: unknown): boolean {
  // 仅在错误特征匹配已知的 fetch/网络失败信号时才判定为网络错误，
  // 避免把 try 块内真实的编码 TypeError 误报为可重试的网络错误。
  return containsAny(errorFingerprint(error), [
    "network",
    "failed to fetch",
    "load failed",
    "request failed",
    "econn",
    "enet",
    "dns",
    "offline",
    "internet connection",
    "could not connect",
  ]);
}

function errorFingerprint(error: unknown): string {
  const parts: string[] = [];
  if (error instanceof Error) {
    parts.push(error.name, error.message);
  }
  if (isObject(error)) {
    for (const key of ["name", "message", "code"] as const) {
      const value = error[key];
      if (typeof value === "string") {
        parts.push(value);
      }
    }
  }
  return parts.join(" ").toLowerCase();
}

function containsAny(value: string, needles: readonly string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
