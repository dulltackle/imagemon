import * as Clipboard from "expo-clipboard";
import { useIsFocused } from "@react-navigation/native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert } from "react-native";

import { useReadyAppRuntime } from "../../src/app-state";
import {
  shouldClearHistoryDetailAttention,
  useBusinessCallAttentionSnapshot,
} from "../../src/business-call-attentions";
import {
  CLIPBOARD_COPY_DEBOUNCE_MS,
  createClipboardCopyControlState,
  finishClipboardCopy,
  getClipboardCopyControlPresentation,
  releaseClipboardCopy,
  startClipboardCopy,
  type ClipboardCopyResult,
} from "../../src/clipboard/copy-control";
import { formatLocalDateTime } from "../../src/formatters/date-time";
import {
  canStartImageResultAlbumSave,
  createImageResultAlbumSaveControlState,
  finishImageResultAlbumSave,
  getImageResultAlbumSaveControlPresentation,
  getImageTaskSnapshotSummary,
  getPromptdexSourceTypeLabel,
  getPromptdexTaskInputRows,
  getPromptdexTaskTypeLabel,
  resolveTaskRefill,
  startImageResultAlbumSave,
  type ImageResultAlbumSaveAvailability,
  type ImageResultAlbumSaveControlState,
  type ImageResultAlbumSaveResult,
  type ImageResultAlbumSaver,
  type ImageResultFileStorage,
  type ImageResult,
  ImageTaskRepositoryError,
  type ImageTaskHistory,
  type ImageTaskInternalAttachmentSnapshot,
  type ImageTaskStatus,
  type ImageTaskInternalAttachmentStorage,
  type PromptdexImageTaskSnapshot,
  type TaskRefillIneligibleReason,
} from "../../src/image-tasks";
import { useModelCallLock } from "../../src/model-calls";
import type { MergedPromptdexCatalogEntry } from "../../src/promptdex";
import { DestructiveActionButton } from "../../src/shared/DestructiveActionButton";
import {
  cn,
  Image,
  Pressable,
  ScrollView,
  SymbolIcon,
  Text,
  useCSSVariable,
  View,
} from "../../src/tw";

type HistoryImageResultItemState =
  | { status: "loading" }
  | {
      status: "ready";
      imageUri: string | null;
      albumSaveControl: ImageResultAlbumSaveControlState;
    };

type HistoryDetailState =
  | { status: "loading" }
  | { status: "missing" }
  | { status: "error" }
  | {
      status: "ready";
      history: ImageTaskHistory;
      imageResults: ImageResult[];
      /** 快照对应的当前图鉴条目；条目已删除或非图鉴任务时为 null。 */
      entry: MergedPromptdexCatalogEntry | null;
    };

type HistoryDeletionPhase =
  | { status: "idle" }
  | { status: "confirming"; attemptKey: string; historyId: string }
  | { status: "deleting"; attemptKey: string; historyId: string };

const RUNNING_HISTORY_DELETION_NOTE =
  "图片任务进行中，完成后才能删除这条任务历史。";
const GENERATE_HISTORY_DELETION_MESSAGE =
  "删除后任务快照和完整提示词将从本机移除；关联图片结果会保留。";
const EDIT_HISTORY_DELETION_MESSAGE =
  "这条历史保存的内部输入附件也会删除；原相册文件不受影响。";
const GENERIC_HISTORY_DELETION_ERROR = "删除任务历史失败，请稍后重试。";

const REFILL_INELIGIBLE_NOTES: Partial<
  Record<TaskRefillIneligibleReason, string>
> = {
  entry_missing: "当前图鉴条目已不存在，无法重新填写。",
  entry_incompatible:
    "当前图鉴条目的输入声明已变更，无法从这条历史预填。",
};

