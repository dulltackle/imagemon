import {
  serializePromptdexTemplateMarkdown,
  type PromptdexTemplate,
} from "@imagemon/core";
import { useIsFocused } from "@react-navigation/native";
import * as Clipboard from "expo-clipboard";
import * as ImagePicker from "expo-image-picker";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Keyboard, Modal } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useReadyAppRuntime } from "../app-state";
import {
  getImageTaskAttentionLabel,
  shouldClearRenderedEntryTaskAttention,
  useBusinessCallAttentionSnapshot,
  type BusinessCallAttention,
} from "../business-call-attentions";
import { formatLocalDateTime } from "../formatters/date-time";
import {
  IMAGE_TASK_AVAILABLE_SIZES,
  createPromptdexImageEditTaskService,
  createPromptdexImageGenerationTaskService,
  failureMessage,
  getImageTaskSizeLabel,
  normalizePickedEditInputImage,
  resolveTaskRefill,
  type ImageResult,
  type ImageResultFileStorage,
  type ImageTaskFailureSummary,
  type ImageTaskSize,
  type PickedEditInputImage,
} from "../image-tasks";
import {
  getPromptdexEntryModelCallOwnerKey,
  useModelCallLock,
} from "../model-calls";
import type { ModelConfiguration } from "../model-configurations";
import { DestructiveActionButton } from "../shared/DestructiveActionButton";
import {
  getTextPromptdexInputs,
  type MergedPromptdexCatalogEntry,
} from "./index";
import { getTaskSubmitState } from "./task-form-submit-state";
import {
  compareImageResultDescending,
  createPromptdexHomeService,
  getPromptdexHomeEntryKey,
  type PromptdexHomeEntryImage,
} from "./home";
import {
  PROMPTDEX_MARKDOWN_COPY_DEBOUNCE_MS,
  createPromptdexMarkdownCopyControlState,
  finishPromptdexMarkdownCopy,
  getPromptdexMarkdownCopyControlPresentation,
  releasePromptdexMarkdownCopy,
  startPromptdexMarkdownCopy,
  type PromptdexMarkdownCopyResult,
} from "./markdown-copy-control";
import {
  cn,
  Pressable,
  ScrollView,
  SymbolIcon,
  Text,
  TextInput,
  useCSSVariable,
  View,
} from "../tw";
import { AppButton } from "../ui/AppButton";
import { Badge } from "../ui/Badge";
import { MediaFrame } from "../ui/MediaFrame";
import { ScreenCanvas } from "../ui/ScreenCanvas";
import { SectionTitle } from "../ui/SectionTitle";
import { Surface } from "../ui/Surface";

type DetailState =
  | { status: "loading" }
  | { status: "missing" }
  | { status: "failed"; message: string }
  | {
      status: "ready";
      entry: MergedPromptdexCatalogEntry;
      images: HydratedPromptdexEntryImage[];
    };

interface HydratedPromptdexEntryImage extends PromptdexHomeEntryImage {
  imageUri: string | null;
}

interface RenderedEntryTaskResult {
  readonly callId: string;
  readonly entryKey: string;
  readonly entryName: string;
  readonly historyId: string;
  readonly kind: "succeeded" | "failed";
  readonly failure: ImageTaskFailureSummary | null;
  readonly hasRendered: boolean;
  readonly hasObservedAttention: boolean;
}

interface PersonalEntryDeletionTarget {
  readonly attemptKey: string;
  readonly entry: MergedPromptdexCatalogEntry;
  readonly entryKey: string;
  readonly entryName: string;
  readonly routeName: string;
}

type PersonalEntryDeletionPhase =
  | { readonly status: "idle" }
  | {
      readonly status: "confirming" | "deleting";
      readonly target: PersonalEntryDeletionTarget;
    };

interface PersonalEntryDeletionRouteContext {
  readonly entry: MergedPromptdexCatalogEntry | null;
  readonly isFocused: boolean;
  readonly routeName: string | null;
}

interface EntryNotice {
  readonly message: string;
  readonly tone: "neutral" | "success" | "warning";
}

