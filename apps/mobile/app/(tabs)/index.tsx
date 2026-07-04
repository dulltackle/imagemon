import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { useReadyAppRuntime } from "../../src/app-state";
import {
  IMAGE_TASK_AVAILABLE_SIZES,
  createImageGenerationTaskService,
  failureMessage,
  type ImageTaskFailureSummary,
  type ImageTaskSize,
} from "../../src/image-tasks";
import { useModelCallLock } from "../../src/model-calls";
import type { ModelConfiguration } from "../../src/model-configurations";

const SIZE_LABELS: Record<ImageTaskSize, string> = {
  "1024x1024": "方图",
  "1536x1024": "横图",
  "1024x1536": "竖图",
};

export default function CreateScreen() {
  const router = useRouter();
  const runtime = useReadyAppRuntime();
  const modelCallLock = useModelCallLock();
  const isMountedRef = useRef(true);
  const [prompt, setPrompt] = useState("");
  const [size, setSize] = useState<ImageTaskSize>("1024x1024");
  const [defaultImageConfiguration, setDefaultImageConfiguration] =
    useState<ModelConfiguration | null>(null);
  const [isLoadingDefault, setIsLoadingDefault] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [failure, setFailure] = useState<ImageTaskFailureSummary | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

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

  const canSubmit =
    prompt.trim().length > 0 &&
    defaultImageConfiguration !== null &&
    !isSubmitting &&
    modelCallLock.activeCall === null;

  async function handleSubmit() {
    if (prompt.trim().length === 0) {
      setFailure({
        reason: "invalid_input",
        message: failureMessage("invalid_input"),
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
      const service = createImageGenerationTaskService({
        imageTaskRepository: runtime.imageTaskRepository,
        modelConfigurationRepository: runtime.repository,
        fileStorage: runtime.imageFileStorage,
      });
      const result = await service.run({ prompt, size });
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
        await runtime.refreshSettings();
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

  return (
    <ScrollView contentContainerStyle={styles.content} style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>创建</Text>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <View style={styles.sectionTitleRow}>
            <Ionicons color="#0F766E" name="image-outline" size={22} />
            <Text style={styles.sectionTitle}>图片模型</Text>
          </View>
          {isLoadingDefault ? (
            <ActivityIndicator color="#0F766E" />
          ) : defaultImageConfiguration ? (
            <View style={styles.modelSummary}>
              <Text numberOfLines={1} style={styles.modelName}>
                {defaultImageConfiguration.modelName}
              </Text>
              <Text numberOfLines={1} style={styles.modelMeta}>
                {formatBaseUrlBrief(defaultImageConfiguration.baseUrl)}
              </Text>
            </View>
          ) : (
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
          )}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>完整提示词</Text>
        <TextInput
          multiline
          onChangeText={(value) => {
            setPrompt(value);
            setFailure(null);
            setNotice(null);
          }}
          placeholder="输入本次图片任务的完整提示词"
          placeholderTextColor="#94A3B8"
          style={styles.promptInput}
          textAlignVertical="top"
          value={prompt}
        />
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
            name={isSubmitting ? "hourglass-outline" : "checkmark-circle-outline"}
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
    </ScrollView>
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
  content: {
    gap: 18,
    padding: 20,
    paddingBottom: 32,
  },
  disabledButton: {
    opacity: 0.5,
  },
  failureBox: {
    alignItems: "center",
    backgroundColor: "#FEF2F2",
    borderColor: "#FECACA",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    padding: 12,
  },
  failureText: {
    color: "#991B1B",
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  header: {
    paddingTop: 8,
  },
  modelMeta: {
    color: "#64748B",
    fontSize: 13,
  },
  modelName: {
    color: "#0F172A",
    fontSize: 16,
    fontWeight: "700",
  },
  modelSummary: {
    gap: 8,
  },
  noticeBox: {
    alignItems: "center",
    backgroundColor: "#ECFDF5",
    borderColor: "#A7F3D0",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    padding: 12,
  },
  noticeText: {
    color: "#047857",
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  pressed: {
    opacity: 0.78,
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: "#0F766E",
    borderRadius: 8,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: 16,
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "800",
  },
  promptInput: {
    backgroundColor: "#FFFFFF",
    borderColor: "#CBD5E1",
    borderRadius: 8,
    borderWidth: 1,
    color: "#0F172A",
    fontSize: 16,
    lineHeight: 22,
    minHeight: 180,
    padding: 14,
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
    justifyContent: "center",
    minHeight: 42,
    paddingHorizontal: 14,
  },
  secondaryButtonText: {
    color: "#0F766E",
    fontSize: 14,
    fontWeight: "700",
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
    gap: 10,
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
    color: "#FFFFFF",
  },
  selectedSizeMeta: {
    color: "#CCFBF1",
  },
  selectedSizeOption: {
    backgroundColor: "#0F766E",
    borderColor: "#0F766E",
  },
  sizeLabel: {
    color: "#0F172A",
    fontSize: 15,
    fontWeight: "800",
    textAlign: "center",
  },
  sizeMeta: {
    color: "#64748B",
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
  },
  sizeOption: {
    alignItems: "center",
    borderColor: "#CBD5E1",
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    gap: 4,
    minHeight: 58,
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  sizeSelector: {
    flexDirection: "row",
    gap: 8,
  },
  title: {
    color: "#0F172A",
    fontSize: 28,
    fontWeight: "800",
  },
  warningText: {
    color: "#B45309",
    fontSize: 14,
    lineHeight: 20,
  },
});