export default function HistoryDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const runtime = useReadyAppRuntime();
  const modelCallLock = useModelCallLock();
  const attentionSnapshot = useBusinessCallAttentionSnapshot();
  const isFocused = useIsFocused();
  const accentColor = useCSSVariable("--sf-blue");
  const [state, setState] = useState<HistoryDetailState>({ status: "loading" });
  const [deletionPhase, setDeletionPhase] = useState<HistoryDeletionPhase>({
    status: "idle",
  });
  const [deletionError, setDeletionError] = useState<string | null>(null);
  const [reloadRevision, setReloadRevision] = useState(0);
  const attentionClearInFlightRef = useRef(new Map<string, string>());
  const deletionAttemptRef = useRef(0);
  const deletionPhaseRef = useRef<HistoryDeletionPhase>({ status: "idle" });
  const isMountedRef = useRef(true);
  const id = typeof params.id === "string" ? params.id : null;
  const loadedHistoryId = state.status === "ready" ? state.history.id : null;
  const activeHistoryCallId =
    id && modelCallLock.activeCall?.context?.historyId === id
      ? modelCallLock.activeCall.id
      : null;
  const currentDetailRef = useRef({
    isFocused,
    loadedHistoryId,
    routeHistoryId: id,
  });
  currentDetailRef.current = {
    isFocused,
    loadedHistoryId,
    routeHistoryId: id,
  };

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      deletionPhaseRef.current = { status: "idle" };
    };
  }, []);

  useEffect(() => {
    setDeletionError(null);
  }, [id]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setState({ status: "loading" });
      if (!id) {
        setState({ status: "missing" });
        return;
      }

      try {
        const history = await runtime.imageTaskRepository.getHistory(id);
        if (!history) {
          if (!cancelled) {
            setState({ status: "missing" });
          }
          return;
        }

        const [imageResults, entry] = await Promise.all([
          runtime.imageTaskRepository.listImageResultsForTaskHistory(id),
          history.snapshot.source === "promptdex"
            ? runtime.promptdexCatalogService.get(
                history.snapshot.promptdexEntry.name,
              )
            : Promise.resolve(null),
        ]);
        if (!cancelled) {
          setState({ status: "ready", history, imageResults, entry });
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
    activeHistoryCallId,
    id,
    reloadRevision,
    runtime.imageTaskRepository,
    runtime.promptdexCatalogService,
  ]);

  const loadedHistory = state.status === "ready" ? state.history : null;
  const attention = id ? attentionSnapshot.imageTasks.get(id) : undefined;

  useEffect(() => {
    if (id && !attention) {
      attentionClearInFlightRef.current.delete(id);
    }
  }, [attention, id]);

  useEffect(() => {
    if (
      !shouldClearHistoryDetailAttention({
        isFocused,
        routeHistoryId: id,
        loadedHistoryId: loadedHistory?.id ?? null,
        loadStatus: state.status,
        taskStatus: loadedHistory?.status ?? null,
        hasActiveCall: activeHistoryCallId !== null,
        attentionKind: attention?.kind ?? null,
      }) ||
      !id
    ) {
      return;
    }

    const attentionCreatedAt = attention?.createdAt;
    if (
      !attentionCreatedAt ||
      attentionClearInFlightRef.current.get(id) === attentionCreatedAt
    ) {
      return;
    }
    attentionClearInFlightRef.current.set(id, attentionCreatedAt);

    void runtime.businessCallAttentionRepository
      .clearImageTask(id)
      .catch(() => {
        console.warn("[history-detail] 清除任务提示失败");
      })
      .finally(() => {
        if (
          attentionClearInFlightRef.current.get(id) === attentionCreatedAt
        ) {
          attentionClearInFlightRef.current.delete(id);
        }
      });
  }, [
    activeHistoryCallId,
    attention?.createdAt,
    attention?.kind,
    id,
    isFocused,
    loadedHistory?.id,
    loadedHistory?.status,
    runtime.businessCallAttentionRepository,
    state.status,
  ]);

  function updateDeletionPhase(nextPhase: HistoryDeletionPhase) {
    deletionPhaseRef.current = nextPhase;
    if (isMountedRef.current) {
      setDeletionPhase(nextPhase);
    }
  }

  function isCurrentHistoryDetail(historyId: string): boolean {
    return (
      isSameHistoryDetail(historyId) && currentDetailRef.current.isFocused
    );
  }

  function isSameHistoryDetail(historyId: string): boolean {
    const current = currentDetailRef.current;
    return (
      isMountedRef.current &&
      current.routeHistoryId === historyId &&
      current.loadedHistoryId === historyId
    );
  }

  function releaseDeletionConfirmation(attemptKey: string) {
    const phase = deletionPhaseRef.current;
    if (phase.status === "confirming" && phase.attemptKey === attemptKey) {
      updateDeletionPhase({ status: "idle" });
    }
  }

  function handleDeleteHistory(history: ImageTaskHistory) {
    if (
      history.status === "running" ||
      deletionPhaseRef.current.status !== "idle" ||
      !isCurrentHistoryDetail(history.id)
    ) {
      return;
    }

    const capturedId = history.id;
    const attemptKey = `${capturedId}:${++deletionAttemptRef.current}`;
    const message =
      history.taskType === "edit"
        ? `${GENERATE_HISTORY_DELETION_MESSAGE}\n\n${EDIT_HISTORY_DELETION_MESSAGE}`
        : GENERATE_HISTORY_DELETION_MESSAGE;
    updateDeletionPhase({
      status: "confirming",
      attemptKey,
      historyId: capturedId,
    });

    Alert.alert(
      "删除任务历史",
      message,
      [
        {
          text: "取消",
          style: "cancel",
          onPress: () => {
            releaseDeletionConfirmation(attemptKey);
          },
        },
        {
          text: "删除",
          style: "destructive",
          onPress: () => {
            const phase = deletionPhaseRef.current;
            if (
              phase.status !== "confirming" ||
              phase.attemptKey !== attemptKey ||
              phase.historyId !== capturedId ||
              !isCurrentHistoryDetail(capturedId)
            ) {
              releaseDeletionConfirmation(attemptKey);
              return;
            }

            updateDeletionPhase({
              status: "deleting",
              attemptKey,
              historyId: capturedId,
            });
            setDeletionError(null);
            void deleteHistory(attemptKey, capturedId);
          },
        },
      ],
      {
        cancelable: true,
        onDismiss: () => {
          releaseDeletionConfirmation(attemptKey);
        },
      },
    );
  }

  async function deleteHistory(attemptKey: string, capturedId: string) {
    try {
      await runtime.imageTaskDeletionService.deleteHistory(capturedId);
      if (
        deletionPhaseRef.current.status === "deleting" &&
        deletionPhaseRef.current.attemptKey === attemptKey &&
        deletionPhaseRef.current.historyId === capturedId &&
        isSameHistoryDetail(capturedId)
      ) {
        if (currentDetailRef.current.isFocused) {
          router.replace("/history");
        } else {
          setState({ status: "missing" });
        }
      }
    } catch (error) {
      if (
        deletionPhaseRef.current.status === "deleting" &&
        deletionPhaseRef.current.attemptKey === attemptKey &&
        deletionPhaseRef.current.historyId === capturedId &&
        isSameHistoryDetail(capturedId)
      ) {
        setDeletionError(getHistoryDeletionErrorMessage(error));
        setReloadRevision((current) => current + 1);
      }
    } finally {
      const phase = deletionPhaseRef.current;
      if (
        phase.status === "deleting" &&
        phase.attemptKey === attemptKey &&
        phase.historyId === capturedId
      ) {
        updateDeletionPhase({ status: "idle" });
      }
    }
  }

  if (state.status === "loading") {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-sf-bg-2 p-6">
        <ActivityIndicator color={accentColor} />
        {deletionError ? (
          <Text className="text-sm leading-5 text-sf-red" selectable>
            {deletionError}
          </Text>
        ) : null}
      </View>
    );
  }

  if (state.status === "missing") {
    return (
      <View className="flex-1 items-center justify-center bg-sf-bg-2 p-6">
        <Text className="text-xl font-bold leading-7 text-sf-text" selectable>
          任务历史不存在
        </Text>
        {deletionError ? (
          <Text className="text-sm leading-5 text-sf-red" selectable>
            {deletionError}
          </Text>
        ) : null}
      </View>
    );
  }

  if (state.status === "error") {
    return (
      <View className="flex-1 items-center justify-center bg-sf-bg-2 p-6">
        <Text className="text-xl font-bold leading-7 text-sf-text" selectable>
          加载失败，请返回重试
        </Text>
        {deletionError ? (
          <Text className="text-sm leading-5 text-sf-red" selectable>
            {deletionError}
          </Text>
        ) : null}
      </View>
    );
  }

  const { history, imageResults, entry } = state;
  const refill = resolveTaskRefill({ history, entry });
  const refillIneligibleNote =
    refill.status === "ineligible"
      ? REFILL_INELIGIBLE_NOTES[refill.reason]
      : undefined;

  return (
    <ScrollView
      className="flex-1 bg-sf-bg-2"
      contentInsetAdjustmentBehavior="automatic"
      contentContainerClassName="gap-4 p-5 pb-8"
    >
      <View className="gap-2.5 rounded-lg border border-sf-separator bg-sf-bg-3 p-4">
        <View className="flex-row items-center gap-2">
          <StatusBadge status={history.status} />
          <Text
            className="text-[13px] leading-[18px] tabular-nums text-sf-text-2"
            selectable
          >
            {formatLocalDateTime(history.createdAt)}
          </Text>
        </View>
        <Text className="text-base leading-[23px] text-sf-text" selectable>
          {getImageTaskSnapshotSummary(history.snapshot)}
        </Text>
      </View>

      {activeHistoryCallId ? (
        <View className="flex-row items-center gap-3 rounded-lg border border-sf-blue bg-sf-bg-3 p-4">
          <ActivityIndicator color={accentColor} />
          <View className="flex-1 gap-1">
            <Text className="text-[15px] font-bold leading-[21px] text-sf-text" selectable>
              图片任务进行中
            </Text>
            <Text className="text-[13px] leading-[18px] text-sf-text-2" selectable>
              完成后，此页面会自动更新任务状态和图片结果。
            </Text>
          </View>
        </View>
      ) : null}

      {history.snapshot.source === "promptdex" ? (
        <PromptdexSnapshotSections
          attachmentStorage={runtime.imageTaskAttachmentStorage}
          snapshot={history.snapshot}
        />
      ) : null}

      <View className="gap-2.5 rounded-lg border border-sf-separator bg-sf-bg-3 p-4">
        <SectionTitle>图片规格</SectionTitle>
        <KeyValue label="尺寸" value={history.snapshot.imageSpec.size} />
        <KeyValue label="质量" value={history.snapshot.imageSpec.quality} />
        <KeyValue
          label="格式"
          value={history.snapshot.imageSpec.format.toUpperCase()}
        />
        <KeyValue label="数量" value={String(history.snapshot.imageSpec.n)} />
      </View>

      <View className="gap-2.5 rounded-lg border border-sf-separator bg-sf-bg-3 p-4">
        <SectionTitle>模型配置快照</SectionTitle>
        <KeyValue label="类型" value="图片模型" />
        <KeyValue
          label="模型"
          value={history.snapshot.modelConfiguration.modelName}
        />
        <KeyValue
          label="Base URL"
          value={history.snapshot.modelConfiguration.baseUrl}
        />
      </View>

      {history.errorSummary ? (
        <View className="gap-2.5 rounded-lg border border-sf-red bg-sf-bg-3 p-4">
          <SectionTitle>失败摘要</SectionTitle>
          <Text className="text-[15px] leading-[22px] text-sf-text" selectable>
            {history.errorSummary.message}
          </Text>
          <KeyValue label="原因" value={history.errorSummary.reason} />
          {history.errorSummary.statusCode ? (
            <KeyValue
              label="HTTP"
              value={String(history.errorSummary.statusCode)}
            />
          ) : null}
          {history.errorSummary.providerCode ? (
            <KeyValue
              label="平台码"
              value={history.errorSummary.providerCode}
            />
          ) : null}
        </View>
      ) : null}

      {refill.status === "eligible" ? (
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            router.push({
              pathname: "/promptdex/[name]",
              params: {
                name: refill.plan.entryName,
                refillFromHistory: history.id,
              },
            })
          }
          className="min-h-12 items-center justify-center rounded-lg bg-sf-blue px-4 active:opacity-75"
        >
          <Text
            className="text-base font-bold leading-[22px] text-white"
            selectable
          >
            重新填写
          </Text>
        </Pressable>
      ) : refillIneligibleNote ? (
        <Text className="text-[13px] leading-[18px] text-sf-text-2" selectable>
          {refillIneligibleNote}
        </Text>
      ) : null}

      {history.status === "completed" ? (
        <View className="gap-2.5 rounded-lg border border-sf-separator bg-sf-bg-3 p-4">
          <SectionTitle>关联图片</SectionTitle>
          {imageResults.length === 0 ? (
            <Text className="text-[13px] text-sf-text-2" selectable>
              未找到关联图片结果。
            </Text>
          ) : (
            imageResults.map((imageResult) => (
              <HistoryImageResultItem
                albumSaver={runtime.imageResultAlbumSaver}
                fileStorage={runtime.imageFileStorage}
                imageResult={imageResult}
                key={imageResult.id}
                onOpen={() =>
                  router.push(
                    `/images/${encodeURIComponent(imageResult.id)}` as never,
                  )
                }
              />
            ))
          )}
        </View>
      ) : null}

      <View className="gap-3 rounded-lg border border-sf-red bg-sf-bg-3 p-4">
        <SectionTitle>删除任务历史</SectionTitle>
        {history.status === "running" ? (
          <Text className="text-[13px] leading-[19px] text-sf-text-2" selectable>
            {RUNNING_HISTORY_DELETION_NOTE}
          </Text>
        ) : null}
        <DestructiveActionButton
          disabled={
            history.status === "running" || deletionPhase.status !== "idle"
          }
          isDeleting={
            deletionPhase.status === "deleting" &&
            deletionPhase.historyId === history.id
          }
          label="删除任务历史"
          onPress={() => {
            handleDeleteHistory(history);
          }}
        />
        {deletionError ? (
          <Text className="text-sm leading-5 text-sf-red" selectable>
            {deletionError}
          </Text>
        ) : null}
      </View>
    </ScrollView>
  );
}

