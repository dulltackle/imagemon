import { useRouter } from "expo-router";
import { useState } from "react";

import {
  useAppSettings,
  useModelConfigurationRepository,
  useReplaceAppSettings,
} from "../src/app-state";
import {
  APPLICATION_DEFAULT_IMAGE_SPEC,
  getImageTaskSizeLabel,
} from "../src/image-tasks/default-spec";
import {
  IMAGE_TASK_AVAILABLE_SIZES,
  type ImageTaskSize,
} from "../src/image-tasks/types";
import { Pressable, Text, View, cn } from "../src/tw";
import { AppButton } from "../src/ui/AppButton";
import { ScreenScrollView } from "../src/ui/ScreenCanvas";
import { SectionTitle } from "../src/ui/SectionTitle";
import { Surface } from "../src/ui/Surface";

const FIXED_DIMENSIONS = [
  { label: "质量", value: "自动（当前版本固定）" },
  { label: "格式", value: "PNG（当前版本固定）" },
  { label: "数量", value: "1 张（当前版本固定）" },
];

export default function DefaultImageSpecScreen() {
  const router = useRouter();
  const settings = useAppSettings();
  const repository = useModelConfigurationRepository();
  const replaceSettings = useReplaceAppSettings();
  const [size, setSize] = useState<ImageTaskSize>(
    settings.defaultImageSpec.size,
  );
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setIsSaving(true);
    setError(null);
    try {
      const nextSettings = await repository.updateDefaultImageSpec({
        ...APPLICATION_DEFAULT_IMAGE_SPEC,
        size,
      });
      replaceSettings(nextSettings);
      router.back();
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "保存失败，请重试。",
      );
      setIsSaving(false);
    }
  }

  return (
    <ScreenScrollView variant="tool">
      <Surface variant="fieldGroup">
        <SectionTitle>尺寸</SectionTitle>
        <View className="flex-row gap-2">
          {IMAGE_TASK_AVAILABLE_SIZES.map((option) => {
            const selected = option === size;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected }}
                key={option}
                onPress={() => setSize(option)}
                className={cn(
                  "min-h-16 flex-1 items-center justify-center gap-1 rounded-[14px] border border-app-stroke bg-app-field px-2 py-2.5 active:bg-app-action-soft",
                  selected && "border-app-action bg-app-action-soft",
                )}
                style={{ borderCurve: "continuous" }}
              >
                <Text
                  className={cn(
                    "text-sm font-bold leading-5",
                    selected ? "text-app-action" : "text-app-ink",
                  )}
                >
                  {getImageTaskSizeLabel(option)}
                </Text>
                <Text
                  className={cn(
                    "text-xs font-bold leading-4",
                    selected ? "text-app-action" : "text-app-ink-muted",
                  )}
                >
                  {option}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text
          className="text-[13px] leading-[18px] text-app-ink-muted"
          selectable
        >
          新任务表单会预填这里的尺寸，执行前仍可按次修改，且不会写回默认。
        </Text>
      </Surface>

      <Surface variant="panel">
        <SectionTitle>其他维度</SectionTitle>
        {FIXED_DIMENSIONS.map((dimension) => (
          <View
            className="flex-row items-center justify-between gap-3"
            key={dimension.label}
          >
            <Text
              className="text-[15px] leading-[22px] text-app-ink"
            >
              {dimension.label}
            </Text>
            <Text
              className="text-[15px] leading-[22px] text-app-ink-muted"
            >
              {dimension.value}
            </Text>
          </View>
        ))}
      </Surface>

      {error ? (
        <Surface tone="danger" variant="feedback">
          <Text
            className="text-[13px] leading-[18px] text-app-danger"
          >
            {error}
          </Text>
        </Surface>
      ) : null}

      <AppButton
        disabled={isSaving}
        label={isSaving ? "正在保存…" : "保存"}
        loading={isSaving}
        onPress={() => void save()}
      />
    </ScreenScrollView>
  );
}
