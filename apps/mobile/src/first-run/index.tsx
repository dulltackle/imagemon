import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";

import { useReadyAppRuntime } from "../app-state";
import { useModelCallLock } from "../model-calls";
import {
  type ModelConfigurationType,
  type ModelConnectionFailureSummary,
  testModelConnection,
} from "../model-configurations";

interface FirstRunModelFormState {
  baseUrl: string;
  modelName: string;
  apiKey: string;
}

const defaultImageForm: FirstRunModelFormState = {
  baseUrl: "https://api.openai.com/v1",
  modelName: "gpt-image-2",
  apiKey: "",
};

const defaultTextForm: FirstRunModelFormState = {
  baseUrl: "https://api.openai.com/v1",
  modelName: "",
  apiKey: "",
};

export function FirstRunSetupScreen() {
  const router = useRouter();
  const runtime = useReadyAppRuntime();
  const modelCallLock = useModelCallLock();
  const [imageForm, setImageForm] = useState(defaultImageForm);
  const [textForm, setTextForm] = useState(defaultTextForm);
  const [useSameConnection, setUseSameConnection] = useState(false);
  const [configurationIds, setConfigurationIds] = useState<Record<ModelConfigurationType, string | null>>({
    image: null,
    text: null,
  });
  const [lastSavedForms, setLastSavedForms] = useState<
    Record<ModelConfigurationType, FirstRunModelFormState | null>
  >({
    image: null,
    text: null,
  });
  const [lockedSections, setLockedSections] = useState<Record<ModelConfigurationType, boolean>>({
    image: false,
    text: false,
  });
  const [testingType, setTestingType] = useState<ModelConfigurationType | null>(null);
  const [failures, setFailures] = useState<Record<ModelConfigurationType, ModelConnectionFailureSummary | null>>({
    image: null,
    text: null,
  });

  function handleUseSameConnection(value: boolean) {
    setUseSameConnection(value);
    if (value) {
      setTextForm((current) => ({
        ...current,
        baseUrl: imageForm.baseUrl,
        apiKey: imageForm.apiKey,
      }));
    }
  }

  function handleFormChange(type: ModelConfigurationType, next: FirstRunModelFormState) {
    if (type === "image") {
      setImageForm(next);
    } else {
      setTextForm(next);
    }
    setFailures((current) => ({
      ...current,
      [type]: null,
    }));
  }

  function unlockSection(type: ModelConfigurationType) {
    setLockedSections((current) => ({
      ...current,
      [type]: false,
    }));
  }

  async function handleSaveAndTest(type: ModelConfigurationType) {
    const form = type === "image" ? imageForm : textForm;
    const lock = modelCallLock.beginModelCall("modelConfigurationTest");
    if (lock.status === "blocked") {
      setFailures((current) => ({
        ...current,
        [type]: {
          reason: "unknown_error",
          message: "已有模型调用正在进行。",
          occurredAt: new Date().toISOString(),
        },
      }));
      return;
    }

    setTestingType(type);
    setFailures((current) => ({
      ...current,
      [type]: null,
    }));

    try {
      const configuration = await runtime.repository.save({
        id: configurationIds[type] ?? undefined,
        type,
        baseUrl: form.baseUrl,
        modelName: form.modelName,
        apiKey: form.apiKey,
      });
      setConfigurationIds((current) => ({
        ...current,
        [type]: configuration.id,
      }));

      const result = await testModelConnection({
        baseUrl: configuration.baseUrl,
        apiKey: form.apiKey,
        modelName: configuration.modelName,
      });

      if (result.status === "failed") {
        setFailures((current) => ({
          ...current,
          [type]: result.failure,
        }));
        return;
      }

      await runtime.repository.markReady(configuration.id, result.testedAt);
      const settings = await runtime.repository.setDefault(type, configuration.id);
      runtime.replaceSettings(settings);
      setLastSavedForms((current) => ({
        ...current,
        [type]: form,
      }));
      setLockedSections((current) => ({
        ...current,
        [type]: true,
      }));
    } catch (error) {
      setFailures((current) => ({
        ...current,
        [type]: {
          reason: "unknown_error",
          message: error instanceof Error ? error.message : String(error),
          occurredAt: new Date().toISOString(),
        },
      }));
    } finally {
      setTestingType(null);
      modelCallLock.endModelCall(lock.call.id);
    }
  }

  async function completeSetup() {
    const settings = await runtime.repository.completeFirstRunSetup();
    runtime.replaceSettings(settings);
    router.replace("/");
  }

  function hasUnsavedUnlockedEdit(type: ModelConfigurationType) {
    const saved = lastSavedForms[type];
    const current = type === "image" ? imageForm : textForm;
    return saved !== null && !lockedSections[type] && !isSameForm(saved, current);
  }

  function handleComplete() {
    if (testingType) {
      return;
    }

    if (hasUnsavedUnlockedEdit("image") || hasUnsavedUnlockedEdit("text")) {
      Alert.alert("存在未保存修改", "请保存并测试，或放弃修改后完成。", [
        {
          text: "继续编辑",
          style: "cancel",
        },
        {
          text: "放弃修改并完成",
          style: "destructive",
          onPress: () => {
            void completeSetup();
          },
        },
      ]);
      return;
    }

    void completeSetup();
  }

  function handleSkip() {
    if (testingType) {
      return;
    }
    void completeSetup();
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={styles.screen}
    >
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <ModelSection
          disabled={testingType !== null}
          failure={failures.image}
          form={imageForm}
          isLocked={lockedSections.image}
          isTesting={testingType === "image"}
          onChange={(next) => handleFormChange("image", next)}
          onModify={() => unlockSection("image")}
          onSaveAndTest={() => {
            void handleSaveAndTest("image");
          }}
          title="图片模型"
          type="image"
        />

        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>文本模型使用相同连接信息</Text>
          <Switch
            onValueChange={handleUseSameConnection}
            thumbColor={useSameConnection ? "#0F766E" : "#F8FAFC"}
            trackColor={{ false: "#CBD5E1", true: "#99F6E4" }}
            value={useSameConnection}
          />
        </View>

        <ModelSection
          disabled={testingType !== null}
          failure={failures.text}
          form={textForm}
          isLocked={lockedSections.text}
          isTesting={testingType === "text"}
          onChange={(next) => handleFormChange("text", next)}
          onModify={() => unlockSection("text")}
          onSaveAndTest={() => {
            void handleSaveAndTest("text");
          }}
          title="文本模型"
          type="text"
        />

        <View style={styles.footer}>
          <ActionButton
            disabled={testingType !== null}
            icon="checkmark-circle-outline"
            label="完成"
            onPress={handleComplete}
          />
          <ActionButton
            disabled={testingType !== null}
            icon="play-skip-forward-outline"
            label="跳过"
            onPress={handleSkip}
            variant="secondary"
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

interface ModelSectionProps {
  disabled: boolean;
  failure: ModelConnectionFailureSummary | null;
  form: FirstRunModelFormState;
  isLocked: boolean;
  isTesting: boolean;
  onChange(next: FirstRunModelFormState): void;
  onModify(): void;
  onSaveAndTest(): void;
  title: string;
  type: ModelConfigurationType;
}

function ModelSection({
  disabled,
  failure,
  form,
  isLocked,
  isTesting,
  onChange,
  onModify,
  onSaveAndTest,
  title,
  type,
}: ModelSectionProps) {
  const testLabel = type === "image" ? "保存并测试图片模型" : "保存并测试文本模型";
  const editable = !disabled && !isLocked;

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {isLocked ? <Text style={styles.readyBadge}>已就绪</Text> : null}
      </View>
      <Field
        autoCapitalize="none"
        editable={editable}
        keyboardType="url"
        label="Base URL"
        onChangeText={(baseUrl) => onChange({ ...form, baseUrl })}
        value={form.baseUrl}
      />
      <Field
        autoCapitalize="none"
        editable={editable}
        label="模型名"
        onChangeText={(modelName) => onChange({ ...form, modelName })}
        value={form.modelName}
      />
      <Field
        autoCapitalize="none"
        editable={editable}
        label="API Key"
        onChangeText={(apiKey) => onChange({ ...form, apiKey })}
        secureTextEntry
        value={form.apiKey}
      />
      {failure ? <Text style={styles.failureText}>{failure.message}</Text> : null}
      <View style={styles.sectionActions}>
        {isLocked ? (
          <ActionButton
            disabled={disabled}
            icon="create-outline"
            label="修改"
            onPress={onModify}
            variant="secondary"
          />
        ) : (
          <ActionButton
            disabled={disabled}
            icon="flash-outline"
            label={isTesting ? "测试中" : testLabel}
            onPress={onSaveAndTest}
          />
        )}
      </View>
    </View>
  );
}

interface FieldProps {
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  editable?: boolean;
  keyboardType?: "default" | "url";
  label: string;
  onChangeText(value: string): void;
  secureTextEntry?: boolean;
  value: string;
}

function Field({
  autoCapitalize = "sentences",
  editable = true,
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

function isSameForm(left: FirstRunModelFormState, right: FirstRunModelFormState): boolean {
  return (
    left.baseUrl === right.baseUrl &&
    left.modelName === right.modelName &&
    left.apiKey === right.apiKey
  );
}

interface ActionButtonProps {
  disabled?: boolean;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress(): void;
  variant?: "primary" | "secondary";
}

function ActionButton({
  disabled = false,
  icon,
  label,
  onPress,
  variant = "primary",
}: ActionButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        variant === "secondary" && styles.secondaryButton,
        disabled && styles.disabledButton,
        pressed && !disabled && styles.pressedButton,
      ]}
    >
      <Ionicons
        color={variant === "secondary" ? "#0F766E" : "#FFFFFF"}
        name={icon}
        size={18}
      />
      <Text style={[styles.buttonLabel, variant === "secondary" && styles.secondaryButtonLabel]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    backgroundColor: "#0F766E",
    borderRadius: 8,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 16,
  },
  buttonLabel: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },
  content: {
    gap: 20,
    padding: 20,
    paddingBottom: 32,
  },
  disabledButton: {
    opacity: 0.5,
  },
  field: {
    gap: 8,
  },
  fieldLabel: {
    color: "#334155",
    fontSize: 14,
    fontWeight: "600",
  },
  footer: {
    gap: 12,
  },
  failureText: {
    color: "#B91C1C",
    fontSize: 14,
    lineHeight: 20,
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
  pressedButton: {
    opacity: 0.86,
  },
  readonlyInput: {
    backgroundColor: "#F1F5F9",
    color: "#475569",
  },
  readyBadge: {
    backgroundColor: "#CCFBF1",
    borderRadius: 999,
    color: "#0F766E",
    fontSize: 12,
    fontWeight: "700",
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  screen: {
    backgroundColor: "#F8FAFC",
    flex: 1,
  },
  secondaryButton: {
    backgroundColor: "#E0F2F1",
  },
  secondaryButtonLabel: {
    color: "#0F766E",
  },
  section: {
    borderColor: "#E2E8F0",
    borderRadius: 8,
    borderWidth: 1,
    gap: 14,
    padding: 16,
  },
  sectionActions: {
    marginTop: 2,
  },
  sectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  sectionTitle: {
    color: "#0F172A",
    fontSize: 18,
    fontWeight: "700",
  },
  switchLabel: {
    color: "#0F172A",
    flex: 1,
    fontSize: 15,
    fontWeight: "600",
  },
  switchRow: {
    alignItems: "center",
    borderColor: "#E2E8F0",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    minHeight: 52,
    paddingHorizontal: 16,
  },
});