function getHistoryDeletionErrorMessage(error: unknown): string {
  if (
    error instanceof ImageTaskRepositoryError &&
    error.code === "invalid_state"
  ) {
    return RUNNING_HISTORY_DELETION_NOTE;
  }
  return GENERIC_HISTORY_DELETION_ERROR;
}

function HistoryImageResultItem({
  albumSaver,
  fileStorage,
  imageResult,
  onOpen,
}: {
  albumSaver: ImageResultAlbumSaver;
  fileStorage: ImageResultFileStorage;
  imageResult: ImageResult;
  onOpen(): void;
}) {
  const [state, setState] = useState<HistoryImageResultItemState>({
    status: "loading",
  });
  const accentColor = useCSSVariable("--sf-blue");
  const mutedColor = useCSSVariable("--sf-text-2");
  const albumSaveInFlightRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      albumSaveInFlightRef.current = false;
      setState({ status: "loading" });
      const imageUri = await fileStorage
        .resolveFileUri(imageResult.filePath)
        .catch(() => null);
      let albumSaveAvailability: ImageResultAlbumSaveAvailability;
      try {
        albumSaveAvailability = await albumSaver.getAvailability(imageUri);
      } catch (error) {
        console.warn("[history-image] 读取相册保存可用性失败", error);
        albumSaveAvailability = { status: "unsupported" };
      }
      if (!cancelled) {
        setState({
          status: "ready",
          imageUri:
            albumSaveAvailability.status === "missingFile" ? null : imageUri,
          albumSaveControl: createImageResultAlbumSaveControlState(
            albumSaveAvailability,
          ),
        });
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [albumSaver, fileStorage, imageResult.filePath, imageResult.id]);

  async function handleSaveToAlbum() {
    if (
      state.status !== "ready" ||
      !canStartImageResultAlbumSave(state.albumSaveControl) ||
      albumSaveInFlightRef.current
    ) {
      return;
    }

    albumSaveInFlightRef.current = true;
    setState((current) =>
      current.status === "ready"
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
      result = await albumSaver.save(state.imageUri);
    } catch (error) {
      console.warn("[history-image] 保存到系统相册失败", error);
      result = { status: "failed", reason: "writeFailed" };
    } finally {
      albumSaveInFlightRef.current = false;
    }
    setState((current) => {
      if (current.status !== "ready") {
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

  const albumSavePresentation = getImageResultAlbumSaveControlPresentation(
    state.status === "ready" ? state.albumSaveControl : { status: "checking" },
  );

  return (
    <View className="gap-2.5 rounded-lg border border-sf-separator p-3">
      <Pressable
        accessibilityRole="button"
        onPress={onOpen}
        className="flex-row items-center gap-2.5 active:opacity-75"
      >
        <View className="flex-1 gap-[3px]">
          <Text
            className="text-[15px] font-extrabold leading-[21px] text-sf-text"
            selectable
          >
            {formatImageSpec(imageResult)}
          </Text>
          <Text className="text-[13px] tabular-nums text-sf-text-2" selectable>
            {formatLocalDateTime(imageResult.createdAt)}
          </Text>
        </View>
        <SymbolIcon
          className="h-[18px] w-[18px]"
          name="chevron-right"
          tintColor={mutedColor}
        />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        disabled={albumSavePresentation.disabled}
        onPress={handleSaveToAlbum}
        className={cn(
          "min-h-9 flex-row items-center self-start justify-center gap-1.5 rounded-lg border border-sf-blue px-2.5 py-[7px] active:opacity-75",
          albumSavePresentation.disabled && "border-sf-separator bg-sf-fill",
        )}
      >
        {albumSavePresentation.inProgress ? (
          <ActivityIndicator color={accentColor} />
        ) : (
          <SymbolIcon
            className="h-4 w-4"
            name="download"
            tintColor={
              albumSavePresentation.disabled ? mutedColor : accentColor
            }
          />
        )}
        <Text
          className={cn(
            "text-[13px] font-extrabold leading-[18px]",
            albumSavePresentation.disabled ? "text-sf-text-2" : "text-sf-blue",
          )}
        >
          {albumSavePresentation.label}
        </Text>
      </Pressable>
      {albumSavePresentation.feedback ? (
        <Text
          className={cn(
            "text-[13px] leading-[19px]",
            albumSavePresentation.feedback.tone === "success" &&
              "text-sf-green",
            albumSavePresentation.feedback.tone === "error" && "text-sf-red",
            albumSavePresentation.feedback.tone === "muted" && "text-sf-text-2",
          )}
          selectable
        >
          {albumSavePresentation.feedback.message}
        </Text>
      ) : null}
    </View>
  );
}

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-start gap-3">
      <Text
        className="w-[82px] text-[13px] font-bold leading-[18px] text-sf-text-2"
        selectable
      >
        {label}
      </Text>
      <Text className="flex-1 text-sm leading-5 text-sf-text" selectable>
        {value}
      </Text>
    </View>
  );
}

function SectionTitle({ children }: { children: string }) {
  return (
    <Text className="text-[17px] font-extrabold leading-6 text-sf-text" selectable>
      {children}
    </Text>
  );
}

function PromptdexSnapshotSections({
  attachmentStorage,
  snapshot,
}: {
  attachmentStorage: ImageTaskInternalAttachmentStorage;
  snapshot: PromptdexImageTaskSnapshot;
}) {
  const taskInputRows = getPromptdexTaskInputRows(snapshot);

  return (
    <>
      <View className="gap-2.5 rounded-lg border border-sf-separator bg-sf-bg-3 p-4">
        <SectionTitle>图鉴条目</SectionTitle>
        <KeyValue label="名称" value={snapshot.promptdexEntry.name} />
        <KeyValue
          label="来源"
          value={getPromptdexSourceTypeLabel(
            snapshot.promptdexEntry.sourceType,
          )}
        />
        <KeyValue
          label="类型"
          value={getPromptdexTaskTypeLabel(snapshot.promptdexEntry.taskType)}
        />
        <Text className="text-sm leading-[21px] text-sf-text" selectable>
          {snapshot.promptdexEntry.description}
        </Text>
      </View>

      <View className="gap-2.5 rounded-lg border border-sf-separator bg-sf-bg-3 p-4">
        <SectionTitle>任务输入</SectionTitle>
        {taskInputRows.length === 0 ? (
          <Text className="text-[13px] text-sf-text-2" selectable>
            未填写模板输入。
          </Text>
        ) : (
          taskInputRows.map((row) => (
            <KeyValue key={row.name} label={row.name} value={row.value} />
          ))
        )}
      </View>

      {snapshot.promptdexEntry.taskType === "edit" ? (
        <PromptdexEditInputAttachmentSection
          attachmentStorage={attachmentStorage}
          snapshot={snapshot}
        />
      ) : null}

      <FullPromptSection fullPrompt={snapshot.fullPrompt} />
    </>
  );
}

const FULL_PROMPT_COPY_MESSAGES = {
  success: "完整提示词已复制。",
  failure: "无法复制到剪贴板，请稍后重试。",
};

function FullPromptSection({ fullPrompt }: { fullPrompt: string }) {
  const accentColor = useCSSVariable("--sf-blue");
  const releaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);
  const isCopyingRef = useRef(false);
  const [copyState, setCopyState] = useState(
    createClipboardCopyControlState,
  );
  const presentation = getClipboardCopyControlPresentation(copyState);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      if (releaseTimerRef.current !== null) {
        clearTimeout(releaseTimerRef.current);
      }
    };
  }, []);

  async function handleCopy() {
    if (isCopyingRef.current) {
      return;
    }

    const copyingState = startClipboardCopy(copyState);
    if (copyingState === copyState) {
      return;
    }

    const startedAt = Date.now();
    isCopyingRef.current = true;
    setCopyState(copyingState);

    let result: ClipboardCopyResult;
    try {
      await Clipboard.setStringAsync(fullPrompt);
      result = { status: "copied" };
    } catch (error) {
      console.warn("无法复制历史完整提示词", error);
      result = { status: "failed" };
    }

    if (!isMountedRef.current || !isCopyingRef.current) {
      return;
    }

    setCopyState((current) =>
      finishClipboardCopy(current, result, FULL_PROMPT_COPY_MESSAGES),
    );
    releaseTimerRef.current = setTimeout(
      () => {
        releaseTimerRef.current = null;
        isCopyingRef.current = false;
        if (isMountedRef.current) {
          setCopyState((current) => releaseClipboardCopy(current));
        }
      },
      Math.max(
        0,
        CLIPBOARD_COPY_DEBOUNCE_MS - (Date.now() - startedAt),
      ),
    );
  }

  return (
    <View className="gap-2.5 rounded-lg border border-sf-separator bg-sf-bg-3 p-4">
      <View className="flex-row items-center justify-between gap-3">
        <SectionTitle>完整提示词</SectionTitle>
        <Pressable
          accessibilityLabel="复制完整提示词"
          accessibilityRole="button"
          accessibilityState={{
            busy: presentation.inProgress,
            disabled: presentation.inProgress,
          }}
          className="min-h-11 flex-row items-center gap-1.5 rounded-lg border border-sf-separator px-3 active:opacity-75 disabled:opacity-50"
          disabled={presentation.inProgress}
          onPress={() => void handleCopy()}
        >
          {presentation.inProgress ? (
            <ActivityIndicator color={accentColor} />
          ) : (
            <SymbolIcon
              className="h-[18px] w-[18px]"
              name="copy"
              tintColor={accentColor}
            />
          )}
          <Text className="text-[13px] font-bold text-sf-blue" selectable>
            复制
          </Text>
        </Pressable>
      </View>
      <Text className="text-sm leading-[21px] text-sf-text" selectable>
        {fullPrompt}
      </Text>
      {presentation.feedback ? (
        <Text
          className={cn(
            "text-[13px] leading-[18px]",
            presentation.feedback.tone === "success" && "text-sf-green",
            presentation.feedback.tone === "error" && "text-sf-red",
          )}
          selectable
        >
          {presentation.feedback.message}
        </Text>
      ) : null}
    </View>
  );
}

