import { useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Alert } from "react-native";

import { useReadyAppRuntime } from "../app-state";
import { useModelCallLock } from "../model-calls";
import {
  type AppIconName,
  cn,
  Pressable,
  ScrollView,
  SymbolIcon,
  Text,
  TextInput,
  useCSSVariable,
  View,
} from "../tw";
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
  const accentColor = useCSSVariable("--sf-blue");
  const dangerColor = useCSSVariable("--sf-red");
  const [configuration, setConfiguration] = useState<ModelConfiguration | null>(
    initialConfiguration,
  );
  const [type, setType] = useState<ModelConfigurationType>(
    initialConfiguration?.type ?? initialType,
  );
  const [form, setForm] = useState<EditorFormState>(
    initialConfiguration
      ? formFromConfiguration(initialConfiguration)
      : defaultForm(initialType),
  );
  const [clearCredential, setClearCredential] = useState(false);
  const [failure, setFailure] = useState<ModelConnectionFailureSummary | null>(
    null,
  );
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
      setNotice("已保存。");
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
        modelName: saved.modelName,
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

      const ready = await runtime.repository.markReady(
        saved.id,
        result.testedAt,
      );
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
      const settings = await runtime.repository.setDefault(
        configuration.type,
        configuration.id,
      );
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
    <ScrollView
      className="flex-1 bg-sf-bg-2"
      contentInsetAdjustmentBehavior="automatic"
      contentContainerClassName="gap-[18px] p-5 pb-8"
    >
      <View className="flex-row gap-2.5">
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

      <View className="gap-3.5 rounded-lg border border-sf-separator bg-sf-bg-3 p-4">
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
        <View className="flex-row items-center justify-between gap-3">
          <Text className="flex-1 text-[13px] text-sf-text-2" selectable>
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
            className={cn(
              "min-h-9 flex-row items-center gap-1.5 px-2 active:opacity-75",
              (!configuration?.hasCredential || isBusy) && "opacity-50",
            )}
          >
            <SymbolIcon
              className="h-4 w-4"
              name="delete"
              tintColor={dangerColor}
            />
            <Text className="text-[13px] font-bold leading-[18px] text-sf-red">
              清除凭据
            </Text>
          </Pressable>
        </View>
      </View>

      {configuration ? (
        <View className="flex-row items-center gap-2.5">
          <Text
            className={cn(
              "text-sm font-extrabold leading-5",
              configuration.isReady ? "text-sf-green" : "text-sf-orange",
            )}
            selectable
          >
            {configuration.isReady ? "就绪" : "未就绪"}
          </Text>
          {isCurrentDefault ? (
            <CurrentDefaultBadge />
          ) : null}
        </View>
      ) : null}

      {failure ? (
        <Text className="text-sm leading-5 text-sf-red" selectable>
          {failure.message}
        </Text>
      ) : null}
      {notice ? (
        <Text className="text-sm leading-5 text-sf-green" selectable>
          {notice}
        </Text>
      ) : null}

      <View className="gap-3">
        <ActionButton
          disabled={isBusy}
          icon="connection-test"
          label={busy === "testing" ? "测试中" : "保存并测试"}
          onPress={() => {
            void handleTest();
          }}
        />
        <ActionButton
          disabled={isBusy}
          icon="save"
          label={busy === "saving" ? "保存中" : "保存"}
          onPress={() => {
            void handleSave();
          }}
          variant="secondary"
        />
        {canSetDefault ? (
          <ActionButton
            disabled={isBusy}
            icon="favorite"
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
            icon="delete"
            label={busy === "deleting" ? "删除中" : "删除配置"}
            onPress={handleDelete}
            variant="danger"
          />
        ) : null}
      </View>

      {isBusy ? <ActivityIndicator color={accentColor} /> : null}
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

interface ActionButtonProps {
  disabled?: boolean;
  icon: AppIconName;
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
  const dangerColor = useCSSVariable("--sf-red");
  const secondaryColor = useCSSVariable("--sf-blue");
  let foreground = "#FFFFFF";
  if (isDanger) {
    foreground = dangerColor;
  } else if (isSecondary) {
    foreground = secondaryColor;
  }

  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      className={cn(
        "min-h-11 flex-row items-center justify-center gap-2 rounded-lg px-4 active:opacity-75",
        isSecondary && "bg-sf-fill",
        isDanger && "bg-sf-fill",
        !isSecondary && !isDanger && "bg-sf-blue",
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
          isDanger && "text-sf-red",
          isSecondary && "text-sf-blue",
          !isDanger && !isSecondary && "text-white",
        )}
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

function TypeSegment({
  disabled,
  isSelected,
  label,
  onPress,
}: TypeSegmentProps) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      className={cn(
        "min-h-[42px] flex-1 items-center justify-center rounded-lg border border-sf-separator active:opacity-75",
        isSelected && "border-sf-blue bg-sf-blue",
        disabled && !isSelected && "opacity-50",
      )}
    >
      <Text
        className={cn(
          "text-[15px] font-bold leading-[21px]",
          isSelected ? "text-white" : "text-sf-text",
        )}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function CurrentDefaultBadge() {
  return (
    <View className="min-h-[22px] shrink-0 items-center justify-center rounded-full bg-sf-fill px-2">
      <Text className="text-xs font-bold leading-4 text-sf-blue" selectable>
        当前默认
      </Text>
    </View>
  );
}

function defaultForm(type: ModelConfigurationType): EditorFormState {
  return {
    baseUrl: "https://api.openai.com/v1",
    modelName: type === "image" ? "gpt-image-2" : "",
    apiKey: "",
  };
}

function formFromConfiguration(
  configuration: ModelConfiguration,
): EditorFormState {
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
