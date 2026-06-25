import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { useReadyAppRuntime } from "../app-state";
import { useModelCallLock } from "../model-calls";
import type { ModelConnectionFailureSummary } from "./types";
import {
  type ModelConfiguration,
  type ModelConfigurationType,
  testModelConnection,
} from "./index";

interface ModelConfigurationEditorProps {
  initialConfiguration: ModelConfiguration | null;
  initialType: ModelConfigurationType;
}

interface EditorFormState {
  baseUrl: string;
  modelName: string;
  apiKey: string;
}

type BusyState = "saving" | "testing" | "deleting" | "settingDefault" | null;

export function ModelConfigurationEditor({
  initialConfiguration,
  initialType,
}: ModelConfigurationEditorProps) {
  const router = useRouter();
  const runtime = useReadyAppRuntime();
  const modelCallLock = useModelCallLock();
  const [configuration, setConfiguration] = useState<ModelConfiguration | null>(
    initialConfiguration,
  );
  const [type, setType] = useState<ModelConfigurationType>(
    initialConfiguration?.type ?? initialType,
  );
  const [form, setForm] = useState<EditorFormState>(
    initialConfiguration ? formFromConfiguration(initialConfiguration) : defaultForm(initialType),
  );
  const [clearCredential, setClearCredential] = useState(false);
  const [failure, setFailure] = useState<ModelConnectionFailureSummary | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<BusyState>(null);

  const isBusy = busy !== null;
  const isCurrentDefault =
    configuration?.type === "image"
      ? runtime.settings.defaultImageModelConfigurationId === configuration.id
      : configuration?.type === "text"
        ? runtime.settings.defaultTextModelConfigurationId === configuration.id
        : false;
  const canSetDefault = configuration?.isReady === true && !isCurrentDefault;

  function updateForm(next: EditorFormState) {
    setForm(next);
    setFailure(null);
    setNotice(null);
  }

  function handleTypeChange(nextType: ModelConfigurationType) {
    if (configuration || isBusy) {
      return;
    }
    setType(nextType);
    setForm((current) => {
      const previousDefault = defaultForm(type);
      const nextDefault = defaultForm(nextType);
      return {
        ...current,
        modelName:
          current.modelName === previousDefault.modelName
            ? nextDefault.modelName
            : current.modelName,
      };
    });
  }

  async function saveCurrent(): Promise<ModelConfiguration> {
    const saved = await runtime.repository.save({
      id: configuration?.id,
      type,
      baseUrl: form.baseUrl,
      modelName: form.modelName,
      apiKey: form.apiKey.trim().length > 0 ? form.apiKey : undefined,
      clearCredential,
    });
    setConfiguration(saved);
    setType(saved.type);
    setForm((current) => ({
      ...current,
      apiKey: "",
    }));
    setClearCredential(false);
    await runtime.refreshSettings();
    return saved;
  }

  async function handleSave() {
    if (isBusy) {
      return;
    }
    setBusy("saving");
    setFailure(null);
    setNotice(null);
    try {
      const wasNew = configuration === null;
      const saved = await saveCurrent();
      setNotice("已保存草稿。");
      if (wasNew) {
        router.replace({
          pathname: "/model-configurations/[id]",
          params: { id: saved.id },
        });
      }
    } catch (error) {
      setFailure(toFailureSummary(error));
    } finally {
      setBusy(null);
    }
  }

  async function handleTest() {
    if (isBusy) {
      return;
    }

    const lock = modelCallLock.beginModelCall("modelConfigurationTest");
    if (lock.status === "blocked") {
      setFailure({
        reason: "unknown_error",
        message: "已有模型调用正在进行。",
        occurredAt: new Date().toISOString(),
      });
      return;
    }

    setBusy("testing");
    setFailure(null);
    setNotice(null);
    try {
      const wasNew = configuration === null;
      const saved = await saveCurrent();
      const credential =
        form.apiKey.trim().length > 0
          ? form.apiKey
          : await runtime.repository.getCredential(saved.id);
      const result = await testModelConnection({
        baseUrl: saved.baseUrl,
        apiKey: credential,
      });

      if (result.status === "failed") {
        setFailure(result.failure);
        if (wasNew) {
          router.replace({
            pathname: "/model-configurations/[id]",
            params: { id: saved.id },
          });
        }
        return;
      }

      const ready = await runtime.repository.markReady(saved.id, result.testedAt);
      setConfiguration(ready);
      setNotice("测试通过，配置已就绪。");
      if (wasNew) {
        router.replace({
          pathname: "/model-configurations/[id]",
          params: { id: saved.id },
        });
      }
    } catch (error) {
      setFailure(toFailureSummary(error));
    } finally {
      setBusy(null);
      modelCallLock.endModelCall(lock.call.id);
    }
  }

  async function handleSetDefault() {
    if (!configuration || !canSetDefault || isBusy) {
      return;
    }

    setBusy("settingDefault");
    setFailure(null);
    setNotice(null);
    try {
      const settings = await runtime.repository.setDefault(configuration.type, configuration.id);
      runtime.replaceSettings(settings);
      setNotice("已设为默认配置。");
    } catch (error) {
      setFailure(toFailureSummary(error));
    } finally {
      setBusy(null);
    }
  }

  function handleDelete() {
    if (!configuration || isBusy) {
      return;
    }

    Alert.alert("删除模型配置", "删除后会同步删除本机保存的 API Key。", [
      {
        text: "取消",
        style: "cancel",
      },
      {
        text: "删除",
        style: "destructive",
        onPress: () => {
          void deleteConfiguration(configuration.id);
        },
      },
    ]);
  }

  async function deleteConfiguration(id: string) {
    setBusy("deleting");
    setFailure(null);
    setNotice(null);
    try {
      await runtime.repository.delete(id);
      await runtime.refreshSettings();
      router.replace("/model-configurations");
    } catch (error) {
      setFailure(toFailureSummary(error));
    } finally {
      setBusy(null);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.content} style={styles.screen}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          disabled={isBusy}
          onPress={() => router.back()}
          style={[styles.iconButton, isBusy && styles.disabled]}
        >
          <Ionicons color="#0F172A" name="chevron-back" size={22} />
        </Pressable>
        <Text style={styles.title}>{configuration ? "模型配置详情" : "新建模型配置"}</Text>
      </View>

      <View style={styles.typeRow}>
        <TypeSegment
          disabled={configuration !== null || isBusy}
          isSelected={type === "image"}
          label="图片"
          onPress={() => handleTypeChange("image")}
        />
        <TypeSegment
          disabled={configuration !== null || isBusy}
          isSelected={type === "text"}
          label="文本"
          onPress={() => handleTypeChange("text")}
        />
      </View>

      <View style={styles.section}>
        <Field
          autoCapitalize="none"
          editable={!isBusy}
          keyboardType="url"
          label="Base URL"
          onChangeText={(baseUrl) => updateForm({ ...form, baseUrl })}
          value={form.baseUrl}
        />
        <Field
          autoCapitalize="none"
          editable={!isBusy}
          label="模型名"
          onChangeText={(modelName) => updateForm({ ...form, modelName })}
          value={form.modelName}
        />
        <Field
          autoCapitalize="none"
          editable={!isBusy}
          label="API Key"
          onChangeText={(apiKey) => {
            setClearCredential(false);
            updateForm({ ...form, apiKey });
          }}
          secureTextEntry
          value={form.apiKey}
        />
        <View style={styles.credentialRow}>
          <Text style={styles.credentialText}>
            {credentialStatus(configuration, form.apiKey, clearCredential)}
          </Text>
          <Pressable
            accessibilityRole="button"
            disabled={!configuration?.hasCredential || isBusy}
            onPress={() => {
              setClearCredential(true);
              setFailure(null);
              setNotice(null);
            }}
            style={({ pressed }) => [
              styles.clearCredentialButton,
              (!configuration?.hasCredential || isBusy) && styles.disabled,
              pressed && styles.pressed,
            ]}
          >
            <Ionicons color="#B91C1C" name="trash-outline" size={16} />
            <Text style={styles.clearCredentialText}>清除凭据</Text>
          </Pressable>
        </View>
      </View>

      {configuration ? (
        <View style={styles.statusRow}>
          <Text style={[styles.statusText, configuration.isReady ? styles.readyText : styles.notReadyText]}>
            {configuration.isReady ? "就绪" : "未就绪"}
          </Text>
          {isCurrentDefault ? <Text style={styles.defaultBadge}>当前默认</Text> : null}
        </View>
      ) : null}

      {failure ? <Text style={styles.failureText}>{failure.message}</Text> : null}
      {notice ? <Text style={styles.noticeText}>{notice}</Text> : null}

      <View style={styles.actions}>
        <ActionButton
          disabled={isBusy}
          icon="save-outline"
          label={busy === "saving" ? "保存中" : "保存草稿"}
          onPress={() => {
            void handleSave();
          }}
        />
        <ActionButton
          disabled={isBusy}
          icon="flash-outline"
          label={busy === "testing" ? "测试中" : "保存并测试"}
          onPress={() => {
            void handleTest();
          }}
          variant="secondary"
        />
        {canSetDefault ? (
          <ActionButton
            disabled={isBusy}
            icon="star-outline"
            label={busy === "settingDefault" ? "设置中" : "设为默认"}
            onPress={() => {
              void handleSetDefault();
            }}
            variant="secondary"
          />
        ) : null}
        {configuration ? (
          <ActionButton
            disabled={isBusy}
            icon="trash-outline"
            label={busy === "deleting" ? "删除中" : "删除配置"}
            onPress={handleDelete}
            variant="danger"
          />
        ) : null}
      </View>

      {isBusy ? <ActivityIndicator color="#0F766E" /> : null}
    </ScrollView>
  );
}

