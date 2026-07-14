import {
  CLIPBOARD_COPY_DEBOUNCE_MS,
  canStartClipboardCopy,
  createClipboardCopyControlState,
  finishClipboardCopy,
  getClipboardCopyControlPresentation,
  releaseClipboardCopy,
  startClipboardCopy,
  type ClipboardCopyControlPresentation,
  type ClipboardCopyControlState,
  type ClipboardCopyFeedback,
  type ClipboardCopyResult,
} from "../clipboard/copy-control";

export type PromptdexMarkdownCopyResult = ClipboardCopyResult;
export type PromptdexMarkdownCopyFeedback = ClipboardCopyFeedback;
export type PromptdexMarkdownCopyControlState = ClipboardCopyControlState;
export type PromptdexMarkdownCopyControlPresentation =
  ClipboardCopyControlPresentation;

export const PROMPTDEX_MARKDOWN_COPY_DEBOUNCE_MS =
  CLIPBOARD_COPY_DEBOUNCE_MS;

export const createPromptdexMarkdownCopyControlState =
  createClipboardCopyControlState;
export const canStartPromptdexMarkdownCopy = canStartClipboardCopy;
export const startPromptdexMarkdownCopy = startClipboardCopy;
export const releasePromptdexMarkdownCopy = releaseClipboardCopy;
export const getPromptdexMarkdownCopyControlPresentation =
  getClipboardCopyControlPresentation;

export function finishPromptdexMarkdownCopy(
  state: PromptdexMarkdownCopyControlState,
  result: PromptdexMarkdownCopyResult,
): PromptdexMarkdownCopyControlState {
  return finishClipboardCopy(state, result, {
    success: getPromptdexMarkdownCopySuccessMessage(),
    failure: getPromptdexMarkdownCopyFailureMessage(),
  });
}

export function getPromptdexMarkdownCopySuccessMessage(): string {
  return "Promptdex Markdown 已复制。";
}

export function getPromptdexMarkdownCopyFailureMessage(): string {
  return "无法复制到剪贴板，请稍后重试。";
}
