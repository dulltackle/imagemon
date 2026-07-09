import {
  serializePromptdexTemplateMarkdown,
  type PromptdexTemplate,
} from "@imagemon/core";
import * as Clipboard from "expo-clipboard";
import * as ImagePicker from "expo-image-picker";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Keyboard, Modal } from "react-native";

import { useReadyAppRuntime } from "../app-state";
import {
  IMAGE_TASK_AVAILABLE_SIZES,
  createPromptdexImageEditTaskService,
  createPromptdexImageGenerationTaskService,
  failureMessage,
  normalizePickedEditInputImage,
  type ImageResult,
  type ImageResultFileStorage,
  type ImageTaskFailureSummary,
  type ImageTaskSize,
  type PickedEditInputImage,
} from "../image-tasks";
import { useModelCallLock } from "../model-calls";
import type { ModelConfiguration } from "../model-configurations";
import {
  getTextPromptdexInputs,
  type MergedPromptdexCatalogEntry,
} from "./index";
import {
  compareImageResultDescending,
  createPromptdexHomeService,
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
  Image,
  Pressable,
  ScrollView,
  SymbolIcon,
  Text,
  TextInput,
  useCSSVariable,
  View,
} from "../tw";

const SIZE_LABELS: Record<ImageTaskSize, string> = {
  "1024x1024": "方图",
  "1536x1024": "横图",
  "1024x1536": "竖图",
};

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