interface FieldProps {
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  editable: boolean;
  keyboardType?: "default" | "url";
  label: string;
  onChangeText(value: string): void;
  secureTextEntry?: boolean;
  value: string;
}

function Field({
  autoCapitalize = "sentences",
  editable,
  keyboardType = "default",
  label,
  onChangeText,
  secureTextEntry = false,
  value,
}: FieldProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        autoCapitalize={autoCapitalize}
        editable={editable}
        keyboardType={keyboardType}
        onChangeText={onChangeText}
        secureTextEntry={secureTextEntry}
        style={[styles.input, !editable && styles.readonlyInput]}
        value={value}
      />
    </View>
  );
}

interface ActionButtonProps {
  disabled?: boolean;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress(): void;
  variant?: "primary" | "secondary" | "danger";
}

function ActionButton({
  disabled = false,
  icon,
  label,
  onPress,
  variant = "primary",
}: ActionButtonProps) {
  const isSecondary = variant === "secondary";
  const isDanger = variant === "danger";
  const foreground = isDanger ? "#B91C1C" : isSecondary ? "#0F766E" : "#FFFFFF";
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        isSecondary && styles.secondaryActionButton,
        isDanger && styles.dangerActionButton,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <Ionicons color={foreground} name={icon} size={18} />
      <Text
        style={[
          styles.actionButtonText,
          (isSecondary || isDanger) && { color: foreground },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

interface TypeSegmentProps {
  disabled: boolean;
  isSelected: boolean;
  label: string;
  onPress(): void;
}

function TypeSegment({ disabled, isSelected, label, onPress }: TypeSegmentProps) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.typeSegment,
        isSelected && styles.selectedTypeSegment,
        disabled && !isSelected && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <Text style={[styles.typeSegmentText, isSelected && styles.selectedTypeSegmentText]}>
        {label}
      </Text>
    </Pressable>
  );
}

function defaultForm(type: ModelConfigurationType): EditorFormState {
  return {
    baseUrl: "https://api.openai.com/v1",
    modelName: type === "image" ? "gpt-image-2" : "",
    apiKey: "",
  };
}

function formFromConfiguration(configuration: ModelConfiguration): EditorFormState {
  return {
    baseUrl: configuration.baseUrl,
    modelName: configuration.modelName,
    apiKey: "",
  };
}

function credentialStatus(
  configuration: ModelConfiguration | null,
  apiKey: string,
  clearCredential: boolean,
): string {
  if (clearCredential) {
    return "保存后清除已保存凭据";
  }
  if (apiKey.trim().length > 0) {
    return "保存后替换凭据";
  }
  if (configuration?.hasCredential) {
    return "已保存凭据";
  }
  return "未保存凭据";
}

function toFailureSummary(error: unknown): ModelConnectionFailureSummary {
  return {
    reason: "unknown_error",
    message: error instanceof Error ? error.message : String(error),
    occurredAt: new Date().toISOString(),
  };
}

const styles = StyleSheet.create({
  actionButton: {
    alignItems: "center",
    backgroundColor: "#0F766E",
    borderRadius: 8,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 16,
  },
  actionButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },
  actions: {
    gap: 12,
  },
  clearCredentialButton: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    minHeight: 36,
    paddingHorizontal: 8,
  },
  clearCredentialText: {
    color: "#B91C1C",
    fontSize: 13,
    fontWeight: "700",
  },
  content: {
    gap: 18,
    padding: 20,
    paddingBottom: 32,
  },
  credentialRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
  },
  credentialText: {
    color: "#64748B",
    flex: 1,
    fontSize: 13,
  },
  dangerActionButton: {
    backgroundColor: "#FEE2E2",
  },
  defaultBadge: {
    backgroundColor: "#CCFBF1",
    borderRadius: 999,
    color: "#0F766E",
    fontSize: 12,
    fontWeight: "700",
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  disabled: {
    opacity: 0.5,
  },
  failureText: {
    color: "#B91C1C",
    fontSize: 14,
    lineHeight: 20,
  },
  field: {
    gap: 8,
  },
  fieldLabel: {
    color: "#334155",
    fontSize: 14,
    fontWeight: "600",
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
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
  input: {
    backgroundColor: "#FFFFFF",
    borderColor: "#CBD5E1",
    borderRadius: 8,
    borderWidth: 1,
    color: "#0F172A",
    fontSize: 16,
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  notReadyText: {
    color: "#B45309",
  },
  noticeText: {
    color: "#0F766E",
    fontSize: 14,
    lineHeight: 20,
  },
  pressed: {
    opacity: 0.78,
  },
  readonlyInput: {
    backgroundColor: "#F1F5F9",
    color: "#475569",
  },
  readyText: {
    color: "#0F766E",
  },
  screen: {
    backgroundColor: "#F8FAFC",
    flex: 1,
  },
  secondaryActionButton: {
    backgroundColor: "#E0F2F1",
  },
  section: {
    borderColor: "#E2E8F0",
    borderRadius: 8,
    borderWidth: 1,
    gap: 14,
    padding: 16,
  },
  selectedTypeSegment: {
    backgroundColor: "#0F766E",
    borderColor: "#0F766E",
  },
  selectedTypeSegmentText: {
    color: "#FFFFFF",
  },
  statusRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
  },
  statusText: {
    fontSize: 14,
    fontWeight: "800",
  },
  title: {
    color: "#0F172A",
    flex: 1,
    fontSize: 26,
    fontWeight: "800",
  },
  typeRow: {
    flexDirection: "row",
    gap: 10,
  },
  typeSegment: {
    alignItems: "center",
    borderColor: "#CBD5E1",
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    minHeight: 42,
    justifyContent: "center",
  },
  typeSegmentText: {
    color: "#334155",
    fontSize: 15,
    fontWeight: "700",
  },
});
