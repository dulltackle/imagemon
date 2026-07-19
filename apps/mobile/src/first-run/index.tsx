import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert } from "react-native";
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
  cn,
  KeyboardAvoidingView,
  SymbolIcon,
  Text,
  TextInput,
  useCSSVariable,
  View,
} from "../tw";
import { AppButton } from "../ui/AppButton";
import { Badge } from "../ui/Badge";
import { ScreenScrollView } from "../ui/ScreenCanvas";
import { SectionTitle } from "../ui/SectionTitle";
import { Surface } from "../ui/Surface";

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
  const actionColor = useCSSVariable("--app-action");
  const [imageForm, setImageForm] = useState(defaultImageForm);
  const [textForm, setTextForm] = useState(defaultTextForm);
  const [isCopyingImageConnection, setIsCopyingImageConnection] =
    useState(false);
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

  async function handleCopyImageConnection() {
    if (effectiveTestingType || isCopyingImageConnection) {
      return;
    }

    setIsCopyingImageConnection(true);
    const sourceBaseUrl = imageForm.baseUrl;
    const sourceApiKey = imageForm.apiKey;
    const sourceConfigurationId = configurationIds.image;
    try {
      const persistedApiKey =
        sourceApiKey.trim().length > 0
          ? sourceApiKey
          : sourceConfigurationId
            ? await repository.getCredential(sourceConfigurationId)
            : null;
      setTextForm((current) => ({
        ...current,
        baseUrl: sourceBaseUrl,
        ...(persistedApiKey ? { apiKey: persistedApiKey } : null),
      }));
      setLockedSections((current) => ({ ...current, text: false }));
      setFailures((current) => ({ ...current, text: null }));
    } catch {
      setFailures((current) => ({
        ...current,
        text: {
          reason: "unknown_error",
          message: "读取图片模型凭据失败，请稍后重试。",
          occurredAt: new Date().toISOString(),
        },
      }));
    } finally {
      setIsCopyingImageConnection(false);
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
      className="flex-1 bg-app-surface-raised"
    >
      <ScreenScrollView keyboardBehavior="form" variant="tool">
        <Surface variant="brand">
          <View className="flex-row items-start gap-3">
            <SymbolIcon
              className="mt-0.5 h-5 w-5"
              name="information"
              tintColor={actionColor}
            />
            <Text
              className="flex-1 text-sm leading-5 text-app-ink"
              selectable
            >
              Imagemon 通过你提供的模型配置执行图片任务和模板提炼；API Key
              只保存在当前设备的安全存储中。你可以先跳过，之后随时在「设置 →
              模型配置」中完成配置。
            </Text>
          </View>
        </Surface>

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

        <View className="self-start">
          <AppButton
            disabled={effectiveTestingType !== null}
            icon="copy"
            label={
              isCopyingImageConnection
                ? "正在复制连接信息"
                : "复制图片模型连接信息"
            }
            loading={isCopyingImageConnection}
            onPress={() => {
              void handleCopyImageConnection();
            }}
            variant="secondary"
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
      </ScreenScrollView>

      <View
        className="border-t border-app-stroke bg-app-surface pt-3"
        style={{ paddingBottom: Math.max(insets.bottom, 12) }}
      >
        <View className="w-full max-w-[720px] self-center gap-3 px-5">
          <AppButton
            disabled={effectiveTestingType !== null}
            icon="success"
            label="完成设置"
            onPress={handleComplete}
          />
          <AppButton
            disabled={effectiveTestingType !== null}
            icon="skip"
            label="暂时跳过"
            onPress={handleSkip}
            variant="secondary"
          />
        </View>
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
    <View className="gap-3.5">
      <Surface variant="fieldGroup">
        <View className="flex-row items-center justify-between gap-3">
          <View className="min-w-0 flex-1">
            <SectionTitle>{title}</SectionTitle>
          </View>
          {isLocked ? <Badge variant="success">已就绪</Badge> : null}
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
      </Surface>
      {failure ? (
        <Surface tone="danger" variant="feedback">
          <Text className="text-sm leading-5 text-app-danger">
            {failure.message}
          </Text>
        </Surface>
      ) : null}
      <View>
        {isLocked ? (
          <AppButton
            disabled={disabled}
            icon="edit"
            label="修改"
            onPress={onModify}
            variant="secondary"
          />
        ) : (
          <AppButton
            disabled={disabled}
            icon="connection-test"
            label={isTesting ? "测试中" : testLabel}
            loading={isTesting}
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
      <Text className="text-sm font-semibold leading-5 text-app-ink">
        {label}
      </Text>
      <TextInput
        autoCapitalize={autoCapitalize}
        editable={editable}
        keyboardType={keyboardType}
        onChangeText={onChangeText}
        secureTextEntry={secureTextEntry}
        className={cn(
          "min-h-11 rounded-[14px] border border-app-stroke bg-app-field px-3 py-2.5 text-base leading-6 text-app-ink",
          !editable && "bg-app-action-soft text-app-ink-muted",
        )}
        style={{ borderCurve: "continuous" }}
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
