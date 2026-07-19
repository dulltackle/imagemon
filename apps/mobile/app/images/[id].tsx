import { useIsFocused } from "@react-navigation/native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert } from "react-native";

import { useReadyAppRuntime } from "../../src/app-state";
import {
  shouldClearImageDetailAttention,
  useBusinessCallAttentionSnapshot,
} from "../../src/business-call-attentions";
import { formatLocalDateTime } from "../../src/formatters/date-time";
import {
  canStartImageResultAlbumSave,
  createImageResultAlbumSaveControlState,
  finishImageResultAlbumSave,
  getImageResultAlbumSaveControlPresentation,
  getImageTaskSnapshotSummary,
  startImageResultAlbumSave,
  type ImageResultAlbumSaveControlState,
  type ImageResultAlbumSaveResult,
  type ImageResult,
  type ImageTaskHistory,
} from "../../src/image-tasks";
import { DestructiveActionButton } from "../../src/shared/DestructiveActionButton";
import {
  Pressable,
  SymbolIcon,
  Text,
  useCSSVariable,
  View,
} from "../../src/tw";
import { AppButton } from "../../src/ui/AppButton";
import { MediaFrame } from "../../src/ui/MediaFrame";
import {
  ScreenCanvas,
  ScreenScrollView,
} from "../../src/ui/ScreenCanvas";
import { SectionTitle } from "../../src/ui/SectionTitle";
import { Surface } from "../../src/ui/Surface";

type ImageDetailState =
  | { status: "loading" }
  | { status: "missing" }
  | { status: "error" }
  | {
      status: "ready";
      imageResult: ImageResult;
      imageUri: string | null;
      albumSaveControl: ImageResultAlbumSaveControlState;
      history: ImageTaskHistory | null;
    };

type ImageDeletionPhase =
  | { status: "idle" }
  | { status: "confirming"; imageResultId: string }
  | { status: "deleting"; imageResultId: string };

