import { Ionicons } from "@expo/vector-icons";
import type { PromptdexTemplate } from "@imagemon/core";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
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
  createPromptdexImageGenerationTaskService,
  failureMessage,
  type ImageTaskFailureSummary,
  type ImageTaskSize,
} from "../image-tasks";
import { useModelCallLock } from "../model-calls";
import type { ModelConfiguration } from "../model-configurations";
import {
  findBuiltInPromptdexTemplate,
  getTextPromptdexInputs,
} from "./index";

const SIZE_LABELS: Record<ImageTaskSize, string> = {
  "1024x1024": "方图",
  "1536x1024": "横图",
  "1024x1536": "竖图",
};

type DetailState =
  | { status: "loading" }
  | { status: "missing" }
  | { status: "failed"; message: string }
  | { status: "ready"; template: PromptdexTemplate };

export function PromptdexEntryDetailScreen() {
  const params = useLocalSearchParams<{ name?: string }>();
  const router = useRouter();
  const runtime = useReadyAppRuntime();
  const modelCallLock = useModelCallLock();
  const isMountedRef = useRef(true);
  const [state, setState] = useState<DetailState>({ status: "loading" });
  const [taskInputs, setTaskInputs] = useState<Record<string, string>>({});
  const [size, setSize] = useState<ImageTaskSize>("1024x1024");
  const [defaultImageConfiguration, setDefaultImageConfiguration] =
    useState<ModelConfiguration | null>(null);
  const [isLoadingDefault, setIsLoadingDefault] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [failure, setFailure] = useState<ImageTaskFailureSummary | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editingInputName, setEditingInputName] = useState<string | null>(null);
  const name = typeof params.name === "string" ? params.name : null;

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!name) {
      setState({ status: "missing" });
      return;
    }

    try {
      const template = findBuiltInPromptdexTemplate(name);
      if (!template) {
        setState({ status: "missing" });
        return;
      }
      setState({ status: "ready", template });
      setTaskInputs(
        Object.fromEntries(
          getTextPromptdexInputs(template.inputs).map((input) => [input.name, ""]),
        ),
      );
      setFailure(null);
      setNotice(null);
    } catch (error) {
      setState({
        status: "failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, [name]);

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

  const { template } = state;
  const textInputs = getTextPromptdexInputs(template.inputs);
  const requiredInputsFilled = textInputs.every(
    (input) => !input.required || (taskInputs[input.name] ?? "").trim().length > 0,
  );
  const canSubmit =
    template.taskType === "generate" &&
    requiredInputsFilled &&
    defaultImageConfiguration !== null &&
    !isSubmitting &&
    modelCallLock.activeCall === null;

  function updateTaskInput(inputName: string, value: string) {
    setTaskInputs((current) => ({
      ...current,
      [inputName]: value,
    }));
    setFailure(null);
    setNotice(null);
  }

  function closeTaskInputEditor() {
    setEditingInputName(null);
  }

  const editingInput =
    editingInputName === null
      ? null
      : textInputs.find((input) => input.name === editingInputName) ?? null;

  async function handleSubmit() {
    if (template.taskType !== "generate") {
      setFailure({
        reason: "invalid_input",
        message: failureMessage("invalid_input"),
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

    const lock = modelCallLock.beginModelCall("imageGeneration");
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
    setNotice("正在生成图片。");

    try {
      const service = createPromptdexImageGenerationTaskService({
        imageTaskRepository: runtime.imageTaskRepository,
        modelConfigurationRepository: runtime.repository,
        fileStorage: runtime.imageFileStorage,
      });
      const result = await service.run({
        template,
        taskInputs,
        size,
        sourceType: "built-in",
      });
      if (!isMountedRef.current) {
        return;
      }

      if (result.status === "succeeded") {
        setFailure(null);
        setNotice("生成完成，图片已保存。");
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
    <ScrollView contentContainerStyle={styles.content} style={styles.screen}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.back()}
          style={styles.iconButton}
        >
          <Ionicons color="#0F172A" name="chevron-back" size={22} />
        </Pressable>
        <View style={styles.headerText}>
          <Text numberOfLines={2} style={styles.title}>
            {template.name}
          </Text>
          <Text style={styles.sourceText}>内置图鉴</Text>
        </View>
      </View>

      <View style={styles.section}>
        <View style={styles.statusRow}>
          <TaskTypeBadge taskType={template.taskType} />
          <Text style={styles.metaText}>
            {template.taskType === "generate" ? "可执行" : "编辑任务后续支持"}
          </Text>
        </View>
        <Text style={styles.description}>{template.description}</Text>
      </View>

      {template.taskType === "edit" ? (
        <>
          <InputDeclarationSection template={template} />
          <View style={styles.noticeBox}>
            <Ionicons color="#64748B" name="lock-closed-outline" size={20} />
            <Text style={styles.noticeText}>编辑任务后续支持。</Text>
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
                    onPress={() => setEditingInputName(input.name)}
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
              <Ionicons color="#FFFFFF" name="sparkles-outline" size={18} />
            )}
            <Text style={styles.primaryButtonText}>
              {isSubmitting ? "生成中" : "生成图片"}
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
                accessibilityRole="button"
                onPress={closeTaskInputEditor}
                style={({ pressed }) => [
                  styles.editorDoneButton,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.editorDoneButtonText}>完成</Text>
              </Pressable>
            </View>
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
          </View>
        ) : null}
      </Modal>
    </ScrollView>
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
  editBadge: {
    backgroundColor: "#F1F5F9",
    color: "#475569",
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
  header: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    paddingTop: 8,
  },
  headerText: {
    flex: 1,
    gap: 4,
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
  sourceText: {
    color: "#64748B",
    fontSize: 13,
    fontWeight: "700",
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
  title: {
    color: "#0F172A",
    fontSize: 24,
    fontWeight: "800",
  },
  warningText: {
    color: "#B45309",
    fontSize: 14,
    lineHeight: 20,
  },
});
