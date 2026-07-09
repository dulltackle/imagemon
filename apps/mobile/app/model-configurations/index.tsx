import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator } from "react-native";

import { useReadyAppRuntime } from "../../src/app-state";
import type {
  ModelConfiguration,
  ModelConfigurationType,
} from "../../src/model-configurations";
import {
  cn,
  Pressable,
  ScrollView,
  type SFSymbolName,
  SymbolIcon,
  Text,
  useCSSVariable,
  View,
} from "../../src/tw";

export default function ModelConfigurationsScreen() {
  const router = useRouter();
  const runtime = useReadyAppRuntime();
  const { refreshSettings, repository, settings } = runtime;
  const accentColor = useCSSVariable("--sf-blue");
  const [configurations, setConfigurations] = useState<ModelConfiguration[]>(
    [],
  );
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      const nextConfigurations = await repository.list();
      if (!cancelled) {
        setConfigurations(nextConfigurations);
        await refreshSettings();
        setIsLoading(false);
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [refreshSettings, repository]);

  return (
    <ScrollView
      className="flex-1 bg-sf-bg-2"
      contentInsetAdjustmentBehavior="automatic"
      contentContainerClassName="gap-5 p-5 pb-8"
    >
      <View className="flex-row gap-3">
        <ActionButton
          icon="photo"
          label="新建图片模型"
          onPress={() =>
            router.push({
              pathname: "/model-configurations/new",
              params: { type: "image" },
            })
          }
        />
        <ActionButton
          icon="text.bubble"
          label="新建文本模型"
          onPress={() =>
            router.push({
              pathname: "/model-configurations/new",
              params: { type: "text" },
            })
          }
          variant="secondary"
        />
      </View>

      {isLoading ? (
        <ActivityIndicator color={accentColor} />
      ) : (
        <>
          <ConfigurationGroup
            configurations={configurations.filter(
              (configuration) => configuration.type === "image",
            )}
            defaultId={settings.defaultImageModelConfigurationId}
            title="图片模型"
            type="image"
          />
          <ConfigurationGroup
            configurations={configurations.filter(
              (configuration) => configuration.type === "text",
            )}
            defaultId={settings.defaultTextModelConfigurationId}
            title="文本模型"
            type="text"
          />
        </>
      )}
    </ScrollView>
  );
}

interface ConfigurationGroupProps {
  configurations: ModelConfiguration[];
  defaultId: string | null;
  title: string;
  type: ModelConfigurationType;
}

function ConfigurationGroup({
  configurations,
  defaultId,
  title,
  type,
}: ConfigurationGroupProps) {
  const router = useRouter();
  const mutedColor = useCSSVariable("--sf-text-2");

  return (
    <View className="gap-2.5">
      <Text className="text-lg font-extrabold leading-6 text-sf-text" selectable>
        {title}
      </Text>
      {configurations.length === 0 ? (
        <Text className="text-sm leading-5 text-sf-text-2" selectable>
          {type === "image" ? "暂无图片模型配置" : "暂无文本模型配置"}
        </Text>
      ) : (
        configurations.map((configuration) => (
          <Pressable
            accessibilityRole="button"
            key={configuration.id}
            onPress={() =>
              router.push({
                pathname: "/model-configurations/[id]",
                params: { id: configuration.id },
              })
            }
            className="flex-row items-center gap-3 rounded-lg border border-sf-separator bg-sf-bg-3 p-3.5 active:opacity-75"
          >
            <View className="min-w-0 flex-1 gap-1">
              <View className="flex-row items-center gap-2">
                <Text
                  className="flex-1 text-base font-bold leading-[22px] text-sf-text"
                  numberOfLines={1}
                  selectable
                >
                  {configuration.modelName}
                </Text>
                {configuration.id === defaultId ? <DefaultBadge /> : null}
              </View>
              <Text
                className="text-[13px] leading-[18px] text-sf-text-2"
                numberOfLines={1}
                selectable
              >
                {formatBaseUrlBrief(configuration.baseUrl)}
              </Text>
            </View>
            <Text
              className={cn(
                "text-[13px] font-bold leading-[18px]",
                configuration.isReady ? "text-sf-green" : "text-sf-orange",
              )}
              selectable
            >
              {configuration.isReady ? "就绪" : "未就绪"}
            </Text>
            <SymbolIcon
              className="h-[18px] w-[18px]"
              name="chevron.right"
              tintColor={mutedColor}
            />
          </Pressable>
        ))
      )}
    </View>
  );
}

interface ActionButtonProps {
  icon: SFSymbolName;
  label: string;
  onPress(): void;
  variant?: "primary" | "secondary";
}

function ActionButton({
  icon,
  label,
  onPress,
  variant = "primary",
}: ActionButtonProps) {
  const primaryIconColor = useCSSVariable("--sf-bg");
  const secondaryIconColor = useCSSVariable("--sf-blue");

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className={cn(
        "min-h-11 flex-1 flex-row items-center justify-center gap-2 rounded-lg px-3 active:opacity-75",
        variant === "secondary" ? "bg-sf-fill" : "bg-sf-blue",
      )}
    >
      <SymbolIcon
        className="h-[18px] w-[18px]"
        name={icon}
        tintColor={
          variant === "secondary" ? secondaryIconColor : primaryIconColor
        }
      />
      <Text
        className={cn(
          "text-sm font-bold leading-5",
          variant === "secondary" ? "text-sf-blue" : "text-sf-bg",
        )}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function DefaultBadge() {
  return (
    <View className="min-h-[22px] shrink-0 items-center justify-center rounded-full bg-sf-fill px-2">
      <Text className="text-xs font-bold leading-4 text-sf-blue" selectable>
        默认
      </Text>
    </View>
  );
}

function formatBaseUrlBrief(baseUrl: string): string {
  try {
    const parsed = new URL(baseUrl);
    return `${parsed.host}${parsed.pathname === "/" ? "" : parsed.pathname}`;
  } catch {
    return baseUrl;
  }
}