export default function ImageDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const runtime = useReadyAppRuntime();
  const attentionSnapshot = useBusinessCallAttentionSnapshot();
  const isFocused = useIsFocused();
  const actionColor = useCSSVariable("--app-action");
  const mutedColor = useCSSVariable("--app-ink-muted");
  const [state, setState] = useState<ImageDetailState>({ status: "loading" });
  const [reloadVersion, setReloadVersion] = useState(0);
  const [deletionError, setDeletionError] = useState<string | null>(null);
  const [deletionPhase, setDeletionPhase] = useState<ImageDeletionPhase>({
    status: "idle",
  });
  const albumSaveInFlightRef = useRef(false);
  const attentionClearInFlightRef = useRef(new Map<string, string>());
  const deletionPhaseRef = useRef<ImageDeletionPhase>({ status: "idle" });
  const mountedRef = useRef(false);
  const id = typeof params.id === "string" ? params.id : null;
  const loadedImageResultId =
    state.status === "ready" ? state.imageResult.id : null;
  const detailIdentityRef = useRef({
    isFocused,
    loadedImageResultId,
    routeImageResultId: id,
  });
  detailIdentityRef.current = {
    isFocused,
    loadedImageResultId,
    routeImageResultId: id,
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    setDeletionError(null);
    const currentPhase = deletionPhaseRef.current;
    if (
      currentPhase.status === "confirming" &&
      currentPhase.imageResultId !== id
    ) {
      updateDeletionPhase({ status: "idle" });
    }
  }, [id]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      albumSaveInFlightRef.current = false;
      setState({ status: "loading" });
      if (!id) {
        setState({ status: "missing" });
        return;
      }

      try {
        const imageResult =
          await runtime.imageTaskRepository.getImageResult(id);
        if (!imageResult) {
          if (!cancelled) {
            setState({ status: "missing" });
          }
          return;
        }

        const imageUri = await runtime.imageFileStorage
          .resolveFileUri(imageResult.filePath)
          .catch(() => null);
        const [albumSaveAvailability, history] = await Promise.all([
          runtime.imageResultAlbumSaver.getAvailability(imageUri),
          imageResult.taskHistoryId
            ? runtime.imageTaskRepository.getHistory(imageResult.taskHistoryId)
            : Promise.resolve(null),
        ]);

        if (!cancelled) {
          setState({
            status: "ready",
            imageResult,
            imageUri:
              albumSaveAvailability.status === "missingFile" ? null : imageUri,
            albumSaveControl: createImageResultAlbumSaveControlState(
              albumSaveAvailability,
            ),
            history,
          });
        }
      } catch {
        if (!cancelled) {
          setState({ status: "error" });
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [
    id,
    reloadVersion,
    runtime.imageFileStorage,
    runtime.imageResultAlbumSaver,
    runtime.imageTaskRepository,
  ]);

  const loadedImageResult =
    state.status === "ready" ? state.imageResult : null;
  const taskHistoryId = loadedImageResult?.taskHistoryId ?? null;
  const attention = taskHistoryId
    ? attentionSnapshot.imageTasks.get(taskHistoryId)
    : undefined;

  useEffect(() => {
    if (taskHistoryId && !attention) {
      attentionClearInFlightRef.current.delete(taskHistoryId);
    }
  }, [attention, taskHistoryId]);

  useEffect(() => {
    if (
      !shouldClearImageDetailAttention({
        isFocused,
        routeImageResultId: id,
        loadedImageResultId: loadedImageResult?.id ?? null,
        loadStatus: state.status,
        taskHistoryId,
        attentionKind: attention?.kind ?? null,
      }) ||
      !taskHistoryId
    ) {
      return;
    }

    const attentionCreatedAt = attention?.createdAt;
    if (
      !attentionCreatedAt ||
      attentionClearInFlightRef.current.get(taskHistoryId) ===
        attentionCreatedAt
    ) {
      return;
    }
    attentionClearInFlightRef.current.set(
      taskHistoryId,
      attentionCreatedAt,
    );

    void runtime.businessCallAttentionRepository
      .clearImageTask(taskHistoryId)
      .catch(() => {
        console.warn("[image-detail] 清除任务提示失败");
      })
      .finally(() => {
        if (
          attentionClearInFlightRef.current.get(taskHistoryId) ===
          attentionCreatedAt
        ) {
          attentionClearInFlightRef.current.delete(taskHistoryId);
        }
      });
  }, [
    attention?.createdAt,
    attention?.kind,
    id,
    isFocused,
    loadedImageResult?.id,
    runtime.businessCallAttentionRepository,
    state.status,
    taskHistoryId,
  ]);

  async function handleSaveToAlbum() {
    if (
      state.status !== "ready" ||
      !canStartImageResultAlbumSave(state.albumSaveControl) ||
      albumSaveInFlightRef.current
    ) {
      return;
    }

    albumSaveInFlightRef.current = true;
    const imageResultId = state.imageResult.id;
    const imageUri = state.imageUri;
    setState((current) =>
      current.status === "ready" && current.imageResult.id === imageResultId
        ? {
            ...current,
            albumSaveControl: startImageResultAlbumSave(
              current.albumSaveControl,
            ),
          }
        : current,
    );

    let result: ImageResultAlbumSaveResult;
    try {
      result = await runtime.imageResultAlbumSaver.save(imageUri);
    } catch (error) {
      console.warn("[image-detail] 保存到系统相册失败", error);
      result = { status: "failed", reason: "writeFailed" };
    } finally {
      albumSaveInFlightRef.current = false;
    }
    setState((current) => {
      if (
        current.status !== "ready" ||
        current.imageResult.id !== imageResultId
      ) {
        return current;
      }

      return {
        ...current,
        albumSaveControl: finishImageResultAlbumSave(
          current.albumSaveControl,
          result,
        ),
      };
    });
  }

  function updateDeletionPhase(nextPhase: ImageDeletionPhase) {
    deletionPhaseRef.current = nextPhase;
    if (mountedRef.current) {
      setDeletionPhase(nextPhase);
    }
  }

  function isSameImageDetail(imageResultId: string): boolean {
    const currentIdentity = detailIdentityRef.current;
    return (
      mountedRef.current &&
      currentIdentity.routeImageResultId === imageResultId &&
      currentIdentity.loadedImageResultId === imageResultId
    );
  }

  function isCurrentImageDetail(imageResultId: string): boolean {
    return (
      isSameImageDetail(imageResultId) &&
      detailIdentityRef.current.isFocused
    );
  }

  function releaseDeleteConfirmation(imageResultId: string) {
    const currentPhase = deletionPhaseRef.current;
    if (
      currentPhase.status === "confirming" &&
      currentPhase.imageResultId === imageResultId
    ) {
      updateDeletionPhase({ status: "idle" });
    }
  }

  function handleDeleteImageResult() {
    if (
      state.status !== "ready" ||
      deletionPhaseRef.current.status !== "idle"
    ) {
      return;
    }

    const imageResultId = state.imageResult.id;
    if (!isCurrentImageDetail(imageResultId)) {
      return;
    }

    setDeletionError(null);
    updateDeletionPhase({ status: "confirming", imageResultId });
    Alert.alert(
      "删除图片结果",
      "删除后应用内原图和图片结果记录将移除；关联任务历史以及已保存到相册或其他位置的副本不受影响。",
      [
        {
          text: "取消",
          style: "cancel",
          onPress: () => releaseDeleteConfirmation(imageResultId),
        },
        {
          text: "删除",
          style: "destructive",
          onPress: () => {
            void confirmDeleteImageResult(imageResultId);
          },
        },
      ],
      {
        cancelable: true,
        onDismiss: () => releaseDeleteConfirmation(imageResultId),
      },
    );
  }

  async function confirmDeleteImageResult(imageResultId: string) {
    const currentPhase = deletionPhaseRef.current;
    if (
      currentPhase.status !== "confirming" ||
      currentPhase.imageResultId !== imageResultId
    ) {
      return;
    }
    if (!isCurrentImageDetail(imageResultId)) {
      updateDeletionPhase({ status: "idle" });
      return;
    }

    updateDeletionPhase({ status: "deleting", imageResultId });
    try {
      await runtime.imageTaskDeletionService.deleteImageResult(imageResultId);
      updateDeletionPhase({ status: "idle" });
      if (isSameImageDetail(imageResultId)) {
        if (detailIdentityRef.current.isFocused) {
          router.replace("/");
        } else {
          setState({ status: "missing" });
        }
      }
    } catch {
      console.warn("[image-detail] 删除图片结果失败");
      updateDeletionPhase({ status: "idle" });
      if (isSameImageDetail(imageResultId)) {
        setDeletionError("删除图片结果失败，请稍后重试。");
        setReloadVersion((current) => current + 1);
      }
    }
  }

  if (state.status === "loading") {
    return (
      <ScreenCanvas variant="tool">
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={actionColor} />
        </View>
      </ScreenCanvas>
    );
  }

  if (state.status === "missing") {
    return (
      <ScreenCanvas variant="tool">
        <View className="flex-1 justify-center">
          <Surface variant="feedback">
            <Text
              className="text-center text-xl font-bold leading-7 text-app-ink"
            >
              图片结果不存在
            </Text>
          </Surface>
        </View>
      </ScreenCanvas>
    );
  }

  if (state.status === "error") {
    return (
      <ScreenCanvas variant="tool">
        <View className="flex-1 justify-center">
          <Surface tone="danger" variant="feedback">
            <Text
              className="text-center text-xl font-bold leading-7 text-app-ink"
            >
              加载失败，请返回重试
            </Text>
          </Surface>
        </View>
      </ScreenCanvas>
    );
  }

  const { history, imageResult, imageUri } = state;
  const albumSavePresentation = getImageResultAlbumSaveControlPresentation(
    state.albumSaveControl,
  );
  const aspectRatio =
    imageResult.width && imageResult.height
      ? imageResult.width / imageResult.height
      : 1;
  const imageFrame = (
    <MediaFrame
      accessibilityLabel="图片结果"
      aspectRatio={aspectRatio}
      placeholderLabel="图片文件不可用"
      uri={imageUri}
      variant="detail"
    />
  );

  return (
    <ScreenScrollView variant="tool">
      {imageUri ? (
        <View className="gap-2">
          <Pressable
            accessibilityLabel="全屏查看图片"
            accessibilityRole="button"
            onPress={() =>
              router.push(
                `/image-viewer/${encodeURIComponent(imageResult.id)}` as never,
              )
            }
          >
            {imageFrame}
          </Pressable>
          <Text
            className="text-center text-[13px] text-app-ink-muted"
          >
            轻点全屏查看，可双指缩放
          </Text>
        </View>
      ) : (
        imageFrame
      )}

      <Surface variant="panel">
        <SectionTitle>导出</SectionTitle>
        <AppButton
          disabled={albumSavePresentation.disabled}
          icon="download"
          label={albumSavePresentation.label}
          loading={albumSavePresentation.inProgress}
          onPress={handleSaveToAlbum}
        />
        {albumSavePresentation.feedback ? (
          <Text
            className={getAlbumSaveFeedbackTextClass(
              albumSavePresentation.feedback.tone,
            )}
          >
            {albumSavePresentation.feedback.message}
          </Text>
        ) : null}
      </Surface>

      <Surface variant="panel">
        <SectionTitle>图片规格</SectionTitle>
        <KeyValue
          label="创建时间"
          value={formatLocalDateTime(imageResult.createdAt)}
        />
        <KeyValue label="格式" value={imageResult.format.toUpperCase()} />
        <KeyValue label="尺寸" value={formatImageSize(imageResult)} />
      </Surface>

      <Surface variant="panel">
        <SectionTitle>关联历史</SectionTitle>
        {history ? (
          <Surface
            accessibilityLabel="打开关联任务历史"
            onPress={() =>
              router.push(`/history/${encodeURIComponent(history.id)}` as never)
            }
            variant="interactive"
          >
            <View className="flex-row items-center gap-2.5 p-3">
              <View className="flex-1 gap-1">
                <Text
                  className="text-[15px] font-bold leading-[21px] text-app-ink"
                  numberOfLines={2}
                >
                  {getImageTaskSnapshotSummary(history.snapshot)}
                </Text>
                <Text
                  className="text-[13px] tabular-nums text-app-ink-muted"
                >
                  {formatLocalDateTime(history.createdAt)}
                </Text>
              </View>
              <SymbolIcon
                className="h-[18px] w-[18px]"
                name="chevron-right"
                tintColor={mutedColor}
              />
            </View>
          </Surface>
        ) : (
          <Text className="text-[13px] text-app-ink-muted">
            未找到关联任务历史。
          </Text>
        )}
      </Surface>

      <Surface variant="panel">
        <DestructiveActionButton
          disabled={deletionPhase.status !== "idle"}
          isDeleting={
            deletionPhase.status === "deleting" &&
            deletionPhase.imageResultId === imageResult.id
          }
          label="删除图片结果"
          onPress={handleDeleteImageResult}
        />
        {deletionError ? (
          <Text
            className="text-[13px] leading-[19px] text-app-danger"
          >
            {deletionError}
          </Text>
        ) : null}
      </Surface>
    </ScreenScrollView>
  );
}

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-start gap-3">
      <Text
        className="w-[82px] text-[13px] font-bold leading-[18px] text-app-ink-muted"
      >
        {label}
      </Text>
      <Text className="flex-1 text-sm leading-5 text-app-ink">
        {value}
      </Text>
    </View>
  );
}

function getAlbumSaveFeedbackTextClass(
  tone: "success" | "error" | "muted",
): string {
  const toneClass =
    tone === "success"
      ? "text-app-success"
      : tone === "error"
        ? "text-app-danger"
        : "text-app-ink-muted";
  return `text-[13px] leading-[19px] ${toneClass}`;
}

function formatImageSize(imageResult: ImageResult): string {
  return imageResult.width && imageResult.height
    ? `${imageResult.width}x${imageResult.height}`
    : "尺寸未知";
}