type AttachmentPreviewState =
  | { status: "missing" }
  | { status: "loading" }
  | { status: "ready"; uri: string };

function PromptdexEditInputAttachmentSection({
  attachmentStorage,
  snapshot,
}: {
  attachmentStorage: ImageTaskInternalAttachmentStorage;
  snapshot: PromptdexImageTaskSnapshot;
}) {
  const attachment = snapshot.inputAttachments?.image;
  const accentColor = useCSSVariable("--sf-blue");
  const [state, setState] = useState<AttachmentPreviewState>(
    attachment ? { status: "loading" } : { status: "missing" },
  );

  useEffect(() => {
    let cancelled = false;

    async function resolveAttachment() {
      if (!attachment) {
        setState({ status: "missing" });
        return;
      }

      setState({ status: "loading" });
      try {
        const uri = await attachmentStorage.resolveAttachmentUri(
          attachment.filePath,
        );
        if (!cancelled) {
          setState({ status: "ready", uri });
        }
      } catch {
        if (!cancelled) {
          setState({ status: "missing" });
        }
      }
    }

    void resolveAttachment();

    return () => {
      cancelled = true;
    };
  }, [attachment, attachmentStorage]);

  return (
    <View className="gap-2.5 rounded-lg border border-sf-separator bg-sf-bg-3 p-4">
      <SectionTitle>编辑输入</SectionTitle>
      {state.status === "loading" ? (
        <View className="flex-row items-center gap-2.5">
          <ActivityIndicator color={accentColor} />
          <Text className="text-[13px] text-sf-text-2" selectable>
            正在读取输入图片。
          </Text>
        </View>
      ) : null}
      {state.status === "missing" || !attachment ? (
        <Text className="text-[13px] text-sf-text-2" selectable>
          输入图片文件缺失。
        </Text>
      ) : null}
      {state.status === "ready" && attachment ? (
        <AttachmentPreview attachment={attachment} uri={state.uri} />
      ) : null}
    </View>
  );
}

