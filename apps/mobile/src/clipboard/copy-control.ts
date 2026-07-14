export type ClipboardCopyResult =
  | { status: "copied" }
  | { status: "failed" };

export type ClipboardCopyFeedback =
  | { tone: "success"; message: string }
  | { tone: "error"; message: string };

export interface ClipboardCopyMessages {
  success: string;
  failure: string;
}

export interface ClipboardCopyControlState {
  status: "idle" | "copying";
  feedback: ClipboardCopyFeedback | null;
}

export interface ClipboardCopyControlPresentation {
  feedback: ClipboardCopyFeedback | null;
  inProgress: boolean;
}

export const CLIPBOARD_COPY_DEBOUNCE_MS = 800;

export function createClipboardCopyControlState(): ClipboardCopyControlState {
  return {
    status: "idle",
    feedback: null,
  };
}

export function canStartClipboardCopy(
  state: ClipboardCopyControlState,
): boolean {
  return state.status === "idle";
}

export function startClipboardCopy(
  state: ClipboardCopyControlState,
): ClipboardCopyControlState {
  if (!canStartClipboardCopy(state)) {
    return state;
  }
  return {
    status: "copying",
    feedback: null,
  };
}

export function finishClipboardCopy(
  state: ClipboardCopyControlState,
  result: ClipboardCopyResult,
  messages: ClipboardCopyMessages,
): ClipboardCopyControlState {
  return {
    status: state.status,
    feedback:
      result.status === "copied"
        ? { tone: "success", message: messages.success }
        : { tone: "error", message: messages.failure },
  };
}

export function releaseClipboardCopy(
  state: ClipboardCopyControlState,
): ClipboardCopyControlState {
  if (state.status === "idle") {
    return state;
  }
  return {
    ...state,
    status: "idle",
  };
}

export function getClipboardCopyControlPresentation(
  state: ClipboardCopyControlState,
): ClipboardCopyControlPresentation {
  return {
    feedback: state.feedback,
    inProgress: state.status === "copying",
  };
}