export function PromptdexEntryDetailScreen() {
  const params = useLocalSearchParams<{ name?: string }>();
  const router = useRouter();
  const runtime = useReadyAppRuntime();
  const modelCallLock = useModelCallLock();
  const accentColor = useCSSVariable("--sf-blue");
  const dangerColor = useCSSVariable("--sf-red");
  const mutedColor = useCSSVariable("--sf-text-2");
  const placeholderColor = useCSSVariable("--sf-text-3");
  const textColor = useCSSVariable("--sf-text");
  const isMountedRef = useRef(true);
  const promptdexMarkdownCopyReleaseTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const isPromptdexMarkdownCopyingRef = useRef(false);
  const [state, setState] = useState<DetailState>({ status: "loading" });
  const [taskInputs, setTaskInputs] = useState<Record<string, string>>({});
  const [size, setSize] = useState<ImageTaskSize>("1024x1024");
  const [defaultImageConfiguration, setDefaultImageConfiguration] =
    useState<ModelConfiguration | null>(null);
  const [isLoadingDefault, setIsLoadingDefault] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPickingEditImage, setIsPickingEditImage] = useState(false);
  const [pickedEditImage, setPickedEditImage] =
    useState<PickedEditInputImage | null>(null);
  const [failure, setFailure] = useState<ImageTaskFailureSummary | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editingInputName, setEditingInputName] = useState<string | null>(null);
  const [isEditingInputText, setIsEditingInputText] = useState(false);
  const [isPromptdexMarkdownExpanded, setIsPromptdexMarkdownExpanded] =
    useState(false);
  const [promptdexMarkdownCopyState, setPromptdexMarkdownCopyState] = useState(
    createPromptdexMarkdownCopyControlState,
  );
  const name = typeof params.name === "string" ? params.name : null;

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      clearPromptdexMarkdownCopyReleaseTimer();
    };
  }, []);

  useEffect(() => {
    setIsPromptdexMarkdownExpanded(false);
    resetPromptdexMarkdownCopyControl();

    if (!name) {
      setState({ status: "missing" });
      return;
    }

    const entryName = name;
    let cancelled = false;

    async function loadEntry() {
      setState({ status: "loading" });
      try {
        const entry = await runtime.promptdexCatalogService.get(entryName);
        if (cancelled) {
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
        if (cancelled) {
          return;
        }
        const hydratedImages = await hydrateEntryImages(
          runtime.imageFileStorage,
          images,
        );
        if (cancelled) {
          return;
        }
        setState({ status: "ready", entry, images: hydratedImages });
        setTaskInputs(
          Object.fromEntries(
            getTextPromptdexInputs(entry.template.inputs).map((input) => [
              input.name,
              "",
            ]),
          ),
        );
        setFailure(null);
        setNotice(null);
        setPickedEditImage(null);
      } catch (error) {
        if (!cancelled) {
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

  useEffect(() => {
    if (!isEditingInputText) {
      return;
    }

    const subscription = Keyboard.addListener("keyboardDidHide", () => {
      setIsEditingInputText(false);
    });

    return () => {
      subscription.remove();
    };
  }, [isEditingInputText]);

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
        <Text className="text-xl font-extrabold text-sf-text" selectable>
          图鉴条目不存在
        </Text>
      </View>
    );
  }

  if (state.status === "failed") {
    return (
      <View className="flex-1 items-center justify-center bg-sf-bg-2 p-6">
        <Text className="text-sm leading-5 text-sf-red" selectable>
          {state.message}
        </Text>
      </View>
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
  const requiredInputsFilled = textInputs.every(
    (input) =>
      !input.required || (taskInputs[input.name] ?? "").trim().length > 0,
  );
  const canSubmit =
    (template.taskType === "generate" ||
      (isExecutableEditTemplate && pickedEditImage !== null)) &&
    requiredInputsFilled &&
    defaultImageConfiguration !== null &&
    !isSubmitting &&
    !isPickingEditImage &&
    modelCallLock.activeCall === null;

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
    setIsEditingInputText(false);
  }

  function closeTaskInputEditor() {
    Keyboard.dismiss();
    setEditingInputName(null);
    setIsEditingInputText(false);
  }

  function beginTaskInputTextEditing() {
    setIsEditingInputText(true);
  }

  function finishTaskInputTextEditing() {
    Keyboard.dismiss();
    setIsEditingInputText(false);
  }

  function togglePromptdexMarkdownExpanded() {
    setIsPromptdexMarkdownExpanded((current) => !current);
  }

  function clearPromptdexMarkdownCopyReleaseTimer() {
    if (promptdexMarkdownCopyReleaseTimerRef.current === null) {
      return;
    }
    clearTimeout(promptdexMarkdownCopyReleaseTimerRef.current);
    promptdexMarkdownCopyReleaseTimerRef.current = null;
  }

  function resetPromptdexMarkdownCopyControl() {
    clearPromptdexMarkdownCopyReleaseTimer();
    isPromptdexMarkdownCopyingRef.current = false;
    setPromptdexMarkdownCopyState(createPromptdexMarkdownCopyControlState());
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

    const lock = modelCallLock.beginModelCall(
      isExecutableEditTemplate ? "imageEdit" : "imageGeneration",
    );
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
    setNotice(isExecutableEditTemplate ? "正在编辑图片。" : "正在生成图片。");

    try {
      const result =
        isExecutableEditTemplate && pickedEditImage
          ? await createPromptdexImageEditTaskService({
              imageTaskRepository: runtime.imageTaskRepository,
              modelConfigurationRepository: runtime.repository,
              fileStorage: runtime.imageFileStorage,
              attachmentStorage: runtime.imageTaskAttachmentStorage,
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
        setFailure(null);
        setNotice(
          isExecutableEditTemplate
            ? "编辑完成，图片已保存。"
            : "生成完成，图片已保存。",
        );
        return;
      }

      setFailure(result.failure);
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
      return <ActivityIndicator color={accentColor} />;
    }
    if (defaultImageConfiguration) {
      return (
        <View className="items-start gap-2">
          <Text
            className="text-sm font-bold text-sf-text"
            numberOfLines={1}
            selectable
          >
            {defaultImageConfiguration.modelName}
          </Text>
          <Text
            className="text-[13px] text-sf-text-2"
            numberOfLines={1}
            selectable
          >
            {formatBaseUrlBrief(defaultImageConfiguration.baseUrl)}
          </Text>
        </View>
      );
    }
    return (
      <View className="items-start gap-2">
        <Text className="text-sm leading-5 text-sf-orange" selectable>
          {failureMessage("missing_default_model_configuration")}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push("/model-configurations")}
          className="flex-row items-center gap-2 rounded-lg border border-sf-blue px-3 py-[9px] active:opacity-75"
        >
          <SymbolIcon
            className="h-[18px] w-[18px]"
            name="gearshape"
            tintColor={accentColor}
          />
          <Text className="text-sm font-extrabold text-sf-blue">
            配置图片模型
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView
      className="flex-1 bg-sf-bg-2"
      contentInsetAdjustmentBehavior="automatic"
      contentContainerClassName="gap-4 p-5 pb-8"
    >
      <View className="gap-3 rounded-lg border border-sf-separator bg-sf-bg-3 p-4">
        <View className="gap-1.5">
          <Text
            className="text-2xl font-extrabold leading-[30px] text-sf-text"
            numberOfLines={2}
            selectable
          >
            {template.name}
          </Text>
          <Text
            className={cn(
              "self-start overflow-hidden rounded-lg px-2 py-1 text-[13px] font-bold",
              entry.sourceType === "personal"
                ? "bg-sf-fill text-sf-blue"
                : "bg-sf-fill text-sf-text-2",
            )}
            selectable
          >
            {entry.sourceLabel}
          </Text>
        </View>
        <View className="flex-row items-center gap-2.5">
          <TaskTypeBadge taskType={template.taskType} />
          <Text className="text-[13px] font-bold text-sf-text-2" selectable>
            {isUnsupportedMaskEditTemplate ? "蒙版编辑后续支持" : "可执行"}
          </Text>
        </View>
        <Text className="text-[15px] leading-[22px] text-sf-text-2" selectable>
          {template.description}
        </Text>
      </View>

      <EntryImagesSection
        images={entryImages}
        onOpenImage={(imageResult) =>
          router.push(`/images/${encodeURIComponent(imageResult.id)}` as never)
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
        <View
          className={
            promptdexMarkdownCopyPresentation.feedback.tone === "success"
              ? "flex-row items-start gap-2.5 rounded-lg border border-sf-green bg-sf-bg-3 p-3.5"
              : "flex-row items-start gap-2.5 rounded-lg border border-sf-red bg-sf-bg-3 p-3.5"
          }
        >
          <SymbolIcon
            className="h-5 w-5"
            name={
              promptdexMarkdownCopyPresentation.feedback.tone === "success"
                ? "checkmark.circle"
                : "exclamationmark.triangle"
            }
            tintColor={
              promptdexMarkdownCopyPresentation.feedback.tone === "success"
                ? accentColor
                : dangerColor
            }
          />
          <Text
            className={
              promptdexMarkdownCopyPresentation.feedback.tone === "success"
                ? "flex-1 text-sm leading-5 text-sf-text"
                : "flex-1 text-sm leading-5 text-sf-text"
            }
            selectable
          >
            {promptdexMarkdownCopyPresentation.feedback.message}
          </Text>
        </View>
      ) : null}

      {isUnsupportedMaskEditTemplate ? (
        <>
          <InputDeclarationSection template={template} />
          <View className="flex-row items-start gap-2.5 rounded-lg border border-sf-separator bg-sf-bg-3 p-3.5">
            <SymbolIcon
              className="h-5 w-5"
              name="lock"
              tintColor={mutedColor}
            />
            <Text
              className="flex-1 text-sm leading-5 text-sf-text-2"
              selectable
            >
              包含蒙版输入，后续支持。
            </Text>
          </View>
        </>
      ) : (
        <>
          <View className="gap-3 rounded-lg border border-sf-separator bg-sf-bg-3 p-4">
            <View className="gap-3">
              <View className="flex-row items-center gap-2">
                <SymbolIcon
                  className="h-[22px] w-[22px]"
                  name="photo"
                  tintColor={accentColor}
                />
                <SectionTitle>图片模型</SectionTitle>
              </View>
              {renderModelConfiguration()}
            </View>
          </View>

          {isExecutableEditTemplate ? (
            <View className="gap-3 rounded-lg border border-sf-separator bg-sf-bg-3 p-4">
              <SectionTitle>编辑输入</SectionTitle>
              <View className="flex-row items-center gap-3.5">
                {pickedEditImage ? (
                  <Image
                    className="aspect-square w-[104px] rounded-lg bg-sf-fill object-cover"
                    source={{ uri: pickedEditImage.uri }}
                  />
                ) : (
                  <View className="aspect-square w-[104px] items-center justify-center rounded-lg border border-sf-separator bg-sf-bg">
                    <SymbolIcon
                      className="h-7 w-7"
                      name="photo"
                      tintColor={mutedColor}
                    />
                  </View>
                )}
                <View className="flex-1 gap-2">
                  <Text
                    className="flex-1 text-[15px] font-extrabold text-sf-text"
                    selectable
                  >
                    输入图片
                  </Text>
                  <Text className="text-sm leading-5 text-sf-text-2" selectable>
                    {pickedEditImage
                      ? `${pickedEditImage.width} × ${pickedEditImage.height} · ${formatByteSize(pickedEditImage.byteSize)}`
                      : "从系统相册选择一张图片。"}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    disabled={isPickingEditImage || isSubmitting}
                    onPress={handlePickEditImage}
                    className={cn(
                      "flex-row items-center gap-2 self-start rounded-lg border border-sf-blue px-3 py-[9px] active:opacity-75",
                      (isPickingEditImage || isSubmitting) && "opacity-60",
                    )}
                  >
                    {isPickingEditImage ? (
                      <ActivityIndicator color={accentColor} />
                    ) : (
                      <SymbolIcon
                        className="h-[18px] w-[18px]"
                        name="photo.on.rectangle"
                        tintColor={accentColor}
                      />
                    )}
                    <Text className="text-sm font-extrabold text-sf-blue">
                      {pickedEditImage ? "重新选择" : "从相册选择"}
                    </Text>
                  </Pressable>
                </View>
              </View>
            </View>
          ) : null}

          <View className="gap-3 rounded-lg border border-sf-separator bg-sf-bg-3 p-4">
            <SectionTitle>任务输入</SectionTitle>
            <View className="gap-3">
              {textInputs.map((input) => (
                <View className="gap-2" key={input.name}>
                  <View className="flex-row items-center gap-2.5">
                    <Text
                      className="flex-1 text-[15px] font-extrabold text-sf-text"
                      selectable
                    >
                      {input.name}
                    </Text>
                    <Text
                      className="text-xs font-bold text-sf-text-2"
                      selectable
                    >
                      {input.required ? "必需" : "可选"}
                    </Text>
                  </View>
                  <Text className="text-sm leading-5 text-sf-text-2" selectable>
                    {input.description}
                  </Text>
                  <Pressable
                    accessibilityLabel={`编辑 ${input.name}`}
                    accessibilityRole="button"
                    onPress={() => openTaskInputEditor(input.name)}
                    className="h-[132px] justify-between rounded-lg border border-sf-separator bg-sf-bg p-3 active:opacity-75"
                  >
                    <Text
                      className={cn(
                        "text-[15px] leading-[22px] text-sf-text",
                        !taskInputs[input.name] && "text-sf-text-3",
                      )}
                      numberOfLines={4}
                      selectable
                    >
                      {taskInputs[input.name] || input.description}
                    </Text>
                    <View className="flex-row items-center justify-between gap-2">
                      <Text
                        className="text-xs font-bold tabular-nums text-sf-text-2"
                        selectable
                      >
                        {(taskInputs[input.name] ?? "").length} 字
                      </Text>
                      <SymbolIcon
                        className="h-[18px] w-[18px]"
                        name="arrow.up.left.and.arrow.down.right"
                        tintColor={mutedColor}
                      />
                    </View>
                  </Pressable>
                </View>
              ))}
            </View>
          </View>

          <View className="gap-3 rounded-lg border border-sf-separator bg-sf-bg-3 p-4">
            <SectionTitle>尺寸</SectionTitle>
            <View className="flex-row gap-2">
              {IMAGE_TASK_AVAILABLE_SIZES.map((option) => {
                const selected = option === size;
                return (
                  <Pressable
                    accessibilityRole="button"
                    key={option}
                    onPress={() => setSize(option)}
                    className={cn(
                      "min-h-16 flex-1 items-center justify-center gap-1 rounded-lg border border-sf-separator px-2 py-2.5 active:opacity-75",
                      selected && "border-sf-blue bg-blue-50",
                    )}
                  >
                    <Text
                      className={cn(
                        "text-sm font-extrabold",
                        selected ? "text-sf-blue" : "text-sf-text",
                      )}
                      selectable
                    >
                      {SIZE_LABELS[option]}
                    </Text>
                    <Text
                      className={cn(
                        "text-xs font-bold",
                        selected ? "text-sf-blue" : "text-sf-text-2",
                      )}
                      selectable
                    >
                      {option}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {failure ? (
            <View className="flex-row items-start gap-2.5 rounded-lg border border-sf-red bg-sf-bg-3 p-3.5">
              <SymbolIcon
                className="h-5 w-5"
                name="exclamationmark.triangle"
                tintColor={dangerColor}
              />
              <Text
                className="flex-1 text-sm leading-5 text-sf-text"
                selectable
              >
                {formatFailureText(failure)}
              </Text>
            </View>
          ) : null}

          {notice ? (
            <View className="flex-row items-start gap-2.5 rounded-lg border border-sf-green bg-sf-bg-3 p-3.5">
              <SymbolIcon
                className="h-5 w-5"
                name={isSubmitting ? "hourglass" : "checkmark.circle"}
                tintColor={accentColor}
              />
              <Text
                className="flex-1 text-sm leading-5 text-sf-text"
                selectable
              >
                {notice}
              </Text>
            </View>
          ) : null}

          <Pressable
            accessibilityRole="button"
            disabled={!canSubmit}
            onPress={handleSubmit}
            className={cn(
              "min-h-12 flex-row items-center justify-center gap-2 rounded-lg bg-sf-blue px-[18px] py-3.5 active:opacity-75",
              !canSubmit && "bg-sf-text-3",
            )}
          >
            {isSubmitting ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <SymbolIcon
                className="h-[18px] w-[18px]"
                name={isExecutableEditTemplate ? "wand.and.stars" : "sparkles"}
                tintColor="#FFFFFF"
              />
            )}
            <Text className="text-base font-extrabold text-white">
              {getSubmitButtonText(isExecutableEditTemplate, isSubmitting)}
            </Text>
          </Pressable>
        </>
      )}
      <Modal
        animationType="slide"
        onRequestClose={closeTaskInputEditor}
        presentationStyle="pageSheet"
        visible={editingInput !== null}
      >
        {editingInput ? (
          <View className="flex-1 gap-4 bg-sf-bg p-5 pt-6">
            <View className="flex-row items-center gap-3">
              <Pressable
                accessibilityLabel="关闭编辑"
                accessibilityRole="button"
                onPress={closeTaskInputEditor}
                className="h-10 w-10 items-center justify-center rounded-lg border border-sf-separator"
              >
                <SymbolIcon
                  className="h-[22px] w-[22px]"
                  name="xmark"
                  tintColor={textColor}
                />
              </Pressable>
              <View className="flex-1 gap-0.5">
                <Text
                  className="text-lg font-extrabold text-sf-text"
                  numberOfLines={1}
                  selectable
                >
                  {editingInput.name}
                </Text>
                <Text
                  className="text-[13px] font-bold text-sf-text-2"
                  numberOfLines={1}
                  selectable
                >
                  {editingInput.description}
                </Text>
              </View>
              <Pressable
                accessibilityLabel={
                  isEditingInputText ? "完成编辑" : "编辑内容"
                }
                accessibilityRole="button"
                onPress={
                  isEditingInputText
                    ? finishTaskInputTextEditing
                    : beginTaskInputTextEditing
                }
                className="min-h-10 items-center justify-center rounded-lg bg-sf-blue px-3.5 active:opacity-75"
              >
                <Text className="text-sm font-extrabold text-white">
                  {isEditingInputText ? "完成" : "编辑"}
                </Text>
              </Pressable>
            </View>
            {isEditingInputText ? (
              <TextInput
                autoFocus
                multiline
                onChangeText={(value) =>
                  updateTaskInput(editingInput.name, value)
                }
                placeholder={editingInput.description}
                placeholderTextColor={placeholderColor}
                className="flex-1 rounded-lg border border-sf-separator bg-sf-bg-2 p-3.5 text-base leading-6 text-sf-text"
                textAlignVertical="top"
                value={taskInputs[editingInput.name] ?? ""}
              />
            ) : (
              <ScrollView
                className="flex-1 rounded-lg border border-sf-separator bg-sf-bg-2"
                contentContainerClassName="flex-grow p-3.5"
              >
                <Text
                  className={cn(
                    "text-base leading-6 text-sf-text",
                    !taskInputs[editingInput.name] && "text-sf-text-3",
                  )}
                  selectable
                >
                  {taskInputs[editingInput.name] || editingInput.description}
                </Text>
              </ScrollView>
            )}
          </View>
        ) : null}
      </Modal>
    </ScrollView>
  );
}

function EntryImagesSection({
  images,
  onOpenImage,
}: {
  images: HydratedPromptdexEntryImage[];
  onOpenImage(imageResult: ImageResult): void;
}) {
  if (images.length === 0) {
    return null;
  }

  const representative = images[0];
  const aspectRatio =
    representative.imageResult.width && representative.imageResult.height
      ? representative.imageResult.width / representative.imageResult.height
      : 1;
  const accentColor = useCSSVariable("--sf-blue");
  const mutedColor = useCSSVariable("--sf-text-2");
  const textColor = useCSSVariable("--sf-text");

  return (
    <View className="gap-3 rounded-lg border border-sf-separator bg-sf-bg-3 p-4">
      <View className="flex-row items-center gap-2">
        <SymbolIcon
          className="h-[22px] w-[22px]"
          name="photo.on.rectangle"
          tintColor={accentColor}
        />
        <SectionTitle>生成图片</SectionTitle>
      </View>
      <View className="relative w-full overflow-hidden rounded-lg border border-sf-separator bg-sf-fill">
        {representative.imageUri ? (
          <Image
            className="w-full self-center bg-sf-fill object-contain"
            source={{ uri: representative.imageUri }}
            style={{ aspectRatio }}
          />
        ) : (
          <View className="aspect-[16/10] w-full items-center justify-center gap-2 bg-sf-fill">
            <SymbolIcon
              className="h-9 w-9"
              name="photo"
              tintColor={mutedColor}
            />
            <Text className="text-[13px] font-bold text-sf-text-2" selectable>
              图片文件不可用
            </Text>
          </View>
        )}
        <Pressable
          accessibilityLabel="打开代表图详情"
          accessibilityRole="button"
          onPress={() => onOpenImage(representative.imageResult)}
          className="absolute right-2.5 top-2.5 h-[38px] w-[38px] items-center justify-center rounded-lg border border-sf-separator bg-sf-bg/90 active:opacity-75"
        >
          <SymbolIcon
            className="h-[18px] w-[18px]"
            name="photo"
            tintColor={textColor}
          />
        </Pressable>
      </View>
      <View className="gap-2.5">
        {images.map((image, index) => (
          <Pressable
            accessibilityRole="button"
            key={image.imageResult.id}
            onPress={() => onOpenImage(image.imageResult)}
            className="flex-row items-center gap-2.5 rounded-lg border border-sf-separator bg-sf-bg p-2.5 active:opacity-75"
          >
            {image.imageUri ? (
              <Image
                className="h-16 w-16 rounded-lg bg-sf-fill object-cover"
                source={{ uri: image.imageUri }}
              />
            ) : (
              <View className="h-16 w-16 items-center justify-center rounded-lg bg-sf-fill">
                <SymbolIcon
                  className="h-5 w-5"
                  name="photo"
                  tintColor={mutedColor}
                />
              </View>
            )}
            <View className="min-w-0 flex-1 gap-1">
              <Text
                className="text-[15px] font-extrabold text-sf-text"
                selectable
              >
                {index === 0 ? "代表图" : "历史图片"}
              </Text>
              <Text className="text-[13px] font-bold text-sf-text-2" selectable>
                {formatImageSpec(image.imageResult)}
              </Text>
              <Text
                className="text-[13px] font-bold tabular-nums text-sf-text-2"
                selectable
              >
                {formatDateTime(image.imageResult.createdAt)}
              </Text>
            </View>
            <SymbolIcon
              className="h-[18px] w-[18px]"
              name="chevron.right"
              tintColor={mutedColor}
            />
          </Pressable>
        ))}
      </View>
    </View>
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
  const accentColor = useCSSVariable("--sf-blue");
  const mutedColor = useCSSVariable("--sf-text-2");

  return (
    <View className="gap-3 rounded-lg border border-sf-separator bg-sf-bg-3 p-4">
      <View className="flex-row items-center gap-2.5">
        <Pressable
          accessibilityLabel={
            expanded ? "收起 Promptdex Markdown" : "展开 Promptdex Markdown"
          }
          accessibilityRole="button"
          onPress={onToggleExpanded}
          className="min-h-10 flex-1 flex-row items-center justify-between gap-2 active:opacity-75"
        >
          <SectionTitle>Promptdex Markdown</SectionTitle>
          <SymbolIcon
            className="h-5 w-5"
            name={expanded ? "chevron.up" : "chevron.down"}
            tintColor={mutedColor}
          />
        </Pressable>
        <Pressable
          accessibilityLabel="复制 Promptdex Markdown"
          accessibilityRole="button"
          accessibilityState={{ busy: copyInProgress }}
          onPress={onCopy}
          className="h-10 w-10 items-center justify-center rounded-lg border border-sf-separator active:opacity-75"
        >
          {copyInProgress ? (
            <ActivityIndicator color={accentColor} />
          ) : (
            <SymbolIcon
              className="h-5 w-5"
              name="doc.on.doc"
              tintColor={accentColor}
            />
          )}
        </Pressable>
      </View>
      {expanded ? (
        <View className="rounded-lg border border-sf-separator bg-sf-bg p-3">
          <Text
            className="font-mono text-[13px] leading-5 text-sf-text"
            selectable
          >
            {markdown}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function InputDeclarationSection({
  template,
}: {
  template: PromptdexTemplate;
}) {
  return (
    <View className="gap-3 rounded-lg border border-sf-separator bg-sf-bg-3 p-4">
      <SectionTitle>输入声明</SectionTitle>
      <View className="gap-3">
        {Object.entries(template.inputs).map(([inputName, input]) => (
          <View
            className="gap-1.5 rounded-lg border border-sf-separator bg-sf-bg p-3"
            key={inputName}
          >
            <View className="flex-row items-center gap-2.5">
              <Text
                className="flex-1 text-[15px] font-extrabold text-sf-text"
                selectable
              >
                {inputName}
              </Text>
              <Text className="text-xs font-bold text-sf-text-2" selectable>
                {input.required ? "必需" : "可选"}
              </Text>
            </View>
            <Text className="text-sm leading-5 text-sf-text-2" selectable>
              {input.description}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function TaskTypeBadge({ taskType }: { taskType: "generate" | "edit" }) {
  return (
    <Text
      className={cn(
        "overflow-hidden rounded-lg px-2 py-1 text-xs font-bold",
        taskType === "generate"
          ? "bg-sf-fill text-sf-green"
          : "bg-sf-fill text-sf-text-2",
      )}
      selectable
    >
      {taskType === "generate" ? "生成" : "编辑"}
    </Text>
  );
}

function SectionTitle({ children }: { children: string }) {
  return (
    <Text className="text-[17px] font-extrabold text-sf-text" selectable>
      {children}
    </Text>
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

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
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