function AttachmentPreview({
  attachment,
  uri,
}: {
  attachment: ImageTaskInternalAttachmentSnapshot;
  uri: string;
}) {
  return (
    <View className="flex-row items-start gap-3.5">
      <Image
        className="aspect-square w-28 rounded-lg bg-sf-fill object-cover"
        source={{ uri }}
      />
      <View className="flex-1 gap-2.5">
        <KeyValue
          label="文件名"
          value={attachment.originalFileName ?? "未知文件名"}
        />
        <KeyValue label="尺寸" value={formatAttachmentDimensions(attachment)} />
        <KeyValue label="大小" value={formatAttachmentByteSize(attachment)} />
      </View>
    </View>
  );
}

function statusLabel(status: ImageTaskStatus): string {
  switch (status) {
    case "running":
      return "进行中";
    case "completed":
      return "完成";
    case "failed":
      return "失败";
    case "unknown":
      return "状态未知";
  }
}

function StatusBadge({ status }: { status: ImageTaskStatus }) {
  return (
    <View className="min-h-[22px] shrink-0 items-center justify-center rounded-full bg-sf-fill px-2">
      <Text
        className={cn(
          "text-xs font-extrabold leading-4",
          statusTextClassName(status),
        )}
        selectable
      >
        {statusLabel(status)}
      </Text>
    </View>
  );
}

function statusTextClassName(status: ImageTaskStatus) {
  switch (status) {
    case "completed":
      return "text-sf-green";
    case "failed":
      return "text-sf-red";
    case "running":
      return "text-sf-blue";
    case "unknown":
      return "text-sf-text-2";
  }
}

function formatImageSpec(imageResult: ImageResult): string {
  const size =
    imageResult.width && imageResult.height
      ? `${imageResult.width}x${imageResult.height}`
      : "尺寸未知";
  return `${size} · ${imageResult.format.toUpperCase()}`;
}

function formatAttachmentDimensions(
  attachment: ImageTaskInternalAttachmentSnapshot,
): string {
  return attachment.width && attachment.height
    ? `${attachment.width}x${attachment.height}`
    : "未知尺寸";
}

function formatAttachmentByteSize(
  attachment: ImageTaskInternalAttachmentSnapshot,
): string {
  if (attachment.byteSize === null) {
    return "未知大小";
  }
  if (attachment.byteSize >= 1024 * 1024) {
    return `${(attachment.byteSize / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(attachment.byteSize / 1024))} KB`;
}
