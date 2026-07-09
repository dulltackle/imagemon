import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator } from "react-native";

import { useReadyAppRuntime } from "../../src/app-state";
import {
  canStartImageResultAlbumSave,
  createImageResultAlbumSaveControlState,
  finishImageResultAlbumSave,
  getImageResultAlbumSaveControlPresentation,
  getImageTaskSnapshotSummary,
  getPromptdexSourceTypeLabel,
  getPromptdexTaskInputRows,
  getPromptdexTaskTypeLabel,
  startImageResultAlbumSave,
  type ImageResultAlbumSaveAvailability,
  type ImageResultAlbumSaveControlState,
  type ImageResultAlbumSaveResult,
  type ImageResultAlbumSaver,
  type ImageResultFileStorage,
  type ImageResult,
  type ImageTaskHistory,
  type ImageTaskInternalAttachmentSnapshot,
  type ImageTaskStatus,
  type ImageTaskInternalAttachmentStorage,
  type PromptdexImageTaskSnapshot,
} from "../../src/image-tasks";
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
  | {
      status: "ready";
      history: ImageTaskHistory;
      imageResults: ImageResult[];
    };

export default function HistoryDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const runtime = useReadyAppRuntime();
  const accentColor = useCSSVariable("--sf-blue");
  const [state, setState] = useState<HistoryDetailState>({ status: "loading" });
  const id = typeof params.id === "string" ? params.id : null;

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setState({ status: "loading" });
      if (!id) {
        setState({ status: "missing" });
        return;
      }

      const history = await runtime.imageTaskRepository.getHistory(id);
      if (!history) {
        if (!cancelled) {
          setState({ status: "missing" });
        }
        return;
      }

      const imageResults =
        await runtime.imageTaskRepository.listImageResultsForTaskHistory(id);
      if (!cancelled) {
        setState({ status: "ready", history, imageResults });
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [id, runtime.imageTaskRepository]);

  if (state.status === "loading") {
    return (
      <View className="flex-1 items-center justify-center bg-sf-bg-2 p-6">
        <ActivityIndicator color={accentColor} />
      </View>
    );
  }

  if (state.status === "missing") {
    return (
      <View className="flex-1 items-center justify-center bg-sf-bg-2 p-6">
        <Text className="text-xl font-bold text-sf-text" selectable>
          任务历史不存在
        </Text>
      </View>
    );
  }

  const { history, imageResults } = state;

  return (
    <ScrollView
      className="flex-1 bg-sf-bg-2"
      contentInsetAdjustmentBehavior="automatic"
      contentContainerClassName="gap-4 p-5 pb-8"
    >
      <View className="gap-2.5 rounded-lg border border-sf-separator bg-sf-bg-3 p-4">
        <View className="flex-row items-center gap-2">
          <Text
            className={cn(
              "overflow-hidden rounded-full px-2 py-[3px] text-xs font-extrabold",
              statusClassName(history.status),
            )}
            selectable
          >
            {statusLabel(history.status)}
          </Text>
          <Text className="text-[13px] tabular-nums text-sf-text-2" selectable>
            {formatDateTime(history.createdAt)}
          </Text>
        </View>
        <Text className="text-base leading-[23px] text-sf-text" selectable>
          {getImageTaskSnapshotSummary(history.snapshot)}
        </Text>
      </View>

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
    </ScrollView>
  );
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
          <Text className="text-[15px] font-extrabold text-sf-text" selectable>
            {formatImageSpec(imageResult)}
          </Text>
          <Text className="text-[13px] tabular-nums text-sf-text-2" selectable>
            {formatDateTime(imageResult.createdAt)}
          </Text>
        </View>
        <SymbolIcon
          className="h-[18px] w-[18px]"
          name="chevron.right"
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
            name="square.and.arrow.down"
            tintColor={
              albumSavePresentation.disabled ? mutedColor : accentColor
            }
          />
        )}
        <Text
          className={cn(
            "text-[13px] font-extrabold",
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
        className="w-[82px] text-[13px] font-bold text-sf-text-2"
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
    <Text className="text-[17px] font-extrabold text-sf-text" selectable>
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

      <View className="gap-2.5 rounded-lg border border-sf-separator bg-sf-bg-3 p-4">
        <SectionTitle>完整提示词</SectionTitle>
        <Text className="text-sm leading-[21px] text-sf-text" selectable>
          {snapshot.fullPrompt}
        </Text>
      </View>
    </>
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

function statusClassName(status: ImageTaskStatus) {
  switch (status) {
    case "completed":
      return "bg-sf-fill text-sf-green";
    case "failed":
      return "bg-sf-fill text-sf-red";
    case "running":
      return "bg-sf-fill text-sf-blue";
    case "unknown":
      return "bg-sf-fill text-sf-text-2";
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

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
