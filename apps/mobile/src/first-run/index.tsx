import { useRouter } from "expo-router";
import { useState } from "react";
import { Alert, Switch } from "react-native";

import { useReadyAppRuntime } from "../app-state";
import { useModelCallLock } from "../model-calls";
import {
  type ModelConfigurationType,
  type ModelConnectionFailureSummary,
  testModelConnection,
} from "../model-configurations";
import {
  cn,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  type SFSymbolName,
  SymbolIcon,
  Text,
  TextInput,
  useCSSVariable,
  View,
} from "../tw";

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
  const accentColor = useCSSVariable("--sf-blue");
  const fillColor = useCSSVariable("--sf-fill");
  const surfaceColor = useCSSVariable("--sf-bg");
  const [imageForm, setImageForm] = useState(defaultImageForm);
  const [textForm, setTextForm] = useState(defaultTextForm);
  const [useSameConnection, setUseSameConnection] = useState(false);
  const [configurationIds, setConfigurationIds] = useState<
    Record<ModelConfigurationType, string | null>
  >({
    image: null,
    text: null,
  });
  const [lastSavedForms, setLastSavedForms] = useState<
    Record<ModelConfigurationType, FirstRunModelFormState | null>
  >({
    image: null,
    text: null,
  });
  const [lockedSections, setLockedSections] = useState<
    Record<ModelConfigurationType, boolean>
  >({
    image: false,
    text: false,
  });
  const [testingType, setTestingType] = useState<ModelConfigurationType | null>(
    null,
  );
  const [failures, setFailures] = useState<
    Record<ModelConfigurationType, ModelConnectionFailureSummary | null>
  >({
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

  function handleFormChange(
    type: ModelConfigurationType,
    next: FirstRunModelFormState,
  ) {
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
      const settings = await runtime.repository.setDefault(
        type,
        configuration.id,
      );
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
    return (
      saved !== null && !lockedSections[type] && !isSameForm(saved, current)
    );
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
      behavior={process.env.EXPO_OS === "ios" ? "padding" : undefined}
      className="flex-1 bg-sf-bg-2"
    >
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerClassName="gap-5 p-5 pb-8"
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

        <View className="min-h-[52px] flex-row items-center gap-3 rounded-lg border border-sf-separator bg-sf-bg-3 px-4">
          <Text
            className="flex-1 text-[15px] font-semibold leading-[21px] text-sf-text"
            selectable
          >
            文本模型使用相同连接信息
          </Text>
          <Switch
            onValueChange={handleUseSameConnection}
            thumbColor={useSameConnection ? accentColor : surfaceColor}
            trackColor={{ false: fillColor, true: accentColor }}
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

        <View className="gap-3">
          <ActionButton
            disabled={testingType !== null}
            icon="checkmark.circle"
            label="完成"
            onPress={handleComplete}
          />
          <ActionButton
            disabled={testingType !== null}
            icon="forward.end"
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
  const testLabel =
    type === "image" ? "保存并测试图片模型" : "保存并测试文本模型";
  const editable = !disabled && !isLocked;

  return (
    <View className="gap-3.5 rounded-lg border border-sf-separator bg-sf-bg-3 p-4">
      <View className="flex-row items-center justify-between">
        <Text className="text-lg font-bold leading-6 text-sf-text" selectable>
          {title}
        </Text>
        {isLocked ? <ReadyBadge /> : null}
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
      {failure ? (
        <Text className="text-sm leading-5 text-sf-red" selectable>
          {failure.message}
        </Text>
      ) : null}
      <View className="mt-0.5">
        {isLocked ? (
          <ActionButton
            disabled={disabled}
            icon="pencil"
            label="修改"
            onPress={onModify}
            variant="secondary"
          />
        ) : (
          <ActionButton
            disabled={disabled}
            icon="bolt"
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
    <View className="gap-2">
      <Text className="text-sm font-semibold leading-5 text-sf-text" selectable>
        {label}
      </Text>
      <TextInput
        autoCapitalize={autoCapitalize}
        editable={editable}
        keyboardType={keyboardType}
        onChangeText={onChangeText}
        secureTextEntry={secureTextEntry}
        className={cn(
          "min-h-11 rounded-lg border border-sf-separator bg-sf-bg px-3 py-2.5 text-base leading-6 text-sf-text",
          !editable && "bg-sf-fill text-sf-text-2",
        )}
        value={value}
      />
    </View>
  );
}

function isSameForm(
  left: FirstRunModelFormState,
  right: FirstRunModelFormState,
): boolean {
  return (
    left.baseUrl === right.baseUrl &&
    left.modelName === right.modelName &&
    left.apiKey === right.apiKey
  );
}

interface ActionButtonProps {
  disabled?: boolean;
  icon: SFSymbolName;
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
  const accentColor = useCSSVariable("--sf-blue");
  const foreground = variant === "secondary" ? accentColor : "#FFFFFF";

  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      className={cn(
        "min-h-11 flex-row items-center justify-center gap-2 rounded-lg px-4 active:opacity-85",
        variant === "secondary" ? "bg-sf-fill" : "bg-sf-blue",
        disabled && "opacity-50",
      )}
    >
      <SymbolIcon
        className="h-[18px] w-[18px]"
        name={icon}
        tintColor={foreground}
      />
      <Text
        className={cn(
          "text-[15px] font-bold leading-[21px]",
          variant === "secondary" ? "text-sf-blue" : "text-white",
        )}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function ReadyBadge() {
  return (
    <View className="min-h-[22px] shrink-0 items-center justify-center rounded-full bg-sf-fill px-2">
      <Text className="text-xs font-bold leading-4 text-sf-blue" selectable>
        已就绪
      </Text>
    </View>
  );
}
