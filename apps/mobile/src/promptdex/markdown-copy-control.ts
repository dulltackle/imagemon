export type PromptdexMarkdownCopyResult =
  | { status: "copied" }
  | { status: "failed" };

export type PromptdexMarkdownCopyFeedback =
  | { tone: "success"; message: string }
  | { tone: "error"; message: string };

export interface PromptdexMarkdownCopyControlState {
  status: "idle" | "copying";
  feedback: PromptdexMarkdownCopyFeedback | null;
}

export interface PromptdexMarkdownCopyControlPresentation {
  feedback: PromptdexMarkdownCopyFeedback | null;
  inProgress: boolean;
}

export const PROMPTDEX_MARKDOWN_COPY_DEBOUNCE_MS = 800;

export function createPromptdexMarkdownCopyControlState(): PromptdexMarkdownCopyControlState {
  return {
    status: "idle",
    feedback: null,
  };
}

export function canStartPromptdexMarkdownCopy(
  state: PromptdexMarkdownCopyControlState,
): boolean {
  return state.status === "idle";
}

export function startPromptdexMarkdownCopy(
  state: PromptdexMarkdownCopyControlState,
): PromptdexMarkdownCopyControlState {
  if (!canStartPromptdexMarkdownCopy(state)) {
    return state;
  }
  return {
    status: "copying",
    feedback: null,
  };
}

export function finishPromptdexMarkdownCopy(
  state: PromptdexMarkdownCopyControlState,
  result: PromptdexMarkdownCopyResult,
): PromptdexMarkdownCopyControlState {
  return {
    status: state.status,
    feedback:
      result.status === "copied"
        ? {
            tone: "success",
            message: getPromptdexMarkdownCopySuccessMessage(),
          }
        : {
            tone: "error",
            message: getPromptdexMarkdownCopyFailureMessage(),
          },
  };
}

export function releasePromptdexMarkdownCopy(
  state: PromptdexMarkdownCopyControlState,
): PromptdexMarkdownCopyControlState {
  if (state.status === "idle") {
    return state;
  }
  return {
    ...state,
    status: "idle",
  };
}

export function getPromptdexMarkdownCopyControlPresentation(
  state: PromptdexMarkdownCopyControlState,
): PromptdexMarkdownCopyControlPresentation {
  return {
    feedback: state.feedback,
    inProgress: state.status === "copying",
  };
}

export function getPromptdexMarkdownCopySuccessMessage(): string {
  return "Promptdex Markdown 已复制。";
}

export function getPromptdexMarkdownCopyFailureMessage(): string {
  return "无法复制到剪贴板，请稍后重试。";
}
