import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Switch } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useReadyAppRuntime } from "../app-state";
import {
  type ActiveModelCall,
  getFirstRunModelCallOwnerKey,
  useModelCallLock,
} from "../model-calls";
import {
  type ModelConfiguration,
  type ModelConfigurationType,
  type ModelConnectionFailureSummary,
  testModelConnection,
} from "../model-configurations";
import {
  type AppIconName,
  cn,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
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

interface FirstRunConfigurationOverride {
  id: string;
  type: ModelConfigurationType;
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
  const { refreshSettings, repository } = runtime;
  const modelCallLock = useModelCallLock();
  const insets = useSafeAreaInsets();
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
  const previousOwnedTestCallRef = useRef<ActiveModelCall | null>(null);
  const restoreSetupRequestIdRef = useRef(0);
  const ownedTestCall =
    modelCallLock.activeCall?.type === "modelConfigurationTest" &&
    (modelCallLock.activeCall.ownerKey ===
      getFirstRunModelCallOwnerKey("image") ||
      modelCallLock.activeCall.ownerKey ===
        getFirstRunModelCallOwnerKey("text"))
      ? modelCallLock.activeCall
      : null;
  const activeTestingType: ModelConfigurationType | null =
    ownedTestCall?.ownerKey === getFirstRunModelCallOwnerKey("image")
      ? "image"
      : ownedTestCall?.ownerKey === getFirstRunModelCallOwnerKey("text")
        ? "text"
        : null;
  const effectiveTestingType = testingType ?? activeTestingType;

  const restorePersistedSetup = useCallback(
    async (override?: FirstRunConfigurationOverride) => {
      const requestId = ++restoreSetupRequestIdRef.current;
      try {
        const settings = await refreshSettings();
        const configurationIdsToLoad: Record<
          ModelConfigurationType,
          string | null
        > = {
          image: settings.defaultImageModelConfigurationId,
          text: settings.defaultTextModelConfigurationId,
        };
        if (override) {
          configurationIdsToLoad[override.type] = override.id;
        }

        const [imageConfiguration, textConfiguration] = await Promise.all([
          configurationIdsToLoad.image
            ? repository.get(configurationIdsToLoad.image)
            : Promise.resolve(null),
          configurationIdsToLoad.text
            ? repository.get(configurationIdsToLoad.text)
            : Promise.resolve(null),
        ]);
        if (requestId !== restoreSetupRequestIdRef.current) {
          return;
        }

        const imagePersistedForm = imageConfiguration
          ? formFromConfiguration(imageConfiguration)
          : null;
        const textPersistedForm = textConfiguration
          ? formFromConfiguration(textConfiguration)
          : null;
        setConfigurationIds((current) => ({
          image: imageConfiguration?.id ?? current.image,
          text: textConfiguration?.id ?? current.text,
        }));
        if (imagePersistedForm) {
          setImageForm(imagePersistedForm);
        }
        if (textPersistedForm) {
          setTextForm(textPersistedForm);
        }
        setLastSavedForms((current) => ({
          image: imagePersistedForm ?? current.image,
          text: textPersistedForm ?? current.text,
        }));
        setLockedSections((current) => ({
          image: imageConfiguration?.isReady ?? current.image,
          text: textConfiguration?.isReady ?? current.text,
        }));
      } catch (error) {
        if (requestId !== restoreSetupRequestIdRef.current) {
          return;
        }
        const failedType = override?.type ?? "image";
        setFailures((current) => ({
          ...current,
          [failedType]: {
            reason: "unknown_error",
            message: error instanceof Error ? error.message : String(error),
            occurredAt: new Date().toISOString(),
          },
        }));
      }
    },
    [refreshSettings, repository],
  );

  useEffect(() => {
    void restorePersistedSetup();
    return () => {
      restoreSetupRequestIdRef.current += 1;
    };
  }, [restorePersistedSetup]);

  useEffect(() => {
    if (ownedTestCall) {
      restoreSetupRequestIdRef.current += 1;
      previousOwnedTestCallRef.current = ownedTestCall;
      return;
    }

    const completedCall = previousOwnedTestCallRef.current;
    if (!completedCall) {
      return;
    }
    previousOwnedTestCallRef.current = null;

    const completedType: ModelConfigurationType =
      completedCall.ownerKey === getFirstRunModelCallOwnerKey("text")
        ? "text"
        : "image";
    const configurationId = completedCall.context?.modelConfigurationId;
    void restorePersistedSetup(
      configurationId
        ? { id: configurationId, type: completedType }
        : undefined,
    );
  }, [ownedTestCall, restorePersistedSetup]);

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
    if (effectiveTestingType) {
      return;
    }
    const form = type === "image" ? imageForm : textForm;
    const lock = modelCallLock.beginModelCall({
      type: "modelConfigurationTest",
      returnHref: "/first-run",
      ownerKey: getFirstRunModelCallOwnerKey(type),
      context: configurationIds[type]
        ? { modelConfigurationId: configurationIds[type] }
        : undefined,
    });
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
      modelCallLock.updateModelCall(lock.call.id, {
        context: { modelConfigurationId: configuration.id },
      });

      const credential =
        form.apiKey.trim().length > 0
          ? form.apiKey
          : await repository.getCredential(configuration.id);
      const result = await testModelConnection({
        baseUrl: configuration.baseUrl,
        apiKey: credential,
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
    if (effectiveTestingType) {
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
    if (effectiveTestingType) {
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
        className="flex-1"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerClassName="gap-5 p-5 pb-6"
        keyboardShouldPersistTaps="handled"
      >
        <View className="flex-row items-start gap-3 rounded-lg border border-sf-separator bg-sf-bg-3 p-4">
          <SymbolIcon
            className="mt-0.5 h-5 w-5"
            name="information"
            tintColor={accentColor}
          />
          <Text className="flex-1 text-sm leading-5 text-sf-text" selectable>
            Imagemon
            通过你提供的模型配置执行图片任务和模板提炼；API Key
            只保存在当前设备的安全存储中。你可以先跳过，之后随时在「设置 →
            模型配置」中完成配置。
          </Text>
        </View>

        <ModelSection
          disabled={effectiveTestingType !== null}
          failure={failures.image}
          form={imageForm}
          isLocked={lockedSections.image}
          isTesting={effectiveTestingType === "image"}
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
            disabled={effectiveTestingType !== null}
            onValueChange={handleUseSameConnection}
            thumbColor={useSameConnection ? accentColor : surfaceColor}
            trackColor={{ false: fillColor, true: accentColor }}
            value={useSameConnection}
          />
        </View>

        <ModelSection
          disabled={effectiveTestingType !== null}
          failure={failures.text}
          form={textForm}
          isLocked={lockedSections.text}
          isTesting={effectiveTestingType === "text"}
          onChange={(next) => handleFormChange("text", next)}
          onModify={() => unlockSection("text")}
          onSaveAndTest={() => {
            void handleSaveAndTest("text");
          }}
          title="文本模型"
          type="text"
        />

      </ScrollView>

      <View
        className="gap-3 border-t border-sf-separator bg-sf-bg-3 px-5 pt-3"
        style={{ paddingBottom: Math.max(insets.bottom, 12) }}
      >
        <ActionButton
          disabled={effectiveTestingType !== null}
          icon="success"
          label="完成设置"
          onPress={handleComplete}
        />
        <ActionButton
          disabled={effectiveTestingType !== null}
          icon="skip"
          label="暂时跳过"
          onPress={handleSkip}
          variant="secondary"
        />
      </View>
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
            icon="edit"
            label="修改"
            onPress={onModify}
            variant="secondary"
          />
        ) : (
          <ActionButton
            disabled={disabled}
            icon="connection-test"
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

function formFromConfiguration(
  configuration: ModelConfiguration,
): FirstRunModelFormState {
  return {
    baseUrl: configuration.baseUrl,
    modelName: configuration.modelName,
    apiKey: "",
  };
}

interface ActionButtonProps {
  disabled?: boolean;
  icon: AppIconName;
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
