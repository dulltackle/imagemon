import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator } from "react-native";

import { useReadyAppRuntime } from "../../src/app-state";
import type {
  ModelConfiguration,
  ModelConfigurationType,
} from "../../src/model-configurations";
import { SymbolIcon, Text, useCSSVariable, View } from "../../src/tw";
import { AppButton } from "../../src/ui/AppButton";
import { Badge } from "../../src/ui/Badge";
import { ScreenScrollView } from "../../src/ui/ScreenCanvas";
import { SectionTitle } from "../../src/ui/SectionTitle";
import { Surface } from "../../src/ui/Surface";

export default function ModelConfigurationsScreen() {
  const router = useRouter();
  const runtime = useReadyAppRuntime();
  const { refreshSettings, repository, settings } = runtime;
  const actionColor = useCSSVariable("--app-action");
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
    <ScreenScrollView variant="tool">
      <View className="flex-row gap-3">
        <View className="flex-1">
          <AppButton
            icon="photo"
            label="新建图片模型"
            onPress={() =>
              router.push({
                pathname: "/model-configurations/new",
                params: { type: "image" },
              })
            }
          />
        </View>
        <View className="flex-1">
          <AppButton
            icon="text-model"
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
      </View>

      {isLoading ? (
        <ActivityIndicator color={actionColor} />
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
    </ScreenScrollView>
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
  const mutedColor = useCSSVariable("--app-ink-muted");

  return (
    <View className="gap-2.5">
      <SectionTitle>{title}</SectionTitle>
      {configurations.length === 0 ? (
        <Text className="text-sm leading-5 text-app-ink-muted">
          {type === "image" ? "暂无图片模型配置" : "暂无文本模型配置"}
        </Text>
      ) : (
        configurations.map((configuration) => (
          <Surface
            accessibilityLabel={`打开模型配置 ${configuration.modelName}`}
            key={configuration.id}
            onPress={() =>
              router.push({
                pathname: "/model-configurations/[id]",
                params: { id: configuration.id },
              })
            }
            variant="interactive"
          >
            <View className="flex-row items-center gap-3 p-3.5">
              <View className="min-w-0 flex-1 gap-1">
                <View className="flex-row items-center gap-2">
                  <Text
                    className="flex-1 text-base font-bold leading-[22px] text-app-ink"
                    numberOfLines={1}
                  >
                    {configuration.modelName}
                  </Text>
                  {configuration.id === defaultId ? <DefaultBadge /> : null}
                </View>
                <Text
                  className="text-[13px] leading-[18px] text-app-ink-muted"
                  numberOfLines={1}
                >
                  {formatBaseUrlBrief(configuration.baseUrl)}
                </Text>
              </View>
              <Badge variant={configuration.isReady ? "success" : "warning"}>
                {configuration.isReady ? "就绪" : "未就绪"}
              </Badge>
              <SymbolIcon
                className="h-[18px] w-[18px]"
                name="chevron-right"
                tintColor={mutedColor}
              />
            </View>
          </Surface>
        ))
      )}
    </View>
  );
}

function DefaultBadge() {
  return <Badge variant="brand">默认</Badge>;
}

function formatBaseUrlBrief(baseUrl: string): string {
  try {
    const parsed = new URL(baseUrl);
    return `${parsed.host}${parsed.pathname === "/" ? "" : parsed.pathname}`;
  } catch {
    return baseUrl;
  }
}
