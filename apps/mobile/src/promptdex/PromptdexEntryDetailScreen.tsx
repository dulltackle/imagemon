import { Ionicons } from "@expo/vector-icons";
import {
  serializePromptdexTemplateMarkdown,
  type PromptdexTemplate,
} from "@imagemon/core";
import * as Clipboard from "expo-clipboard";
import * as ImagePicker from "expo-image-picker";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Keyboard,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

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
  const isMountedRef = useRef(true);
  const promptdexMarkdownCopyReleaseTimerRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);
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
          ? await runtime.repository.get(runtime.settings.defaultImageModelConfigurationId)
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
      <View style={styles.stateScreen}>
        <ActivityIndicator color="#0F766E" />
      </View>
    );
  }

  if (state.status === "missing") {
    return (
      <View style={styles.stateScreen}>
        <Text style={styles.stateTitle}>图鉴条目不存在</Text>
      </View>
    );
  }

  if (state.status === "failed") {
    return (
      <View style={styles.stateScreen}>
        <Text selectable style={styles.failureText}>
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
    (input) => !input.required || (taskInputs[input.name] ?? "").trim().length > 0,
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
      Math.max(0, PROMPTDEX_MARKDOWN_COPY_DEBOUNCE_MS - (Date.now() - startedAt)),
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
      : textInputs.find((input) => input.name === editingInputName) ?? null;

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
        const hydratedImage = await hydrateEntryImage(runtime.imageFileStorage, {
          imageResult: result.imageResult,
          taskHistory: result.history,
        });
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
      return <ActivityIndicator color="#0F766E" />;
    }
    if (defaultImageConfiguration) {
      return (
        <View style={styles.modelSummary}>
          <Text numberOfLines={1} style={styles.modelName}>
            {defaultImageConfiguration.modelName}
          </Text>
          <Text numberOfLines={1} style={styles.modelMeta}>
            {formatBaseUrlBrief(defaultImageConfiguration.baseUrl)}
          </Text>
        </View>
      );
    }
    return (
      <View style={styles.modelSummary}>
        <Text style={styles.warningText}>
          {failureMessage("missing_default_model_configuration")}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push("/model-configurations")}
          style={({ pressed }) => [
            styles.secondaryButton,
            pressed && styles.pressed,
          ]}
        >
          <Ionicons color="#0F766E" name="settings-outline" size={18} />
          <Text style={styles.secondaryButtonText}>配置图片模型</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.content}
      style={styles.screen}
    >
      <View style={styles.section}>
        <View style={styles.entryHeading}>
          <Text numberOfLines={2} style={styles.entryTitle}>
            {template.name}
          </Text>
          <Text
            style={[
              styles.sourceBadge,
              entry.sourceType === "personal"
                ? styles.personalSourceBadge
                : styles.builtInSourceBadge,
            ]}
          >
            {entry.sourceLabel}
          </Text>
        </View>
        <View style={styles.statusRow}>
          <TaskTypeBadge taskType={template.taskType} />
          <Text style={styles.metaText}>
            {isUnsupportedMaskEditTemplate ? "蒙版编辑后续支持" : "可执行"}
          </Text>
        </View>
        <Text style={styles.description}>{template.description}</Text>
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
          style={
            promptdexMarkdownCopyPresentation.feedback.tone === "success"
              ? styles.noticeBox
              : styles.failureBox
          }
        >
          <Ionicons
            color={
              promptdexMarkdownCopyPresentation.feedback.tone === "success"
                ? "#0F766E"
                : "#B91C1C"
            }
            name={
              promptdexMarkdownCopyPresentation.feedback.tone === "success"
                ? "checkmark-circle-outline"
                : "alert-circle-outline"
            }
            size={20}
          />
          <Text
            style={
              promptdexMarkdownCopyPresentation.feedback.tone === "success"
                ? styles.noticeText
                : styles.failureText
            }
          >
            {promptdexMarkdownCopyPresentation.feedback.message}
          </Text>
        </View>
      ) : null}

      {isUnsupportedMaskEditTemplate ? (
        <>
          <InputDeclarationSection template={template} />
          <View style={styles.noticeBox}>
            <Ionicons color="#64748B" name="lock-closed-outline" size={20} />
            <Text style={styles.noticeText}>包含蒙版输入，后续支持。</Text>
          </View>
        </>
      ) : (
        <>
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionTitleRow}>
                <Ionicons color="#0F766E" name="image-outline" size={22} />
                <Text style={styles.sectionTitle}>图片模型</Text>
              </View>
              {renderModelConfiguration()}
            </View>
          </View>

          {isExecutableEditTemplate ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>编辑输入</Text>
              <View style={styles.editImagePicker}>
                {pickedEditImage ? (
                  <Image
                    resizeMode="cover"
                    source={{ uri: pickedEditImage.uri }}
                    style={styles.editImagePreview}
                  />
                ) : (
                  <View style={styles.editImagePlaceholder}>
                    <Ionicons color="#94A3B8" name="image-outline" size={28} />
                  </View>
                )}
                <View style={styles.editImageInfo}>
                  <Text style={styles.inputName}>输入图片</Text>
                  <Text style={styles.inputDescription}>
                    {pickedEditImage
                      ? `${pickedEditImage.width} × ${pickedEditImage.height} · ${formatByteSize(pickedEditImage.byteSize)}`
                      : "从系统相册选择一张图片。"}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    disabled={isPickingEditImage || isSubmitting}
                    onPress={handlePickEditImage}
                    style={({ pressed }) => [
                      styles.secondaryButton,
                      (isPickingEditImage || isSubmitting) &&
                        styles.disabledSecondaryButton,
                      pressed && !isPickingEditImage && !isSubmitting && styles.pressed,
                    ]}
                  >
                    {isPickingEditImage ? (
                      <ActivityIndicator color="#0F766E" />
                    ) : (
                      <Ionicons color="#0F766E" name="images-outline" size={18} />
                    )}
                    <Text style={styles.secondaryButtonText}>
                      {pickedEditImage ? "重新选择" : "从相册选择"}
                    </Text>
                  </Pressable>
                </View>
              </View>
            </View>
          ) : null}

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>任务输入</Text>
            <View style={styles.inputList}>
              {textInputs.map((input) => (
                <View key={input.name} style={styles.inputFieldGroup}>
                  <View style={styles.inputHeader}>
                    <Text style={styles.inputName}>{input.name}</Text>
                    <Text style={styles.inputRequirement}>
                      {input.required ? "必需" : "可选"}
                    </Text>
                  </View>
                  <Text style={styles.inputDescription}>{input.description}</Text>
                  <Pressable
                    accessibilityLabel={`编辑 ${input.name}`}
                    accessibilityRole="button"
                    onPress={() => openTaskInputEditor(input.name)}
                    style={({ pressed }) => [
                      styles.inputPreview,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text
                      numberOfLines={4}
                      style={[
                        styles.inputPreviewText,
                        !taskInputs[input.name] && styles.inputPreviewPlaceholder,
                      ]}
                    >
                      {taskInputs[input.name] || input.description}
                    </Text>
                    <View style={styles.inputPreviewFooter}>
                      <Text style={styles.inputPreviewMeta}>
                        {(taskInputs[input.name] ?? "").length} 字
                      </Text>
                      <Ionicons color="#64748B" name="expand-outline" size={18} />
                    </View>
                  </Pressable>
                </View>
              ))}
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>尺寸</Text>
            <View style={styles.sizeSelector}>
              {IMAGE_TASK_AVAILABLE_SIZES.map((option) => {
                const selected = option === size;
                return (
                  <Pressable
                    accessibilityRole="button"
                    key={option}
                    onPress={() => setSize(option)}
                    style={({ pressed }) => [
                      styles.sizeOption,
                      selected && styles.selectedSizeOption,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text
                      style={[
                        styles.sizeLabel,
                        selected && styles.selectedSizeLabel,
                      ]}
                    >
                      {SIZE_LABELS[option]}
                    </Text>
                    <Text
                      style={[
                        styles.sizeMeta,
                        selected && styles.selectedSizeMeta,
                      ]}
                    >
                      {option}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {failure ? (
            <View style={styles.failureBox}>
              <Ionicons color="#B91C1C" name="alert-circle-outline" size={20} />
              <Text style={styles.failureText}>{formatFailureText(failure)}</Text>
            </View>
          ) : null}

          {notice ? (
            <View style={styles.noticeBox}>
              <Ionicons
                color="#0F766E"
                name={
                  isSubmitting ? "hourglass-outline" : "checkmark-circle-outline"
                }
                size={20}
              />
              <Text style={styles.noticeText}>{notice}</Text>
            </View>
          ) : null}

          <Pressable
            accessibilityRole="button"
            disabled={!canSubmit}
            onPress={handleSubmit}
            style={({ pressed }) => [
              styles.primaryButton,
              !canSubmit && styles.disabledButton,
              pressed && canSubmit && styles.pressed,
            ]}
          >
            {isSubmitting ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Ionicons
                color="#FFFFFF"
                name={
                  isExecutableEditTemplate ? "color-wand-outline" : "sparkles-outline"
                }
                size={18}
              />
            )}
            <Text style={styles.primaryButtonText}>
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
          <View style={styles.editorScreen}>
            <View style={styles.editorHeader}>
              <Pressable
                accessibilityLabel="关闭编辑"
                accessibilityRole="button"
                onPress={closeTaskInputEditor}
                style={styles.iconButton}
              >
                <Ionicons color="#0F172A" name="close" size={22} />
              </Pressable>
              <View style={styles.editorHeaderText}>
                <Text numberOfLines={1} style={styles.editorTitle}>
                  {editingInput.name}
                </Text>
                <Text numberOfLines={1} style={styles.editorDescription}>
                  {editingInput.description}
                </Text>
              </View>
              <Pressable
                accessibilityLabel={isEditingInputText ? "完成编辑" : "编辑内容"}
                accessibilityRole="button"
                onPress={
                  isEditingInputText
                    ? finishTaskInputTextEditing
                    : beginTaskInputTextEditing
                }
                style={({ pressed }) => [
                  styles.editorDoneButton,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.editorDoneButtonText}>
                  {isEditingInputText ? "完成" : "编辑"}
                </Text>
              </Pressable>
            </View>
            {isEditingInputText ? (
              <TextInput
                autoFocus
                multiline
                onChangeText={(value) => updateTaskInput(editingInput.name, value)}
                placeholder={editingInput.description}
                placeholderTextColor="#94A3B8"
                style={styles.editorTextInput}
                textAlignVertical="top"
                value={taskInputs[editingInput.name] ?? ""}
              />
            ) : (
              <ScrollView
                contentContainerStyle={styles.editorViewerContent}
                style={styles.editorViewer}
              >
                <Text
                  selectable
                  style={[
                    styles.editorViewerText,
                    !taskInputs[editingInput.name] &&
                      styles.editorViewerPlaceholder,
                  ]}
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

  return (
    <View style={styles.section}>
      <View style={styles.sectionTitleRow}>
        <Ionicons color="#0F766E" name="images-outline" size={22} />
        <Text style={styles.sectionTitle}>生成图片</Text>
      </View>
      <View style={styles.representativeImageFrame}>
        {representative.imageUri ? (
          <Image
            resizeMode="contain"
            source={{ uri: representative.imageUri }}
            style={[styles.representativeImage, { aspectRatio }]}
          />
        ) : (
          <View style={styles.representativeImagePlaceholder}>
            <Ionicons color="#94A3B8" name="image-outline" size={36} />
            <Text style={styles.metaText}>图片文件不可用</Text>
          </View>
        )}
        <Pressable
          accessibilityLabel="打开代表图详情"
          accessibilityRole="button"
          onPress={() => onOpenImage(representative.imageResult)}
          style={({ pressed }) => [
            styles.representativeImageButton,
            pressed && styles.pressed,
          ]}
        >
          <Ionicons color="#0F172A" name="image-outline" size={18} />
        </Pressable>
      </View>
      <View style={styles.entryImageList}>
        {images.map((image, index) => (
          <Pressable
            accessibilityRole="button"
            key={image.imageResult.id}
            onPress={() => onOpenImage(image.imageResult)}
            style={({ pressed }) => [
              styles.entryImageRow,
              pressed && styles.pressed,
            ]}
          >
            {image.imageUri ? (
              <Image
                resizeMode="cover"
                source={{ uri: image.imageUri }}
                style={styles.entryImageThumbnail}
              />
            ) : (
              <View style={styles.entryImageThumbnailPlaceholder}>
                <Ionicons color="#94A3B8" name="image-outline" size={20} />
              </View>
            )}
            <View style={styles.entryImageInfo}>
              <Text style={styles.entryImageTitle}>
                {index === 0 ? "代表图" : "历史图片"}
              </Text>
              <Text style={styles.metaText}>{formatImageSpec(image.imageResult)}</Text>
              <Text style={styles.metaText}>
                {formatDateTime(image.imageResult.createdAt)}
              </Text>
            </View>
            <Ionicons color="#94A3B8" name="chevron-forward" size={18} />
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
  return (
    <View style={styles.section}>
      <View style={styles.markdownHeader}>
        <Pressable
          accessibilityLabel={
            expanded ? "收起 Promptdex Markdown" : "展开 Promptdex Markdown"
          }
          accessibilityRole="button"
          onPress={onToggleExpanded}
          style={({ pressed }) => [
            styles.markdownToggle,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.sectionTitle}>Promptdex Markdown</Text>
          <Ionicons
            color="#64748B"
            name={expanded ? "chevron-up" : "chevron-down"}
            size={20}
          />
        </Pressable>
        <Pressable
          accessibilityLabel="复制 Promptdex Markdown"
          accessibilityRole="button"
          accessibilityState={{ busy: copyInProgress }}
          onPress={onCopy}
          style={({ pressed }) => [
            styles.iconButton,
            pressed && !copyInProgress && styles.pressed,
          ]}
        >
          {copyInProgress ? (
            <ActivityIndicator color="#0F766E" />
          ) : (
            <Ionicons color="#0F766E" name="copy-outline" size={20} />
          )}
        </Pressable>
      </View>
      {expanded ? (
        <View style={styles.markdownViewer}>
          <Text selectable style={styles.markdownText}>
            {markdown}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function InputDeclarationSection({ template }: { template: PromptdexTemplate }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>输入声明</Text>
      <View style={styles.inputList}>
        {Object.entries(template.inputs).map(([inputName, input]) => (
          <View key={inputName} style={styles.inputRow}>
            <View style={styles.inputHeader}>
              <Text style={styles.inputName}>{inputName}</Text>
              <Text style={styles.inputRequirement}>
                {input.required ? "必需" : "可选"}
              </Text>
            </View>
            <Text style={styles.inputDescription}>{input.description}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function TaskTypeBadge({ taskType }: { taskType: "generate" | "edit" }) {
  return (
    <Text
      style={[
        styles.badge,
        taskType === "generate" ? styles.generateBadge : styles.editBadge,
      ]}
    >
      {taskType === "generate" ? "生成" : "编辑"}
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

const styles = StyleSheet.create({
  badge: {
    borderRadius: 8,
    fontSize: 12,
    fontWeight: "700",
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  content: {
    gap: 16,
    padding: 20,
    paddingBottom: 32,
  },
  description: {
    color: "#475569",
    fontSize: 15,
    lineHeight: 22,
  },
  disabledButton: {
    backgroundColor: "#94A3B8",
  },
  disabledSecondaryButton: {
    opacity: 0.6,
  },
  editBadge: {
    backgroundColor: "#F1F5F9",
    color: "#475569",
  },
  editImageInfo: {
    flex: 1,
    gap: 8,
  },
  editImagePicker: {
    alignItems: "center",
    flexDirection: "row",
    gap: 14,
  },
  editImagePlaceholder: {
    alignItems: "center",
    aspectRatio: 1,
    backgroundColor: "#F8FAFC",
    borderColor: "#CBD5E1",
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: "center",
    width: 104,
  },
  editImagePreview: {
    aspectRatio: 1,
    backgroundColor: "#F1F5F9",
    borderRadius: 8,
    width: 104,
  },
  editorDescription: {
    color: "#64748B",
    fontSize: 13,
    fontWeight: "700",
  },
  editorDoneButton: {
    alignItems: "center",
    backgroundColor: "#0F766E",
    borderRadius: 8,
    justifyContent: "center",
    minHeight: 40,
    paddingHorizontal: 14,
  },
  editorDoneButtonText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "800",
  },
  editorHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
  },
  editorHeaderText: {
    flex: 1,
    gap: 2,
  },
  editorScreen: {
    backgroundColor: "#FFFFFF",
    flex: 1,
    gap: 16,
    padding: 20,
    paddingTop: 24,
  },
  editorViewer: {
    backgroundColor: "#F8FAFC",
    borderColor: "#CBD5E1",
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
  },
  editorViewerContent: {
    flexGrow: 1,
    padding: 14,
  },
  editorViewerPlaceholder: {
    color: "#94A3B8",
  },
  editorViewerText: {
    color: "#0F172A",
    fontSize: 16,
    lineHeight: 24,
  },
  editorTextInput: {
    backgroundColor: "#F8FAFC",
    borderColor: "#CBD5E1",
    borderRadius: 8,
    borderWidth: 1,
    color: "#0F172A",
    flex: 1,
    fontSize: 16,
    lineHeight: 24,
    padding: 14,
  },
  editorTitle: {
    color: "#0F172A",
    fontSize: 18,
    fontWeight: "800",
  },
  failureBox: {
    alignItems: "flex-start",
    backgroundColor: "#FEF2F2",
    borderColor: "#FECACA",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    padding: 14,
  },
  failureText: {
    color: "#991B1B",
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  generateBadge: {
    backgroundColor: "#CCFBF1",
    color: "#0F766E",
  },
  iconButton: {
    alignItems: "center",
    borderColor: "#CBD5E1",
    borderRadius: 8,
    borderWidth: 1,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  inputDescription: {
    color: "#475569",
    fontSize: 14,
    lineHeight: 20,
  },
  inputFieldGroup: {
    gap: 8,
  },
  inputHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
  },
  inputList: {
    gap: 12,
  },
  inputName: {
    color: "#0F172A",
    flex: 1,
    fontSize: 15,
    fontWeight: "800",
  },
  inputRequirement: {
    color: "#64748B",
    fontSize: 12,
    fontWeight: "700",
  },
  inputPreview: {
    backgroundColor: "#F8FAFC",
    borderColor: "#CBD5E1",
    borderRadius: 8,
    borderWidth: 1,
    height: 132,
    justifyContent: "space-between",
    padding: 12,
  },
  inputPreviewFooter: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    justifyContent: "space-between",
  },
  inputPreviewMeta: {
    color: "#64748B",
    fontSize: 12,
    fontVariant: ["tabular-nums"],
    fontWeight: "700",
  },
  inputPreviewPlaceholder: {
    color: "#94A3B8",
  },
  inputPreviewText: {
    color: "#0F172A",
    fontSize: 15,
    lineHeight: 22,
  },
  inputRow: {
    backgroundColor: "#F8FAFC",
    borderColor: "#E2E8F0",
    borderRadius: 8,
    borderWidth: 1,
    gap: 6,
    padding: 12,
  },
  metaText: {
    color: "#64748B",
    fontSize: 13,
    fontWeight: "700",
  },
  markdownHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
  },
  markdownText: {
    color: "#0F172A",
    fontFamily: "monospace",
    fontSize: 13,
    lineHeight: 20,
  },
  markdownToggle: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: 8,
    justifyContent: "space-between",
    minHeight: 40,
  },
  markdownViewer: {
    backgroundColor: "#F8FAFC",
    borderColor: "#CBD5E1",
    borderRadius: 8,
    borderWidth: 1,
    padding: 12,
  },
  modelMeta: {
    color: "#64748B",
    fontSize: 13,
  },
  modelName: {
    color: "#0F172A",
    fontSize: 14,
    fontWeight: "700",
  },
  modelSummary: {
    alignItems: "flex-start",
    gap: 8,
  },
  noticeBox: {
    alignItems: "flex-start",
    backgroundColor: "#ECFDF5",
    borderColor: "#A7F3D0",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    padding: 14,
  },
  noticeText: {
    color: "#0F766E",
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  pressed: {
    opacity: 0.72,
  },
  entryImageInfo: {
    flex: 1,
    gap: 4,
    minWidth: 0,
  },
  entryImageList: {
    gap: 10,
  },
  entryImageRow: {
    alignItems: "center",
    backgroundColor: "#F8FAFC",
    borderColor: "#E2E8F0",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    padding: 10,
  },
  entryImageThumbnail: {
    backgroundColor: "#E2E8F0",
    borderRadius: 8,
    height: 64,
    width: 64,
  },
  entryImageThumbnailPlaceholder: {
    alignItems: "center",
    backgroundColor: "#F1F5F9",
    borderRadius: 8,
    height: 64,
    justifyContent: "center",
    width: 64,
  },
  entryImageTitle: {
    color: "#0F172A",
    fontSize: 15,
    fontWeight: "800",
  },
  entryHeading: {
    gap: 6,
  },
  entryTitle: {
    color: "#0F172A",
    fontSize: 24,
    fontWeight: "800",
    lineHeight: 30,
  },
  builtInSourceBadge: {
    backgroundColor: "#F1F5F9",
    color: "#475569",
  },
  personalSourceBadge: {
    backgroundColor: "#EEF2FF",
    color: "#4338CA",
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: "#0F766E",
    borderRadius: 8,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "800",
  },
  representativeImage: {
    alignSelf: "center",
    backgroundColor: "#E2E8F0",
    width: "100%",
  },
  representativeImageButton: {
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.9)",
    borderColor: "rgba(15, 23, 42, 0.12)",
    borderRadius: 8,
    borderWidth: 1,
    height: 38,
    justifyContent: "center",
    position: "absolute",
    right: 10,
    top: 10,
    width: 38,
  },
  representativeImageFrame: {
    backgroundColor: "#E2E8F0",
    borderColor: "#E2E8F0",
    borderRadius: 8,
    borderWidth: 1,
    overflow: "hidden",
    position: "relative",
    width: "100%",
  },
  representativeImagePlaceholder: {
    alignItems: "center",
    aspectRatio: 16 / 10,
    backgroundColor: "#F1F5F9",
    gap: 8,
    justifyContent: "center",
    width: "100%",
  },
  screen: {
    backgroundColor: "#F8FAFC",
    flex: 1,
  },
  secondaryButton: {
    alignItems: "center",
    borderColor: "#0F766E",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  secondaryButtonText: {
    color: "#0F766E",
    fontSize: 14,
    fontWeight: "800",
  },
  section: {
    backgroundColor: "#FFFFFF",
    borderColor: "#E2E8F0",
    borderRadius: 8,
    borderWidth: 1,
    gap: 12,
    padding: 16,
  },
  sectionHeader: {
    gap: 12,
  },
  sectionTitle: {
    color: "#0F172A",
    fontSize: 17,
    fontWeight: "800",
  },
  sectionTitleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  selectedSizeLabel: {
    color: "#0F766E",
  },
  selectedSizeMeta: {
    color: "#0F766E",
  },
  selectedSizeOption: {
    backgroundColor: "#ECFDF5",
    borderColor: "#0F766E",
  },
  sizeLabel: {
    color: "#0F172A",
    fontSize: 14,
    fontWeight: "800",
  },
  sizeMeta: {
    color: "#64748B",
    fontSize: 12,
    fontWeight: "700",
  },
  sizeOption: {
    alignItems: "center",
    borderColor: "#CBD5E1",
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    gap: 4,
    minHeight: 64,
    justifyContent: "center",
    paddingHorizontal: 8,
    paddingVertical: 10,
  },
  sizeSelector: {
    flexDirection: "row",
    gap: 8,
  },
  sourceBadge: {
    alignSelf: "flex-start",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: "700",
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  stateScreen: {
    alignItems: "center",
    backgroundColor: "#F8FAFC",
    flex: 1,
    justifyContent: "center",
    padding: 24,
  },
  stateTitle: {
    color: "#0F172A",
    fontSize: 20,
    fontWeight: "800",
  },
  statusRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
  },
  warningText: {
    color: "#B45309",
    fontSize: 14,
    lineHeight: 20,
  },
});
