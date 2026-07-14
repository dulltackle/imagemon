import type { ImageLoadEventData } from "expo-image";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import type { LayoutChangeEvent } from "react-native";
import { ActivityIndicator } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useReadyAppRuntime } from "../../src/app-state";
import {
  IMAGE_VIEWER_DOUBLE_TAP_SCALE,
  IMAGE_VIEWER_MIN_SCALE,
  clampImageViewerScale,
  clampImageViewerTranslation,
  type ImageResult,
} from "../../src/image-tasks";
import {
  Image,
  Pressable,
  SymbolIcon,
  Text,
  View,
} from "../../src/tw";

type ImageViewerState =
  | { status: "loading" }
  | { status: "missing" }
  | { status: "missingFile" }
  | { status: "failed" }
  | { status: "ready"; imageResult: ImageResult; imageUri: string };

export default function ImageViewerScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const runtime = useReadyAppRuntime();
  const insets = useSafeAreaInsets();
  const [state, setState] = useState<ImageViewerState>({ status: "loading" });
  const [isZoomed, setIsZoomed] = useState(false);
  const id = typeof params.id === "string" ? params.id : null;

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsZoomed(false);
      setState({ status: "loading" });
      if (!id) {
        setState({ status: "missing" });
        return;
      }

      try {
        const imageResult =
          await runtime.imageTaskRepository.getImageResult(id);
        if (cancelled) {
          return;
        }
        if (!imageResult) {
          setState({ status: "missing" });
          return;
        }

        const imageUri = await runtime.imageFileStorage.resolveFileUri(
          imageResult.filePath,
        );
        if (!cancelled) {
          setState({ status: "ready", imageResult, imageUri });
        }
      } catch {
        if (!cancelled) {
          setState({ status: "failed" });
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [id, runtime.imageFileStorage, runtime.imageTaskRepository]);

  function closeViewer() {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace(id ? (`/images/${encodeURIComponent(id)}` as never) : "/");
  }

  return (
    <View className="flex-1 bg-black">
      <Stack.Screen options={{ gestureEnabled: !isZoomed }} />
      {state.status === "ready" ? (
        <ImageViewerCanvas
          imageResult={state.imageResult}
          imageUri={state.imageUri}
          isZoomed={isZoomed}
          onMissingFile={() => {
            setIsZoomed(false);
            setState({ status: "missingFile" });
          }}
          onZoomedChange={setIsZoomed}
        />
      ) : (
        <View className="flex-1 items-center justify-center gap-3 px-8">
          {state.status === "loading" ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text
              className="text-center text-lg font-bold leading-6 text-white"
              selectable
            >
              {getViewerStateMessage(state.status)}
            </Text>
          )}
        </View>
      )}

      <Pressable
        accessibilityLabel="关闭图片查看器"
        accessibilityRole="button"
        className="absolute h-11 w-11 items-center justify-center rounded-full border border-white/20 active:opacity-75"
        onPress={closeViewer}
        style={{
          backgroundColor: "rgba(0, 0, 0, 0.62)",
          left: Math.max(insets.left, 12),
          top: Math.max(insets.top, 12),
        }}
      >
        <SymbolIcon
          className="h-5 w-5"
          name="close"
          tintColor="#FFFFFF"
        />
      </Pressable>
    </View>
  );
}