export function PromptdexEntryDetailScreen() {
  const params = useLocalSearchParams<{
    name?: string;
    refillFromHistory?: string;
  }>();
  const router = useRouter();
  const runtime = useReadyAppRuntime();
  const modelCallLock = useModelCallLock();
  const attentionSnapshot = useBusinessCallAttentionSnapshot();
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const actionColor = useCSSVariable("--app-action");
  const dangerColor = useCSSVariable("--app-danger");
  const mutedColor = useCSSVariable("--app-ink-muted");
  const successColor = useCSSVariable("--app-success");
  const textColor = useCSSVariable("--app-ink");
  const warningColor = useCSSVariable("--app-warning");
  const isMountedRef = useRef(true);
  const personalEntryDeletionAttemptRef = useRef(0);
  const personalEntryDeletionPhaseRef = useRef<PersonalEntryDeletionPhase>({
    status: "idle",
  });
  const personalEntryDeletionRouteContextRef =
    useRef<PersonalEntryDeletionRouteContext>({
      entry: null,
      isFocused: false,
      routeName: null,
    });
  const promptdexMarkdownCopyReleaseTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const isPromptdexMarkdownCopyingRef = useRef(false);
  const entryLoadRequestIdRef = useRef(0);
  const attentionClearInFlightRef = useRef(new Map<string, string>());
  const [state, setState] = useState<DetailState>({ status: "loading" });
  const [taskInputs, setTaskInputs] = useState<Record<string, string>>({});
  const [size, setSize] = useState<ImageTaskSize>(
    () => runtime.settings.defaultImageSpec.size,
  );
  const [defaultImageConfiguration, setDefaultImageConfiguration] =
    useState<ModelConfiguration | null>(null);
  const [isLoadingDefault, setIsLoadingDefault] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPickingEditImage, setIsPickingEditImage] = useState(false);
  const [pickedEditImage, setPickedEditImage] =
    useState<PickedEditInputImage | null>(null);
  const [failure, setFailure] = useState<ImageTaskFailureSummary | null>(null);
  const [notice, setNotice] = useState<EntryNotice | null>(null);
  const [renderedTaskResults, setRenderedTaskResults] = useState<
    RenderedEntryTaskResult[]
  >([]);
  const [editingInputName, setEditingInputName] = useState<string | null>(null);
  const [isPromptdexMarkdownExpanded, setIsPromptdexMarkdownExpanded] =
    useState(false);
  const [promptdexMarkdownCopyState, setPromptdexMarkdownCopyState] = useState(
    createPromptdexMarkdownCopyControlState,
  );
  const [personalEntryDeletionPhase, setPersonalEntryDeletionPhase] =
    useState<PersonalEntryDeletionPhase>({ status: "idle" });
  const [personalEntryDeletionError, setPersonalEntryDeletionError] = useState<
    string | null
  >(null);
  const name = typeof params.name === "string" ? params.name : null;
  const refillFromHistory =
    typeof params.refillFromHistory === "string"
      ? params.refillFromHistory
      : null;
  const entryModelCallOwnerKey = name
    ? getPromptdexEntryModelCallOwnerKey(name)
    : null;
  const ownedImageCall =
    entryModelCallOwnerKey !== null &&
    modelCallLock.activeCall?.ownerKey === entryModelCallOwnerKey &&
    (modelCallLock.activeCall.type === "imageGeneration" ||
      modelCallLock.activeCall.type === "imageEdit")
      ? modelCallLock.activeCall
      : null;
  const previousOwnedImageCallIdRef = useRef<string | null>(null);

  const clearPromptdexMarkdownCopyReleaseTimer = useCallback(() => {
    if (promptdexMarkdownCopyReleaseTimerRef.current === null) {
      return;
    }
    clearTimeout(promptdexMarkdownCopyReleaseTimerRef.current);
    promptdexMarkdownCopyReleaseTimerRef.current = null;
  }, []);

  const resetPromptdexMarkdownCopyControl = useCallback(() => {
    clearPromptdexMarkdownCopyReleaseTimer();
    isPromptdexMarkdownCopyingRef.current = false;
    setPromptdexMarkdownCopyState(createPromptdexMarkdownCopyControlState());
  }, [clearPromptdexMarkdownCopyReleaseTimer]);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      clearPromptdexMarkdownCopyReleaseTimer();
    };
  }, [clearPromptdexMarkdownCopyReleaseTimer]);

  useEffect(() => {
    setIsPromptdexMarkdownExpanded(false);
    resetPromptdexMarkdownCopyControl();
    setRenderedTaskResults([]);

    if (!name) {
      setState({ status: "missing" });
      return;
    }

    const entryName = name;
    const requestId = ++entryLoadRequestIdRef.current;
    let cancelled = false;

    async function loadEntry() {
      setState({ status: "loading" });
      try {
        const entry = await runtime.promptdexCatalogService.get(entryName);
        if (cancelled || requestId !== entryLoadRequestIdRef.current) {
          return;
        }
        if (!entry) {
          setState({ status: "missing" });
          return;
        }
        const homeService = createPromptdexHomeService({
          promptdexCatalogService: runtime.promptdexCatalogService,
          imageTaskRepository: runtime.imageTaskRepository,
        });
        const images = await homeService.listEntryImages({
          sourceType: entry.sourceType,
          name: entry.template.name,
        });
        if (cancelled || requestId !== entryLoadRequestIdRef.current) {
          return;
        }
        const hydratedImages = await hydrateEntryImages(
          runtime.imageFileStorage,
          images,
        );
        if (cancelled || requestId !== entryLoadRequestIdRef.current) {
          return;
        }
        const emptyInputs = Object.fromEntries(
          getTextPromptdexInputs(entry.template.inputs).map((input) => [
            input.name,
            "",
          ]),
        );

        let prefillInputs = emptyInputs;
        let refillNotice: EntryNotice | null = null;

        if (refillFromHistory) {
          const history =
            await runtime.imageTaskRepository.getHistory(refillFromHistory);
          if (cancelled || requestId !== entryLoadRequestIdRef.current) {
            return;
          }
          // 消费时点再判定一次：使用者可能在历史详情页停留期间改动了条目。
          const refill = history
            ? resolveTaskRefill({ history, entry })
            : {
                status: "ineligible" as const,
                reason: "entry_missing" as const,
              };

          if (refill.status === "eligible") {
            prefillInputs = { ...emptyInputs, ...refill.plan.prefillInputs };
            refillNotice = {
              message: refill.plan.requiresEditImage
                ? "已按历史任务预填输入，请重新选择输入图片后执行。"
                : "已按历史任务预填输入，可修改后重新执行。",
              tone: "neutral",
            };
          } else {
            refillNotice = {
              message: "历史任务与当前条目已不匹配，请重新填写输入。",
              tone: "warning",
            };
          }
        }

        setState({ status: "ready", entry, images: hydratedImages });
        setTaskInputs(prefillInputs);
        // 每次进入表单都回到应用默认规格；本次任务改尺寸不回写默认（ADR 0037 / 0038）。
        setSize(runtime.settings.defaultImageSpec.size);
        setFailure(null);
        setNotice(refillNotice);
        setPickedEditImage(null);
      } catch (error) {
        if (!cancelled && requestId === entryLoadRequestIdRef.current) {
          setState({
            status: "failed",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    void loadEntry();

    return () => {
      cancelled = true;
    };
  }, [
    name,
    refillFromHistory,
    resetPromptdexMarkdownCopyControl,
    runtime.imageFileStorage,
    runtime.imageTaskRepository,
    runtime.promptdexCatalogService,
    runtime.settings.defaultImageSpec.size,
  ]);

  useEffect(() => {
    const previousCallId = previousOwnedImageCallIdRef.current;
    const currentCallId = ownedImageCall?.id ?? null;
    previousOwnedImageCallIdRef.current = currentCallId;

    if (!previousCallId || currentCallId || !name) {
      return;
    }

    const entryName = name;
    const requestId = ++entryLoadRequestIdRef.current;
    let cancelled = false;

    async function refreshEntryImages() {
      try {
        const entry = await runtime.promptdexCatalogService.get(entryName);
        if (
          !entry ||
          cancelled ||
          requestId !== entryLoadRequestIdRef.current
        ) {
          return;
        }
        const homeService = createPromptdexHomeService({
          promptdexCatalogService: runtime.promptdexCatalogService,
          imageTaskRepository: runtime.imageTaskRepository,
        });
        const images = await homeService.listEntryImages({
          sourceType: entry.sourceType,
          name: entry.template.name,
        });
        const hydratedImages = await hydrateEntryImages(
          runtime.imageFileStorage,
          images,
        );
        if (cancelled || requestId !== entryLoadRequestIdRef.current) {
          return;
        }
        setState((current) =>
          current.status === "ready" &&
          current.entry.sourceType === entry.sourceType &&
          current.entry.template.name === entry.template.name
            ? { ...current, images: hydratedImages }
            : current,
        );
      } catch (error) {
        console.warn("[promptdex-entry] 模型调用结束后刷新图片失败", error);
      }
    }

    void refreshEntryImages();
    return () => {
      cancelled = true;
    };
  }, [
    name,
    ownedImageCall?.id,
    runtime.imageFileStorage,
    runtime.imageTaskRepository,
    runtime.promptdexCatalogService,
  ]);

  useEffect(() => {
    let cancelled = false;

    async function loadDefault() {
      setIsLoadingDefault(true);
      try {
        const configuration = runtime.settings.defaultImageModelConfigurationId
          ? await runtime.repository.get(
              runtime.settings.defaultImageModelConfigurationId,
            )
          : null;
        if (!cancelled) {
          setDefaultImageConfiguration(
            configuration?.type === "image" && configuration.isReady
              ? configuration
              : null,
          );
        }
      } catch {
        if (!cancelled) {
          setDefaultImageConfiguration(null);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingDefault(false);
        }
      }
    }

    void loadDefault();

    return () => {
      cancelled = true;
    };
  }, [runtime.repository, runtime.settings.defaultImageModelConfigurationId]);

  const loadedEntry = state.status === "ready" ? state.entry : null;
  const loadedEntryName = loadedEntry?.template.name ?? null;
  const loadedEntryKey = loadedEntry
    ? getPromptdexHomeEntryKey({
        sourceType: loadedEntry.sourceType,
        name: loadedEntry.template.name,
      })
    : null;
  personalEntryDeletionRouteContextRef.current = {
    entry: loadedEntry,
    isFocused,
    routeName: name,
  };

  useEffect(() => {
    setPersonalEntryDeletionError(null);
  }, [loadedEntry]);

  useEffect(() => {
    setRenderedTaskResults((current) => {
      let changed = false;
      const next = current.map((result) => {
        if (result.hasRendered || state.status !== "ready") {
          return result;
        }
        const isRendered =
          result.kind === "succeeded"
            ? state.images.some(
                (image) => image.taskHistory.id === result.historyId,
              )
            : failure === result.failure;
        if (!isRendered) {
          return result;
        }
        changed = true;
        return { ...result, hasRendered: true };
      });
      return changed ? next : current;
    });
  }, [failure, state]);

  useEffect(() => {
    setRenderedTaskResults((current) => {
      let changed = false;
      const next = current.flatMap((result) => {
        const hasAttention = attentionSnapshot.imageTasks.has(result.historyId);
        if (result.hasObservedAttention && !hasAttention) {
          changed = true;
          return [];
        }
        if (!result.hasObservedAttention && hasAttention) {
          changed = true;
          return [{ ...result, hasObservedAttention: true }];
        }
        return [result];
      });
      return changed ? next : current;
    });
  }, [attentionSnapshot.imageTasks, renderedTaskResults]);

  useEffect(() => {
    for (const result of renderedTaskResults) {
      const attention = attentionSnapshot.imageTasks.get(result.historyId);
      if (
        !shouldClearRenderedEntryTaskAttention({
          isFocused,
          routeEntryName: name,
          loadedEntryName,
          loadedEntryKey,
          resultEntryKey: result.entryKey,
          resultHistoryId: result.historyId,
          isResultRendered: result.hasRendered,
          resultKind: result.kind,
          attentionKind: attention?.kind ?? null,
        }) ||
        !attention
      ) {
        continue;
      }

      const attentionCreatedAt = attention.createdAt;
      if (
        attentionClearInFlightRef.current.get(result.historyId) ===
        attentionCreatedAt
      ) {
        continue;
      }
      attentionClearInFlightRef.current.set(
        result.historyId,
        attentionCreatedAt,
      );

      void runtime.businessCallAttentionRepository
        .clearImageTask(result.historyId)
        .catch(() => {
          console.warn("[promptdex-entry] 清除本次任务提示失败");
        })
        .finally(() => {
          if (
            attentionClearInFlightRef.current.get(result.historyId) ===
            attentionCreatedAt
          ) {
            attentionClearInFlightRef.current.delete(result.historyId);
          }
        });
    }
  }, [
    attentionSnapshot.imageTasks,
    isFocused,
    loadedEntryKey,
    loadedEntryName,
    name,
    renderedTaskResults,
    runtime.businessCallAttentionRepository,
  ]);

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
              图鉴条目不存在
            </Text>
          </Surface>
        </View>
      </ScreenCanvas>
    );
  }

  if (state.status === "failed") {
    return (
      <ScreenCanvas variant="tool">
        <View className="flex-1 justify-center">
          <Surface tone="danger" variant="feedback">
            <Text
              className="text-center text-sm leading-5 text-app-danger"
            >
              {state.message}
            </Text>
          </Surface>
        </View>
      </ScreenCanvas>
    );
  }

  const { entry } = state;
  const { template } = entry;
  const entryImages = state.images;
  const promptdexMarkdown = serializePromptdexTemplateMarkdown(template);
  const promptdexMarkdownCopyPresentation =
    getPromptdexMarkdownCopyControlPresentation(promptdexMarkdownCopyState);
  const textInputs = getTextPromptdexInputs(template.inputs);
  const hasImageInput = Object.hasOwn(template.inputs, "image");
  const hasMaskInput = Object.hasOwn(template.inputs, "mask");
  const isExecutableEditTemplate =
    template.taskType === "edit" && hasImageInput && !hasMaskInput;
  const isUnsupportedMaskEditTemplate =
    template.taskType === "edit" && hasMaskInput;
  const missingRequiredInputNames = textInputs
    .filter(
      (input) =>
        input.required && (taskInputs[input.name] ?? "").trim().length === 0,
    )
    .map((input) => input.name);
  const requiredInputsFilled = missingRequiredInputNames.length === 0;
  const isTaskInProgress = isSubmitting || ownedImageCall !== null;
  const submitState = getTaskSubmitState({
    taskType: template.taskType,
    isExecutableEditTemplate,
    isUnsupportedMaskEditTemplate,
    missingRequiredInputNames,
    hasPickedEditImage: pickedEditImage !== null,
    hasReadyImageConfiguration: defaultImageConfiguration !== null,
    isLoadingDefaultConfiguration: isLoadingDefault,
    isPickingEditImage,
    isSubmitting: isTaskInProgress,
    activeModelCallType:
      ownedImageCall === null ? (modelCallLock.activeCall?.type ?? null) : null,
  });
  const canSubmit = submitState.canSubmit;
  // 模型卡片里已经有橙色提示 + 配置 CTA，按钮上方不再重复讲一遍。
  const submitBlockMessage =
    submitState.block &&
    submitState.block.kind !== "missing_model_configuration"
      ? submitState.block.message
      : null;

  function updateTaskInput(inputName: string, value: string) {
    setTaskInputs((current) => ({
      ...current,
      [inputName]: value,
    }));
    setFailure(null);
    setNotice(null);
  }

  function openTaskInputEditor(inputName: string) {
    setEditingInputName(inputName);
  }

  function closeTaskInputEditor() {
    Keyboard.dismiss();
    setEditingInputName(null);
  }

  function togglePromptdexMarkdownExpanded() {
    setIsPromptdexMarkdownExpanded((current) => !current);
  }

  function schedulePromptdexMarkdownCopyRelease(delayMs: number) {
    clearPromptdexMarkdownCopyReleaseTimer();
    promptdexMarkdownCopyReleaseTimerRef.current = setTimeout(() => {
      promptdexMarkdownCopyReleaseTimerRef.current = null;
      isPromptdexMarkdownCopyingRef.current = false;
      if (isMountedRef.current) {
        setPromptdexMarkdownCopyState((current) =>
          releasePromptdexMarkdownCopy(current),
        );
      }
    }, delayMs);
  }

  async function handleCopyPromptdexMarkdown() {
    if (isPromptdexMarkdownCopyingRef.current) {
      return;
    }

    const copyingState = startPromptdexMarkdownCopy(promptdexMarkdownCopyState);
    if (copyingState === promptdexMarkdownCopyState) {
      return;
    }

    const startedAt = Date.now();
    isPromptdexMarkdownCopyingRef.current = true;
    clearPromptdexMarkdownCopyReleaseTimer();
    setPromptdexMarkdownCopyState(copyingState);

    let result: PromptdexMarkdownCopyResult;
    try {
      await Clipboard.setStringAsync(promptdexMarkdown);
      result = { status: "copied" };
    } catch (error) {
      console.warn("Failed to copy Promptdex markdown to clipboard", error);
      result = { status: "failed" };
    }

    if (!isMountedRef.current || !isPromptdexMarkdownCopyingRef.current) {
      return;
    }

    setPromptdexMarkdownCopyState((current) =>
      finishPromptdexMarkdownCopy(current, result),
    );
    schedulePromptdexMarkdownCopyRelease(
      Math.max(
        0,
        PROMPTDEX_MARKDOWN_COPY_DEBOUNCE_MS - (Date.now() - startedAt),
      ),
    );
  }

  async function handlePickEditImage() {
    setIsPickingEditImage(true);
    setFailure(null);
    setNotice(null);

    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: false,
        quality: 1,
        base64: false,
        allowsMultipleSelection: false,
      });
      if (!isMountedRef.current) {
        return;
      }
      if (result.canceled) {
        return;
      }

      const asset = result.assets[0];
      if (!asset) {
        setFailure({
          reason: "invalid_input",
          message: "无法读取所选图片，请重新选择。",
          occurredAt: new Date().toISOString(),
        });
        return;
      }

      const normalized = await normalizePickedEditInputImage(asset);
      if (!isMountedRef.current) {
        return;
      }
      if (normalized.status === "failed") {
        setFailure({
          reason: "invalid_input",
          message: normalized.error.message,
          occurredAt: new Date().toISOString(),
        });
        return;
      }

      setPickedEditImage(normalized.image);
    } catch {
      if (!isMountedRef.current) {
        return;
      }
      setFailure({
        reason: "invalid_input",
        message: "无法读取所选图片，请重新选择。",
        occurredAt: new Date().toISOString(),
      });
    } finally {
      if (isMountedRef.current) {
        setIsPickingEditImage(false);
      }
    }
  }

  const editingInput =
    editingInputName === null
      ? null
      : (textInputs.find((input) => input.name === editingInputName) ?? null);

  async function handleSubmit() {
    if (template.taskType !== "generate" && !isExecutableEditTemplate) {
      setFailure({
        reason: "invalid_input",
        message: failureMessage("invalid_input"),
        occurredAt: new Date().toISOString(),
      });
      setNotice(null);
      return;
    }

    if (isExecutableEditTemplate && pickedEditImage === null) {
      setFailure({
        reason: "invalid_input",
        message: "请选择图片文件。",
        occurredAt: new Date().toISOString(),
      });
      setNotice(null);
      return;
    }

    if (!requiredInputsFilled) {
      setFailure({
        reason: "invalid_input",
        message: failureMessage("invalid_input"),
        occurredAt: new Date().toISOString(),
      });
      setNotice(null);
      return;
    }

    if (!defaultImageConfiguration) {
      setFailure({
        reason: "missing_default_model_configuration",
        message: failureMessage("missing_default_model_configuration"),
        occurredAt: new Date().toISOString(),
      });
      setNotice(null);
      return;
    }

    const lock = modelCallLock.beginModelCall({
      type: isExecutableEditTemplate ? "imageEdit" : "imageGeneration",
      returnHref: `/promptdex/${encodeURIComponent(template.name)}`,
      ownerKey: getPromptdexEntryModelCallOwnerKey(template.name),
      context: { promptdexEntryName: template.name },
    });
    if (lock.status === "blocked") {
      setFailure({
        reason: "unknown_error",
        message: "已有模型调用正在进行。",
        occurredAt: new Date().toISOString(),
      });
      setNotice(null);
      return;
    }

    setIsSubmitting(true);
    setFailure(null);
    setNotice({
      message: isExecutableEditTemplate ? "正在编辑图片。" : "正在生成图片。",
      tone: "neutral",
    });

    try {
      const result =
        isExecutableEditTemplate && pickedEditImage
          ? await createPromptdexImageEditTaskService({
              imageTaskRepository: runtime.imageTaskRepository,
              modelConfigurationRepository: runtime.repository,
              fileStorage: runtime.imageFileStorage,
              attachmentStorage: runtime.imageTaskAttachmentStorage,
              onHistoryCreated(history) {
                modelCallLock.updateModelCall(lock.call.id, {
                  returnHref: `/history/${encodeURIComponent(history.id)}`,
                  context: {
                    historyId: history.id,
                    promptdexEntryName: template.name,
                  },
                });
              },
            }).run({
              template,
              taskInputs,
              image: pickedEditImage,
              size,
              sourceType: entry.sourceType,
            })
          : await createPromptdexImageGenerationTaskService({
              imageTaskRepository: runtime.imageTaskRepository,
              modelConfigurationRepository: runtime.repository,
              fileStorage: runtime.imageFileStorage,
              onHistoryCreated(history) {
                modelCallLock.updateModelCall(lock.call.id, {
                  returnHref: `/history/${encodeURIComponent(history.id)}`,
                  context: {
                    historyId: history.id,
                    promptdexEntryName: template.name,
                  },
                });
              },
            }).run({
              template,
              taskInputs,
              size,
              sourceType: entry.sourceType,
            });
      if (!isMountedRef.current) {
        return;
      }

      if (result.status === "succeeded") {
        const hydratedImage = await hydrateEntryImage(
          runtime.imageFileStorage,
          {
            imageResult: result.imageResult,
            taskHistory: result.history,
          },
        );
        if (!isMountedRef.current) {
          return;
        }
        setState((current) =>
          current.status === "ready" &&
          current.entry.sourceType === entry.sourceType &&
          current.entry.template.name === template.name
            ? {
                ...current,
                images: mergeEntryImages(current.images, hydratedImage),
              }
            : current,
        );
        setRenderedTaskResults((current) =>
          upsertRenderedTaskResult(current, {
            callId: lock.call.id,
            entryKey: getPromptdexHomeEntryKey({
              sourceType: entry.sourceType,
              name: template.name,
            }),
            entryName: template.name,
            historyId: result.history.id,
            kind: "succeeded",
            failure: null,
            hasRendered: false,
            hasObservedAttention: false,
          }),
        );
        setFailure(null);
        setNotice({
          message: isExecutableEditTemplate
            ? "编辑完成，图片已保存。"
            : "生成完成，图片已保存。",
          tone: "success",
        });
        return;
      }

      setFailure(result.failure);
      if (result.history) {
        const historyId = result.history.id;
        setRenderedTaskResults((current) =>
          upsertRenderedTaskResult(current, {
            callId: lock.call.id,
            entryKey: getPromptdexHomeEntryKey({
              sourceType: entry.sourceType,
              name: template.name,
            }),
            entryName: template.name,
            historyId,
            kind: "failed",
            failure: result.failure,
            hasRendered: false,
            hasObservedAttention: false,
          }),
        );
      }
      setNotice(null);
      if (
        result.failure.reason === "missing_credential" ||
        result.failure.reason === "missing_default_model_configuration"
      ) {
        try {
          await runtime.refreshSettings();
        } catch {
          // 刷新设置失败不应覆盖上面已设置的具体失败原因，这里静默忽略。
        }
      }
    } catch {
      if (!isMountedRef.current) {
        return;
      }
      setFailure({
        reason: "unknown_error",
        message: failureMessage("unknown_error"),
        occurredAt: new Date().toISOString(),
      });
      setNotice(null);
    } finally {
      if (isMountedRef.current) {
        setIsSubmitting(false);
      }
      modelCallLock.endModelCall(lock.call.id);
    }
  }

  function renderModelConfiguration() {
    if (isLoadingDefault) {
      return <ActivityIndicator color={actionColor} />;
    }
    if (defaultImageConfiguration) {
      return (
        <View className="items-start gap-2">
          <Text
            className="text-sm font-bold leading-5 text-app-ink"
            numberOfLines={1}
          >
            {defaultImageConfiguration.modelName}
          </Text>
          <Text
            className="text-[13px] text-app-ink-muted"
            numberOfLines={1}
          >
            {formatBaseUrlBrief(defaultImageConfiguration.baseUrl)}
          </Text>
        </View>
      );
    }
    return (
      <View className="items-start gap-2">
        <Text className="text-sm leading-5 text-app-warning">
          {failureMessage("missing_default_model_configuration")}
        </Text>
        <View className="self-start">
          <AppButton
            icon="settings"
            label="配置图片模型"
            onPress={() => router.push("/model-configurations")}
            variant="secondary"
          />
        </View>
      </View>
    );
  }

  function setPersonalEntryDeletionPhaseSynchronously(
    next: PersonalEntryDeletionPhase,
  ) {
    personalEntryDeletionPhaseRef.current = next;
    if (isMountedRef.current) {
      setPersonalEntryDeletionPhase(next);
    }
  }

  function releasePersonalEntryDeletion(
    attemptKey: string,
    expectedStatus: "confirming" | "deleting" = "confirming",
  ) {
    const phase = personalEntryDeletionPhaseRef.current;
    if (
      phase.status !== expectedStatus ||
      phase.target.attemptKey !== attemptKey
    ) {
      return;
    }
    setPersonalEntryDeletionPhaseSynchronously({ status: "idle" });
  }

  function isPersonalEntryDeletionTargetSameRoute(
    target: PersonalEntryDeletionTarget,
  ) {
    const current = personalEntryDeletionRouteContextRef.current;
    return (
      current.routeName === target.routeName &&
      current.entry === target.entry &&
      current.entry?.sourceType === "personal" &&
      current.entry.template.name === target.entryName
    );
  }

  function isPersonalEntryDeletionTargetCurrent(
    target: PersonalEntryDeletionTarget,
  ) {
    return (
      personalEntryDeletionRouteContextRef.current.isFocused &&
      isPersonalEntryDeletionTargetSameRoute(target)
    );
  }

  function handleDeletePersonalEntry() {
    if (entry.sourceType !== "personal" || !isFocused || name === null) {
      return;
    }

    const entryKey = getPromptdexHomeEntryKey({
      sourceType: entry.sourceType,
      name: entry.template.name,
    });
    const currentPhase = personalEntryDeletionPhaseRef.current;
    if (currentPhase.status !== "idle") {
      return;
    }

    const target: PersonalEntryDeletionTarget = {
      attemptKey: `${entryKey}:${++personalEntryDeletionAttemptRef.current}`,
      entry,
      entryKey,
      entryName: entry.template.name,
      routeName: name,
    };
    setPersonalEntryDeletionError(null);
    setPersonalEntryDeletionPhaseSynchronously({
      status: "confirming",
      target,
    });

    Alert.alert(
      "删除个人图鉴条目",
      "删除后该条目将从图鉴移除；已有任务历史和图片结果会保留。该名称之后可以重新导入或提炼。",
      [
        {
          text: "取消",
          style: "cancel",
          onPress: () => releasePersonalEntryDeletion(target.attemptKey),
        },
        {
          text: "删除",
          style: "destructive",
          onPress: () => {
            void deletePersonalEntry(target);
          },
        },
      ],
      {
        cancelable: true,
        onDismiss: () => releasePersonalEntryDeletion(target.attemptKey),
      },
    );
  }

  async function deletePersonalEntry(target: PersonalEntryDeletionTarget) {
    const phase = personalEntryDeletionPhaseRef.current;
    if (
      phase.status !== "confirming" ||
      phase.target.attemptKey !== target.attemptKey ||
      !isPersonalEntryDeletionTargetCurrent(target)
    ) {
      releasePersonalEntryDeletion(target.attemptKey);
      return;
    }

    setPersonalEntryDeletionPhaseSynchronously({
      status: "deleting",
      target,
    });
    setPersonalEntryDeletionError(null);

    try {
      await runtime.personalPromptdexEntryRepository.delete(target.entryName);
      if (
        !isMountedRef.current ||
        personalEntryDeletionPhaseRef.current.status !== "deleting" ||
        personalEntryDeletionPhaseRef.current.target.attemptKey !==
          target.attemptKey
      ) {
        return;
      }

      const isSameRoute = isPersonalEntryDeletionTargetSameRoute(target);
      const shouldNavigate =
        isSameRoute && personalEntryDeletionRouteContextRef.current.isFocused;
      releasePersonalEntryDeletion(target.attemptKey, "deleting");
      if (shouldNavigate) {
        router.replace("/");
      } else if (isSameRoute) {
        setState({ status: "missing" });
      }
    } catch {
      if (
        !isMountedRef.current ||
        personalEntryDeletionPhaseRef.current.status !== "deleting" ||
        personalEntryDeletionPhaseRef.current.target.attemptKey !==
          target.attemptKey
      ) {
        return;
      }

      const shouldShowError = isPersonalEntryDeletionTargetCurrent(target);
      releasePersonalEntryDeletion(target.attemptKey, "deleting");
      if (shouldShowError) {
        setPersonalEntryDeletionError("删除个人图鉴条目失败，请稍后重试。");
      }
    }
  }

  const isCurrentPersonalEntryDeletionPhase =
    personalEntryDeletionPhase.status !== "idle" &&
    personalEntryDeletionPhase.target.entry === entry &&
    personalEntryDeletionPhase.target.routeName === name;
  const isDeletingPersonalEntry =
    isCurrentPersonalEntryDeletionPhase &&
    personalEntryDeletionPhase.status === "deleting";

  return (
    <View className="flex-1 bg-app-surface-raised">
      <ScrollView
        className="flex-1"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerClassName="w-full max-w-[720px] self-center gap-[18px] px-5 pb-8 pt-5"
      >
        <Surface variant="brand">
          <View className="gap-2">
            <Text
              className="text-2xl font-bold leading-[30px] text-app-ink"
              numberOfLines={2}
            >
              {template.name}
            </Text>
            <View className="flex-row">
              <SourceBadge
                sourceLabel={entry.sourceLabel}
                sourceType={entry.sourceType}
              />
            </View>
          </View>
          <View className="flex-row items-center gap-2.5">
            <TaskTypeBadge taskType={template.taskType} />
            <Text
              className="text-[13px] font-bold leading-[18px] text-app-ink-muted"
            >
              {isUnsupportedMaskEditTemplate ? "蒙版编辑后续支持" : "可执行"}
            </Text>
          </View>
          <Text
            className="text-[15px] leading-[22px] text-app-ink-muted"
            selectable
          >
            {template.description}
          </Text>
        </Surface>

        {isUnsupportedMaskEditTemplate ? (
          <>
            <InputDeclarationSection template={template} />
            <Surface variant="feedback">
              <View className="flex-row items-start gap-2.5">
                <SymbolIcon
                  className="h-5 w-5"
                  name="locked"
                  tintColor={mutedColor}
                />
                <Text
                  className="flex-1 text-sm leading-5 text-app-ink-muted"
                >
                  包含蒙版输入，后续支持。
                </Text>
              </View>
            </Surface>
          </>
        ) : (
          <>
            <Surface variant="panel">
              <View className="gap-3">
                <View className="flex-row items-center gap-2">
                  <SymbolIcon
                    className="h-[22px] w-[22px]"
                    name="photo"
                    tintColor={actionColor}
                  />
                  <SectionTitle>图片模型</SectionTitle>
                </View>
                {renderModelConfiguration()}
              </View>
            </Surface>

            {isExecutableEditTemplate ? (
              <Surface variant="panel">
                <SectionTitle>编辑输入</SectionTitle>
                <View className="flex-row items-center gap-3.5">
                  <MediaFrame
                    accessibilityLabel="已选择的编辑输入图片"
                    placeholderLabel="未选择图片"
                    thumbnailSize={104}
                    uri={pickedEditImage?.uri ?? null}
                    variant="thumbnail"
                  />
                  <View className="flex-1 gap-2">
                    <Text
                      className="flex-1 text-[15px] font-bold leading-[21px] text-app-ink"
                    >
                      输入图片
                    </Text>
                    <Text
                      className="text-sm leading-5 text-app-ink-muted"
                    >
                      {pickedEditImage
                        ? `${pickedEditImage.width} × ${pickedEditImage.height} · ${formatByteSize(pickedEditImage.byteSize)}`
                        : "从系统相册选择一张图片。"}
                    </Text>
                    <View className="self-start">
                      <AppButton
                        disabled={isTaskInProgress}
                        icon="photos"
                        label={pickedEditImage ? "重新选择" : "从相册选择"}
                        loading={isPickingEditImage}
                        onPress={handlePickEditImage}
                        variant="secondary"
                      />
                    </View>
                  </View>
                </View>
              </Surface>
            ) : null}

            <Surface variant="panel">
              <SectionTitle>任务输入</SectionTitle>
              <View className="gap-3">
                {textInputs.map((input) => (
                  <View className="gap-2" key={input.name}>
                    <View className="flex-row items-center gap-2.5">
                      <Text
                        className="flex-1 text-[15px] font-bold leading-[21px] text-app-ink"
                      >
                        {input.name}
                      </Text>
                      <Badge variant={input.required ? "brand" : "neutral"}>
                        {input.required ? "必需" : "可选"}
                      </Badge>
                    </View>
                    <Text
                      className="text-sm leading-5 text-app-ink-muted"
                      selectable
                    >
                      {input.description}
                    </Text>
                    <Pressable
                      accessibilityLabel={`编辑 ${input.name}`}
                      accessibilityRole="button"
                      accessibilityState={{ disabled: isTaskInProgress }}
                      disabled={isTaskInProgress}
                      onPress={() => openTaskInputEditor(input.name)}
                      className={cn(
                        "h-[132px] justify-between rounded-[14px] border border-app-stroke bg-app-field p-3 transition-colors duration-150 active:bg-app-action-soft",
                        isTaskInProgress && "bg-app-action-soft",
                      )}
                      style={{ borderCurve: "continuous" }}
                    >
                      <Text
                        className={cn(
                          "text-[15px] leading-[22px] text-app-ink",
                          !taskInputs[input.name] && "text-app-ink-muted",
                        )}
                        numberOfLines={4}
                      >
                        {taskInputs[input.name] || "点按填写"}
                      </Text>
                      <View className="flex-row items-center justify-between gap-2">
                        <Text
                          className="text-xs font-bold leading-4 tabular-nums text-app-ink-muted"
                        >
                          {(taskInputs[input.name] ?? "").length} 字
                        </Text>
                        <SymbolIcon
                          className="h-[18px] w-[18px]"
                          name="expand"
                          tintColor={mutedColor}
                        />
                      </View>
                    </Pressable>
                  </View>
                ))}
              </View>
            </Surface>

            <Surface variant="panel">
              <SectionTitle>图片规格</SectionTitle>
              <View className="flex-row gap-2">
                {IMAGE_TASK_AVAILABLE_SIZES.map((option) => {
                  const selected = option === size;
                  return (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{
                        disabled: isTaskInProgress,
                        selected,
                      }}
                      disabled={isTaskInProgress}
                      key={option}
                      onPress={() => setSize(option)}
                      className={cn(
                        "min-h-16 flex-1 items-center justify-center gap-1 rounded-[14px] border border-app-stroke bg-app-field px-2 py-2.5 transition-colors duration-150 active:bg-app-action-soft",
                        selected && "border-app-action bg-app-action-soft",
                        isTaskInProgress && "bg-app-action-soft",
                      )}
                      style={{ borderCurve: "continuous" }}
                    >
                      <Text
                        className={cn(
                          "text-sm font-bold leading-5",
                          selected ? "text-app-action" : "text-app-ink",
                        )}
                      >
                        {getImageTaskSizeLabel(option)}
                      </Text>
                      <Text
                        className={cn(
                          "text-xs font-bold leading-4",
                          selected ? "text-app-action" : "text-app-ink-muted",
                        )}
                      >
                        {option}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text
                className="text-[13px] leading-[18px] text-app-ink-muted"
              >
                质量 自动 · 格式 PNG · 数量 1
              </Text>
            </Surface>

            {failure ? (
              <Surface tone="danger" variant="feedback">
                <View className="flex-row items-start gap-2.5">
                  <SymbolIcon
                    className="h-5 w-5"
                    name="warning"
                    tintColor={dangerColor}
                  />
                  <Text
                    className="flex-1 text-sm leading-5 text-app-ink"
                  >
                    {formatFailureText(failure)}
                  </Text>
                </View>
              </Surface>
            ) : null}

            {notice ? (
              <Surface
                tone={isTaskInProgress ? "neutral" : notice.tone}
                variant="feedback"
              >
                <View className="flex-row items-start gap-2.5">
                  <SymbolIcon
                    className="h-5 w-5"
                    name={
                      isTaskInProgress
                        ? "pending"
                        : notice.tone === "success"
                          ? "success"
                          : notice.tone === "warning"
                            ? "warning"
                            : "information"
                    }
                    tintColor={
                      isTaskInProgress || notice.tone === "neutral"
                        ? actionColor
                        : notice.tone === "success"
                          ? successColor
                          : warningColor
                    }
                  />
                  <Text
                    className="flex-1 text-sm leading-5 text-app-ink"
                  >
                    {notice.message}
                  </Text>
                </View>
              </Surface>
            ) : null}
          </>
        )}

        <EntryImagesSection
          imageTaskAttentions={attentionSnapshot.imageTasks}
          images={entryImages}
          onOpenImage={(imageResult) =>
            router.push(
              `/images/${encodeURIComponent(imageResult.id)}` as never,
            )
          }
        />

        <PromptdexMarkdownAccordion
          copyInProgress={promptdexMarkdownCopyPresentation.inProgress}
          expanded={isPromptdexMarkdownExpanded}
          markdown={promptdexMarkdown}
          onCopy={handleCopyPromptdexMarkdown}
          onToggleExpanded={togglePromptdexMarkdownExpanded}
        />

        {promptdexMarkdownCopyPresentation.feedback ? (
          <Surface
            tone={
              promptdexMarkdownCopyPresentation.feedback.tone === "success"
                ? "success"
                : "danger"
            }
            variant="feedback"
          >
            <View className="flex-row items-start gap-2.5">
              <SymbolIcon
                className="h-5 w-5"
                name={
                  promptdexMarkdownCopyPresentation.feedback.tone === "success"
                    ? "success"
                    : "warning"
                }
                tintColor={
                  promptdexMarkdownCopyPresentation.feedback.tone === "success"
                    ? successColor
                    : dangerColor
                }
              />
              <Text
                className="flex-1 text-sm leading-5 text-app-ink"
              >
                {promptdexMarkdownCopyPresentation.feedback.message}
              </Text>
            </View>
          </Surface>
        ) : null}

        {entry.sourceType === "personal" ? (
          <Surface variant="panel">
            {personalEntryDeletionError ? (
              <Surface tone="danger" variant="feedback">
                <View className="flex-row items-start gap-2.5">
                  <SymbolIcon
                    className="h-5 w-5"
                    name="warning"
                    tintColor={dangerColor}
                  />
                  <Text
                    className="flex-1 text-sm leading-5 text-app-danger"
                  >
                    {personalEntryDeletionError}
                  </Text>
                </View>
              </Surface>
            ) : null}
            <DestructiveActionButton
              disabled={personalEntryDeletionPhase.status !== "idle"}
              isDeleting={isDeletingPersonalEntry}
              label="删除个人图鉴条目"
              onPress={handleDeletePersonalEntry}
            />
          </Surface>
        ) : null}
      </ScrollView>

      {isUnsupportedMaskEditTemplate ? null : (
        <View className="border-t border-app-stroke bg-app-surface">
          <View
            className="w-full max-w-[720px] self-center gap-2.5 px-5 pt-3"
            style={{ paddingBottom: Math.max(insets.bottom, 12) }}
          >
            {submitBlockMessage ? (
              <Text
                className="text-[13px] leading-[18px] text-app-ink-muted"
              >
                {submitBlockMessage}
              </Text>
            ) : null}
            <AppButton
              disabled={!canSubmit}
              icon={isExecutableEditTemplate ? "magic-wand" : "sparkles"}
              label={getSubmitButtonText(
                isExecutableEditTemplate,
                isTaskInProgress,
              )}
              loading={isTaskInProgress}
              onPress={handleSubmit}
            />
          </View>
        </View>
      )}

      <Modal
        animationType="slide"
        onRequestClose={closeTaskInputEditor}
        presentationStyle="pageSheet"
        visible={editingInput !== null}
      >
        {editingInput ? (
          <View className="flex-1 gap-4 bg-app-surface-raised p-5 pt-6">
            <View className="flex-row items-center gap-3">
              <Pressable
                accessibilityLabel="关闭编辑"
                accessibilityRole="button"
                onPress={closeTaskInputEditor}
                className="h-11 w-11 items-center justify-center rounded-[14px] border border-app-stroke bg-app-field transition-colors duration-150 active:bg-app-action-soft"
                style={{ borderCurve: "continuous" }}
              >
                <SymbolIcon
                  className="h-[22px] w-[22px]"
                  name="close"
                  tintColor={textColor}
                />
              </Pressable>
              <View className="flex-1 gap-0.5">
                <Text
                  className="text-lg font-bold leading-6 text-app-ink"
                  numberOfLines={1}
                >
                  {editingInput.name}
                </Text>
                <Text
                  className="text-[13px] font-bold leading-[18px] text-app-ink-muted"
                  numberOfLines={1}
                  selectable
                >
                  {editingInput.description}
                </Text>
              </View>
              <AppButton
                accessibilityLabel="完成编辑"
                label="完成"
                onPress={closeTaskInputEditor}
              />
            </View>
            <TextInput
              autoFocus
              multiline
              onChangeText={(value) =>
                updateTaskInput(editingInput.name, value)
              }
              placeholder="请输入内容"
              placeholderTextColor={mutedColor}
              selectionColor={actionColor}
              className="flex-1 rounded-[14px] border border-app-stroke bg-app-field p-3.5 text-base leading-6 text-app-ink"
              style={{ borderCurve: "continuous" }}
              textAlignVertical="top"
              value={taskInputs[editingInput.name] ?? ""}
            />
          </View>
        ) : null}
      </Modal>
    </View>
  );
}

function EntryImagesSection({
  imageTaskAttentions,
  images,
  onOpenImage,
}: {
  imageTaskAttentions: ReadonlyMap<string, BusinessCallAttention>;
  images: HydratedPromptdexEntryImage[];
  onOpenImage(imageResult: ImageResult): void;
}) {
  const actionColor = useCSSVariable("--app-action");

  if (images.length === 0) {
    return null;
  }

  return (
    <Surface variant="panel">
      <View className="flex-row items-center gap-2">
        <SymbolIcon
          className="h-[22px] w-[22px]"
          name="photos"
          tintColor={actionColor}
        />
        <SectionTitle>生成图片</SectionTitle>
        <Text
          className="text-right text-[13px] font-bold leading-[18px] tabular-nums text-app-ink-muted"
        >
          {images.length} 张
        </Text>
      </View>
      <ScrollView
        horizontal
        contentContainerClassName="gap-2.5"
        showsHorizontalScrollIndicator={false}
      >
        {images.map((image) => {
          const attention = imageTaskAttentions.get(image.taskHistory.id);
          const hasSucceededAttention = attention?.kind === "succeeded";
          return (
            <Pressable
              accessibilityLabel={`打开图片详情 ${formatImageSpec(image.imageResult)}${hasSucceededAttention ? "，待查看" : ""}`}
              accessibilityRole="button"
              key={image.imageResult.id}
              onPress={() => onOpenImage(image.imageResult)}
              className="min-h-11 w-[104px] gap-1.5"
            >
              <View className="relative">
                <MediaFrame
                  accessibilityLabel={`生成图片 ${formatImageSpec(image.imageResult)}`}
                  placeholderLabel="图片不可用"
                  thumbnailSize={104}
                  uri={image.imageUri}
                  variant="thumbnail"
                />
                {hasSucceededAttention ? (
                  <View className="absolute right-1.5 top-1.5">
                    <Badge variant="brand">
                      {getImageTaskAttentionLabel("succeeded")}
                    </Badge>
                  </View>
                ) : null}
              </View>
              <Text
                className="text-xs font-bold leading-4 tabular-nums text-app-ink-muted"
                numberOfLines={1}
              >
                {formatLocalDateTime(image.imageResult.createdAt)}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </Surface>
  );
}

function PromptdexMarkdownAccordion({
  copyInProgress,
  expanded,
  markdown,
  onCopy,
  onToggleExpanded,
}: {
  copyInProgress: boolean;
  expanded: boolean;
  markdown: string;
  onCopy: () => void;
  onToggleExpanded: () => void;
}) {
  const actionColor = useCSSVariable("--app-action");
  const mutedColor = useCSSVariable("--app-ink-muted");

  return (
    <Surface variant="panel">
      <View className="flex-row items-center gap-2.5">
        <Pressable
          accessibilityLabel={
            expanded ? "收起 Promptdex Markdown" : "展开 Promptdex Markdown"
          }
          accessibilityRole="button"
          onPress={onToggleExpanded}
          className="min-h-11 flex-1 flex-row items-center justify-between gap-2 rounded-[14px] transition-colors duration-150 active:bg-app-action-soft"
          style={{ borderCurve: "continuous" }}
        >
          <SectionTitle>Promptdex Markdown</SectionTitle>
          <SymbolIcon
            className="h-5 w-5"
            name={expanded ? "chevron-up" : "chevron-down"}
            tintColor={mutedColor}
          />
        </Pressable>
        <Pressable
          accessibilityLabel="复制 Promptdex Markdown"
          accessibilityRole="button"
          accessibilityState={{ busy: copyInProgress }}
          onPress={onCopy}
          className="h-11 w-11 items-center justify-center rounded-[14px] border border-app-stroke bg-app-field transition-colors duration-150 active:bg-app-action-soft"
          style={{ borderCurve: "continuous" }}
        >
          {copyInProgress ? (
            <ActivityIndicator color={actionColor} />
          ) : (
            <SymbolIcon
              className="h-5 w-5"
              name="copy"
              tintColor={actionColor}
            />
          )}
        </Pressable>
      </View>
      {expanded ? (
        <View
          className="rounded-[14px] border border-app-stroke bg-app-field p-3"
          style={{ borderCurve: "continuous" }}
        >
          <Text
            className="font-mono text-[13px] leading-5 text-app-ink"
            selectable
          >
            {markdown}
          </Text>
        </View>
      ) : null}
    </Surface>
  );
}

function InputDeclarationSection({
  template,
}: {
  template: PromptdexTemplate;
}) {
  return (
    <Surface variant="panel">
      <SectionTitle>输入声明</SectionTitle>
      <View className="gap-3">
        {Object.entries(template.inputs).map(([inputName, input]) => (
          <Surface key={inputName} variant="fieldGroup">
            <View className="flex-row items-center gap-2.5">
              <Text
                className="flex-1 text-[15px] font-bold leading-[21px] text-app-ink"
              >
                {inputName}
              </Text>
              <Badge variant={input.required ? "brand" : "neutral"}>
                {input.required ? "必需" : "可选"}
              </Badge>
            </View>
            <Text className="text-sm leading-5 text-app-ink-muted" selectable>
              {input.description}
            </Text>
          </Surface>
        ))}
      </View>
    </Surface>
  );
}

function TaskTypeBadge({ taskType }: { taskType: "generate" | "edit" }) {
  return (
    <Badge variant={taskType === "generate" ? "success" : "neutral"}>
      {taskType === "generate" ? "生成" : "编辑"}
    </Badge>
  );
}

function SourceBadge({
  sourceLabel,
  sourceType,
}: {
  sourceLabel: string;
  sourceType: "built-in" | "personal";
}) {
  return (
    <Badge variant={sourceType === "personal" ? "brand" : "neutral"}>
      {sourceLabel}
    </Badge>
  );
}

function getSubmitButtonText(
  isExecutableEditTemplate: boolean,
  isSubmitting: boolean,
): string {
  if (isSubmitting) {
    return isExecutableEditTemplate ? "编辑中" : "生成中";
  }
  return isExecutableEditTemplate ? "编辑图片" : "生成图片";
}

async function hydrateEntryImages(
  fileStorage: ImageResultFileStorage,
  images: PromptdexHomeEntryImage[],
): Promise<HydratedPromptdexEntryImage[]> {
  const hydratedImages = await Promise.all(
    images.map((image) => hydrateEntryImage(fileStorage, image)),
  );
  return hydratedImages.sort(compareHydratedEntryImageDescending);
}

async function hydrateEntryImage(
  fileStorage: ImageResultFileStorage,
  image: PromptdexHomeEntryImage,
): Promise<HydratedPromptdexEntryImage> {
  return {
    ...image,
    imageUri: await fileStorage
      .resolveFileUri(image.imageResult.filePath)
      .catch(() => null),
  };
}

function mergeEntryImages(
  currentImages: HydratedPromptdexEntryImage[],
  nextImage: HydratedPromptdexEntryImage,
): HydratedPromptdexEntryImage[] {
  return [
    nextImage,
    ...currentImages.filter(
      (image) => image.imageResult.id !== nextImage.imageResult.id,
    ),
  ].sort(compareHydratedEntryImageDescending);
}

function upsertRenderedTaskResult(
  current: RenderedEntryTaskResult[],
  next: RenderedEntryTaskResult,
): RenderedEntryTaskResult[] {
  return [
    ...current.filter(
      (result) =>
        result.callId !== next.callId || result.historyId !== next.historyId,
    ),
    next,
  ];
}

function compareHydratedEntryImageDescending(
  left: HydratedPromptdexEntryImage,
  right: HydratedPromptdexEntryImage,
): number {
  return compareImageResultDescending(left.imageResult, right.imageResult);
}

function formatImageSpec(imageResult: ImageResult): string {
  const size =
    imageResult.width && imageResult.height
      ? `${imageResult.width}x${imageResult.height}`
      : "尺寸未知";
  return `${size} · ${imageResult.format.toUpperCase()}`;
}

function formatByteSize(byteSize: number): string {
  if (byteSize >= 1024 * 1024) {
    return `${(byteSize / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(byteSize / 1024))} KB`;
}

function formatFailureText(failure: ImageTaskFailureSummary): string {
  const details = [
    failure.statusCode !== undefined ? `HTTP ${failure.statusCode}` : null,
    failure.providerCode ?? null,
  ].filter((detail): detail is string => detail !== null);
  return details.length > 0
    ? `${failure.message}（${details.join(" · ")}）`
    : failure.message;
}

function formatBaseUrlBrief(baseUrl: string): string {
  try {
    const parsed = new URL(baseUrl);
    return `${parsed.host}${parsed.pathname === "/" ? "" : parsed.pathname}`;
  } catch {
    return baseUrl;
  }
}
