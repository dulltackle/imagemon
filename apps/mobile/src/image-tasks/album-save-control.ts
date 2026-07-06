import {
  getImageResultAlbumSaveAvailabilityMessage,
  getImageResultAlbumSaveFailureMessage,
  getImageResultAlbumSaveSuccessMessage,
  type ImageResultAlbumSaveAvailability,
  type ImageResultAlbumSaveResult,
} from "./album-saver";

export type ImageResultAlbumSaveFeedback =
  | { tone: "success"; message: string }
  | { tone: "error"; message: string };

export type ImageResultAlbumSavePresentationFeedback =
  | ImageResultAlbumSaveFeedback
  | { tone: "muted"; message: string };

export type ImageResultAlbumSaveControlState =
  | { status: "checking" }
  | {
      status: "ready";
      availability: ImageResultAlbumSaveAvailability;
      feedback: ImageResultAlbumSaveFeedback | null;
      inProgress: boolean;
    };

export interface ImageResultAlbumSaveControlPresentation {
  disabled: boolean;
  feedback: ImageResultAlbumSavePresentationFeedback | null;
  inProgress: boolean;
  label: string;
}

const SAVE_LABEL = "保存到系统相册";
const SAVING_LABEL = "保存中";

export function createImageResultAlbumSaveControlState(
  availability: ImageResultAlbumSaveAvailability,
): ImageResultAlbumSaveControlState {
  return {
    status: "ready",
    availability,
    feedback: null,
    inProgress: false,
  };
}

export function canStartImageResultAlbumSave(
  state: ImageResultAlbumSaveControlState,
): boolean {
  return (
    state.status === "ready" &&
    !state.inProgress &&
    state.availability.status === "ready"
  );
}

export function startImageResultAlbumSave(
  state: ImageResultAlbumSaveControlState,
): ImageResultAlbumSaveControlState {
  if (state.status !== "ready" || !canStartImageResultAlbumSave(state)) {
    return state;
  }
  return {
    ...state,
    feedback: null,
    inProgress: true,
  };
}

export function finishImageResultAlbumSave(
  state: ImageResultAlbumSaveControlState,
  result: ImageResultAlbumSaveResult,
): ImageResultAlbumSaveControlState {
  if (state.status !== "ready") {
    return state;
  }

  if (result.status === "saved") {
    return {
      ...state,
      feedback: {
        tone: "success",
        message: getImageResultAlbumSaveSuccessMessage(),
      },
      inProgress: false,
    };
  }

  return {
    ...state,
    availability:
      result.reason === "missingFile"
        ? { status: "missingFile" }
        : result.reason === "unsupported"
          ? { status: "unsupported" }
          : state.availability,
    feedback: {
      tone: "error",
      message: getImageResultAlbumSaveFailureMessage(result.reason),
    },
    inProgress: false,
  };
}

export function getImageResultAlbumSaveControlPresentation(
  state: ImageResultAlbumSaveControlState,
): ImageResultAlbumSaveControlPresentation {
  if (state.status === "checking") {
    return {
      disabled: true,
      feedback: null,
      inProgress: false,
      label: SAVE_LABEL,
    };
  }

  return {
    disabled: state.inProgress || state.availability.status !== "ready",
    feedback:
      state.feedback ??
      (state.availability.status === "ready"
        ? null
        : {
            tone: "muted",
            message: getImageResultAlbumSaveAvailabilityMessage(
              state.availability,
            ),
          }),
    inProgress: state.inProgress,
    label: state.inProgress ? SAVING_LABEL : SAVE_LABEL,
  };
}