function ImageViewerCanvas({
  imageResult,
  imageUri,
  isZoomed,
  onMissingFile,
  onZoomedChange,
}: {
  imageResult: ImageResult;
  imageUri: string;
  isZoomed: boolean;
  onMissingFile(): void;
  onZoomedChange(value: boolean): void;
}) {
  const insets = useSafeAreaInsets();
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [sourceSize, setSourceSize] = useState(() => ({
    width: positiveOrZero(imageResult.width),
    height: positiveOrZero(imageResult.height),
  }));
  const scale = useSharedValue(IMAGE_VIEWER_MIN_SCALE);
  const startScale = useSharedValue(IMAGE_VIEWER_MIN_SCALE);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const startTranslateX = useSharedValue(0);
  const startTranslateY = useSharedValue(0);
  const fittedImage = fitImageWithinViewport(viewport, sourceSize);

  useEffect(() => {
    cancelAnimation(scale);
    cancelAnimation(translateX);
    cancelAnimation(translateY);
    scale.value = IMAGE_VIEWER_MIN_SCALE;
    startScale.value = IMAGE_VIEWER_MIN_SCALE;
    translateX.value = 0;
    translateY.value = 0;
    startTranslateX.value = 0;
    startTranslateY.value = 0;
    onZoomedChange(false);
  }, [
    fittedImage.height,
    fittedImage.width,
    onZoomedChange,
    scale,
    startScale,
    startTranslateX,
    startTranslateY,
    translateX,
    translateY,
    viewport.height,
    viewport.width,
  ]);

  function handleLayout(event: LayoutChangeEvent) {
    const { height, width } = event.nativeEvent.layout;
    setViewport((current) =>
      current.width === width && current.height === height
        ? current
        : { width, height },
    );
  }

  function handleImageLoad(event: ImageLoadEventData) {
    const width = positiveOrZero(event.source.width);
    const height = positiveOrZero(event.source.height);
    if (width === 0 || height === 0) {
      return;
    }
    setSourceSize((current) =>
      current.width === width && current.height === height
        ? current
        : { width, height },
    );
  }

  function resetViewer() {
    scale.value = withSpring(IMAGE_VIEWER_MIN_SCALE, SPRING_CONFIG);
    translateX.value = withSpring(0, SPRING_CONFIG);
    translateY.value = withSpring(0, SPRING_CONFIG);
    onZoomedChange(false);
  }

  const settleTransform = () => {
    "worklet";
    const nextScale = clampImageViewerScale(scale.value);
    const nextTranslation = clampImageViewerTranslation({
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      fittedImageWidth: fittedImage.width,
      fittedImageHeight: fittedImage.height,
      scale: nextScale,
      x: translateX.value,
      y: translateY.value,
    });
    scale.value = withSpring(nextScale, SPRING_CONFIG);
    translateX.value = withSpring(nextTranslation.x, SPRING_CONFIG);
    translateY.value = withSpring(nextTranslation.y, SPRING_CONFIG);
    runOnJS(onZoomedChange)(nextScale > IMAGE_VIEWER_MIN_SCALE);
  };

  const pinchGesture = Gesture.Pinch()
    .onStart(() => {
      startScale.value = scale.value;
    })
    .onUpdate((event) => {
      const nextScale = clampImageViewerScale(startScale.value * event.scale);
      const nextTranslation = clampImageViewerTranslation({
        viewportWidth: viewport.width,
        viewportHeight: viewport.height,
        fittedImageWidth: fittedImage.width,
        fittedImageHeight: fittedImage.height,
        scale: nextScale,
        x: translateX.value,
        y: translateY.value,
      });
      scale.value = nextScale;
      translateX.value = nextTranslation.x;
      translateY.value = nextTranslation.y;
    })
    .onFinalize(settleTransform);

  const panGesture = Gesture.Pan()
    .enabled(isZoomed)
    .onStart(() => {
      startTranslateX.value = translateX.value;
      startTranslateY.value = translateY.value;
    })
    .onUpdate((event) => {
      const nextTranslation = clampImageViewerTranslation({
        viewportWidth: viewport.width,
        viewportHeight: viewport.height,
        fittedImageWidth: fittedImage.width,
        fittedImageHeight: fittedImage.height,
        scale: scale.value,
        x: startTranslateX.value + event.translationX,
        y: startTranslateY.value + event.translationY,
      });
      translateX.value = nextTranslation.x;
      translateY.value = nextTranslation.y;
    })
    .onFinalize(settleTransform);

  const doubleTapGesture = Gesture.Tap()
    .numberOfTaps(2)
    .maxDuration(250)
    .maxDistance(12)
    .onEnd((_event, success) => {
      if (!success) {
        return;
      }
      const nextScale =
        scale.value > IMAGE_VIEWER_MIN_SCALE
          ? IMAGE_VIEWER_MIN_SCALE
          : IMAGE_VIEWER_DOUBLE_TAP_SCALE;
      scale.value = withSpring(nextScale, SPRING_CONFIG);
      translateX.value = withSpring(0, SPRING_CONFIG);
      translateY.value = withSpring(0, SPRING_CONFIG);
      runOnJS(onZoomedChange)(nextScale > IMAGE_VIEWER_MIN_SCALE);
    });

  const composedGesture = Gesture.Race(
    doubleTapGesture,
    Gesture.Simultaneous(pinchGesture, panGesture),
  );
  const animatedImageStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  return (
    <View className="flex-1" onLayout={handleLayout}>
      <GestureDetector gesture={composedGesture}>
        <Animated.View style={[{ flex: 1 }, animatedImageStyle]}>
          <Image
            cachePolicy="none"
            className="h-full w-full"
            contentFit="contain"
            onError={onMissingFile}
            onLoad={handleImageLoad}
            source={{ uri: imageUri }}
          />
        </Animated.View>
      </GestureDetector>

      {isZoomed ? (
        <Pressable
          accessibilityLabel="重置图片缩放"
          accessibilityRole="button"
          className="absolute min-h-11 items-center justify-center rounded-full border border-white/20 px-4 active:opacity-75"
          onPress={resetViewer}
          style={{
            backgroundColor: "rgba(0, 0, 0, 0.62)",
            right: Math.max(insets.right, 12),
            top: Math.max(insets.top, 12),
          }}
        >
          <Text className="text-sm font-bold text-white">重置</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const SPRING_CONFIG = {
  damping: 22,
  stiffness: 240,
};

function getViewerStateMessage(
  status: Exclude<ImageViewerState["status"], "loading" | "ready">,
): string {
  switch (status) {
    case "missing":
      return "图片结果不存在";
    case "missingFile":
      return "图片文件缺失";
    case "failed":
      return "加载失败，请返回重试";
  }
}

function positiveOrZero(value: number | null): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : 0;
}

function fitImageWithinViewport(
  viewport: { width: number; height: number },
  source: { width: number; height: number },
): { width: number; height: number } {
  if (
    viewport.width <= 0 ||
    viewport.height <= 0 ||
    source.width <= 0 ||
    source.height <= 0
  ) {
    return { width: viewport.width, height: viewport.height };
  }

  const fitScale = Math.min(
    viewport.width / source.width,
    viewport.height / source.height,
  );
  return {
    width: source.width * fitScale,
    height: source.height * fitScale,
  };
}
