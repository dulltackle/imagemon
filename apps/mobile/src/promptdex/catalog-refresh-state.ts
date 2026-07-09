export type PromptdexCatalogRefreshState<ReadyFields extends object> =
  | { status: "loading" }
  | { status: "failed"; message: string }
  | ({ status: "ready" } & ReadyFields);

export function beginPromptdexCatalogRefresh<ReadyFields extends object>(
  current: PromptdexCatalogRefreshState<ReadyFields>,
): PromptdexCatalogRefreshState<ReadyFields> {
  if (current.status === "ready") {
    return current;
  }
  return { status: "loading" };
}

export function failPromptdexCatalogRefresh<ReadyFields extends object>(
  current: PromptdexCatalogRefreshState<ReadyFields>,
  message: string,
): PromptdexCatalogRefreshState<ReadyFields> {
  if (current.status === "ready") {
    return current;
  }
  return { status: "failed", message };
}

export function getPromptdexCatalogRefreshFailureMessage(
  error: unknown,
): string {
  return error instanceof Error ? error.message : String(error);
}
