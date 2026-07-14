import type { BusinessCallAttentionKind } from "./repository";

type DetailLoadStatus = "loading" | "missing" | "error" | "ready";

export interface HistoryDetailAttentionClearInput {
  readonly isFocused: boolean;
  readonly routeHistoryId: string | null;
  readonly loadedHistoryId: string | null;
  readonly loadStatus: DetailLoadStatus;
  readonly taskStatus: "running" | "completed" | "failed" | "unknown" | null;
  readonly hasActiveCall: boolean;
  readonly attentionKind: BusinessCallAttentionKind | null;
}

export function shouldClearHistoryDetailAttention({
  attentionKind,
  hasActiveCall,
  isFocused,
  loadedHistoryId,
  loadStatus,
  routeHistoryId,
  taskStatus,
}: HistoryDetailAttentionClearInput): boolean {
  return (
    isFocused &&
    loadStatus === "ready" &&
    routeHistoryId !== null &&
    loadedHistoryId === routeHistoryId &&
    taskStatus !== null &&
    taskStatus !== "running" &&
    !hasActiveCall &&
    attentionKind !== null
  );
}

export interface ImageDetailAttentionClearInput {
  readonly isFocused: boolean;
  readonly routeImageResultId: string | null;
  readonly loadedImageResultId: string | null;
  readonly loadStatus: DetailLoadStatus;
  readonly taskHistoryId: string | null;
  readonly attentionKind: BusinessCallAttentionKind | null;
}

export function shouldClearImageDetailAttention({
  attentionKind,
  isFocused,
  loadedImageResultId,
  loadStatus,
  routeImageResultId,
  taskHistoryId,
}: ImageDetailAttentionClearInput): boolean {
  return (
    isFocused &&
    loadStatus === "ready" &&
    routeImageResultId !== null &&
    loadedImageResultId === routeImageResultId &&
    taskHistoryId !== null &&
    attentionKind === "succeeded"
  );
}

export interface TemplateRefinementAttentionClearInput {
  readonly isFocused: boolean;
  readonly loadStatus: "loading" | "failed" | "ready";
  readonly hasActiveCall: boolean;
  readonly attentionKind: BusinessCallAttentionKind | null;
}

export function shouldClearTemplateRefinementAttention({
  attentionKind,
  hasActiveCall,
  isFocused,
  loadStatus,
}: TemplateRefinementAttentionClearInput): boolean {
  return (
    isFocused &&
    loadStatus === "ready" &&
    !hasActiveCall &&
    attentionKind !== null
  );
}

export interface RenderedEntryTaskAttentionClearInput {
  readonly isFocused: boolean;
  readonly routeEntryName: string | null;
  readonly loadedEntryName: string | null;
  readonly loadedEntryKey: string | null;
  readonly resultEntryKey: string | null;
  readonly resultHistoryId: string | null;
  readonly isResultRendered: boolean;
  readonly resultKind: Extract<
    BusinessCallAttentionKind,
    "succeeded" | "failed"
  > | null;
  readonly attentionKind: BusinessCallAttentionKind | null;
}

export function shouldClearRenderedEntryTaskAttention({
  attentionKind,
  isFocused,
  isResultRendered,
  loadedEntryKey,
  loadedEntryName,
  resultEntryKey,
  resultHistoryId,
  resultKind,
  routeEntryName,
}: RenderedEntryTaskAttentionClearInput): boolean {
  if (
    !isFocused ||
    routeEntryName === null ||
    loadedEntryName !== routeEntryName ||
    loadedEntryKey === null ||
    resultEntryKey === null ||
    loadedEntryKey !== resultEntryKey ||
    resultHistoryId === null ||
    !isResultRendered ||
    resultKind === null
  ) {
    return false;
  }

  return attentionKind === resultKind;
}
