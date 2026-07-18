import { BaseApiError, type BasePage } from "./base-api-client";

/**
 * 拉取完整分页结果。飞书偶尔会在末页继续返回 page_token，因此是否续页只能以
 * hasMore 为准；只有明确还有下一页时才消费 token，并防止缺失或重复 token。
 */
export async function collectAllBasePages<T>(
  fetchPage: (pageToken: string | undefined) => Promise<BasePage<T>>,
  options: { signal?: AbortSignal; resourceName: string },
): Promise<T[]> {
  const items: T[] = [];
  const seenTokens = new Set<string>();
  let pageToken: string | undefined;

  while (true) {
    throwIfAborted(options.signal);
    const page = await fetchPage(pageToken);
    items.push(...page.items);
    if (!page.hasMore) {
      return items;
    }

    const nextToken = page.pageToken;
    if (!nextToken || seenTokens.has(nextToken)) {
      throw new BaseApiError(
        "invalid_response",
        null,
        `${options.resourceName}分页响应不完整或重复。`,
      );
    }
    seenTokens.add(nextToken);
    pageToken = nextToken;
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new BaseApiError("cancelled", null, "操作已取消。");
  }
}
