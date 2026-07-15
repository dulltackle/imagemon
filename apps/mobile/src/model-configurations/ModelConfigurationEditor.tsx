import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert } from "react-native";

import { useReadyAppRuntime } from "../app-state";
import {
  type ActiveModelCall,
  getModelConfigurationModelCallOwnerKey,
  getNewModelConfigurationModelCallOwnerKey,
  useModelCallLock,
} from "../model-calls";
import { cn, Pressable, Text, TextInput, useCSSVariable, View } from "../tw";
import { AppButton } from "../ui/AppButton";
import { Badge } from "../ui/Badge";
import { ScreenScrollView } from "../ui/ScreenCanvas";
import { Surface } from "../ui/Surface";
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
  const { refreshSettings, repository } = runtime;
  const modelCallLock = useModelCallLock();
  const actionColor = useCSSVariable("--app-action");
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
  const initiatedTestCallIdRef = useRef<string | null>(null);
  const claimedTestCallIdRef = useRef<string | null>(null);
  const previousOwnedTestCallRef = useRef<ActiveModelCall | null>(null);
  const isFocusedRef = useRef(false);

  const ownerKey = configuration
    ? getModelConfigurationModelCallOwnerKey(configuration.id)
    : getNewModelConfigurationModelCallOwnerKey(type);
  const directlyOwnedTestCall =
    modelCallLock.activeCall?.type === "modelConfigurationTest" &&
    (modelCallLock.activeCall.ownerKey === ownerKey ||
      modelCallLock.activeCall.id === initiatedTestCallIdRef.current)
      ? modelCallLock.activeCall
      : null;
  if (directlyOwnedTestCall) {
    claimedTestCallIdRef.current = directlyOwnedTestCall.id;
  }
  const ownedTestCall =
    modelCallLock.activeCall?.type === "modelConfigurationTest" &&
    modelCallLock.activeCall.id === claimedTestCallIdRef.current
      ? modelCallLock.activeCall
      : null;
  const isTesting = ownedTestCall !== null || busy === "testing";
  const isBusy = busy !== null || ownedTestCall !== null;
  const isCurrentDefault =
    configuration?.type === "image"
      ? runtime.settings.defaultImageModelConfigurationId === configuration.id
      : configuration?.type === "text"
        ? runtime.settings.defaultTextModelConfigurationId === configuration.id
        : false;
  const canSetDefault = configuration?.isReady === true && !isCurrentDefault;

  useFocusEffect(
    useCallback(() => {
      isFocusedRef.current = true;
      return () => {
        isFocusedRef.current = false;
      };
    }, []),
  );

  useEffect(() => {
    if (ownedTestCall) {
      previousOwnedTestCallRef.current = ownedTestCall;
      return;
    }

    const completedCall = previousOwnedTestCallRef.current;
    if (!completedCall) {
      return;
    }
    previousOwnedTestCallRef.current = null;
    claimedTestCallIdRef.current = null;
    const configurationId = completedCall.context?.modelConfigurationId;

    let cancelled = false;

    async function reloadPersistedConfiguration() {
      try {
        const [nextConfiguration] = await Promise.all([
          configurationId
            ? repository.get(configurationId)
            : Promise.resolve(null),
          refreshSettings(),
        ]);
        if (cancelled || !nextConfiguration) {
          return;
        }
        setConfiguration(nextConfiguration);
        setType(nextConfiguration.type);
        setForm(formFromConfiguration(nextConfiguration));
        setClearCredential(false);
      } catch (error) {
        if (!cancelled) {
          setFailure(toFailureSummary(error));
        }
      }
    }

    void reloadPersistedConfiguration();

    return () => {
      cancelled = true;
    };
  }, [ownedTestCall, refreshSettings, repository]);

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

    const lock = modelCallLock.beginModelCall({
      type: "modelConfigurationTest",
      returnHref: configuration
        ? `/model-configurations/${encodeURIComponent(configuration.id)}`
        : `/model-configurations/new?type=${type}`,
      ownerKey,
      context: configuration
        ? { modelConfigurationId: configuration.id }
        : undefined,
    });
    if (lock.status === "blocked") {
      setFailure({
        reason: "unknown_error",
        message: "已有模型调用正在进行。",
        occurredAt: new Date().toISOString(),
      });
      return;
    }

    initiatedTestCallIdRef.current = lock.call.id;
    setBusy("testing");
    setFailure(null);
    setNotice(null);
    try {
      const wasNew = configuration === null;
      const saved = await saveCurrent();
      modelCallLock.updateModelCall(lock.call.id, {
        returnHref: `/model-configurations/${encodeURIComponent(saved.id)}`,
        ownerKey: getModelConfigurationModelCallOwnerKey(saved.id),
        context: { modelConfigurationId: saved.id },
      });
      if (wasNew && isFocusedRef.current) {
        router.replace({
          pathname: "/model-configurations/[id]",
          params: { id: saved.id },
        });
      }
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
        return;
      }

      const ready = await runtime.repository.markReady(
        saved.id,
        result.testedAt,
      );
      setConfiguration(ready);
      setNotice("测试通过，配置已就绪。");
    } catch (error) {
      setFailure(toFailureSummary(error));
    } finally {
      setBusy(null);
      modelCallLock.endModelCall(lock.call.id);
      initiatedTestCallIdRef.current = null;
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
    <ScreenScrollView keyboardBehavior="form" variant="tool">
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

      <Surface variant="fieldGroup">
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
          <Text
            className="flex-1 text-[13px] leading-[18px] text-app-ink-muted"
            selectable
          >
            {credentialStatus(configuration, form.apiKey, clearCredential)}
          </Text>
          <AppButton
            disabled={!configuration?.hasCredential || isBusy}
            icon="delete"
            label="清除凭据"
            onPress={() => {
              setClearCredential(true);
              setFailure(null);
              setNotice(null);
            }}
            variant="danger"
          />
        </View>
      </Surface>

      {configuration ? (
        <View className="flex-row items-center gap-2.5">
          <Badge variant={configuration.isReady ? "success" : "warning"}>
            {configuration.isReady ? "就绪" : "未就绪"}
          </Badge>
          {isCurrentDefault ? <CurrentDefaultBadge /> : null}
        </View>
      ) : null}

      {failure ? (
        <Surface tone="danger" variant="feedback">
          <Text className="text-sm leading-5 text-app-danger" selectable>
            {failure.message}
          </Text>
        </Surface>
      ) : null}
      {notice ? (
        <Surface tone="success" variant="feedback">
          <Text className="text-sm leading-5 text-app-success" selectable>
            {notice}
          </Text>
        </Surface>
      ) : null}

      <View className="gap-3">
        <AppButton
          disabled={isBusy}
          icon="connection-test"
          label={isTesting ? "测试中" : "保存并测试"}
          onPress={() => {
            void handleTest();
          }}
        />
        <AppButton
          disabled={isBusy}
          icon="save"
          label={busy === "saving" ? "保存中" : "保存"}
          onPress={() => {
            void handleSave();
          }}
          variant="secondary"
        />
        {canSetDefault ? (
          <AppButton
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
          <AppButton
            disabled={isBusy}
            icon="delete"
            label={busy === "deleting" ? "删除中" : "删除配置"}
            onPress={handleDelete}
            variant="danger"
          />
        ) : null}
      </View>

      {isBusy ? <ActivityIndicator color={actionColor} /> : null}
    </ScreenScrollView>
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
      <Text className="text-sm font-semibold leading-5 text-app-ink" selectable>
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
      accessibilityState={{ disabled, selected: isSelected }}
      disabled={disabled}
      onPress={onPress}
      className={cn(
        "min-h-11 flex-1 items-center justify-center rounded-[14px] border border-app-stroke bg-app-field active:bg-app-action-soft",
        isSelected &&
          "border-app-action bg-app-action active:border-app-action-pressed active:bg-app-action-pressed",
        disabled && !isSelected && "bg-app-action-soft",
      )}
      style={{ borderCurve: "continuous" }}
    >
      <Text
        className={cn(
          "text-[15px] font-bold leading-[21px]",
          isSelected
            ? "text-app-on-action"
            : disabled
              ? "text-app-ink-muted"
              : "text-app-ink",
        )}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function CurrentDefaultBadge() {
  return <Badge variant="brand">当前默认</Badge>;
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
