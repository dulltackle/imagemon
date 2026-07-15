import type {
  PressableProps as NativePressableProps,
  ViewStyle,
} from "react-native";

export interface PressFeedbackDelayProps {
  delayPressIn?: number;
  unstable_pressDelay?: number;
}

export interface PressFeedbackClassNameProps {
  className?: string;
}

type NativePressableStyle = NativePressableProps["style"];

interface WebPressFeedbackDelayStyle extends ViewStyle {
  transitionDelay: string;
}

export function getPressFeedbackDelayProps(
  runtimeOS: string | undefined,
  delayMs: number | undefined,
): PressFeedbackDelayProps {
  if (delayMs === undefined) {
    return {};
  }

  return runtimeOS === "web"
    ? { delayPressIn: delayMs }
    : { unstable_pressDelay: delayMs };
}

export function getPressFeedbackDelayStyle(
  runtimeOS: string | undefined,
  delayMs: number | undefined,
  style: NativePressableStyle,
): NativePressableStyle {
  if (runtimeOS !== "web" || delayMs === undefined) {
    return style;
  }

  const delayStyle: WebPressFeedbackDelayStyle = {
    transitionDelay: `${delayMs}ms`,
  };

  return typeof style === "function"
    ? (state) => [style(state), delayStyle]
    : [style, delayStyle];
}

export function getPressFeedbackClassNameProps(
  runtimeOS: string | undefined,
  delayMs: number | undefined,
  className: string | undefined,
): PressFeedbackClassNameProps {
  if (runtimeOS !== "web" || delayMs === undefined || !className) {
    return { className };
  }

  const classNames: string[] = [];
  for (const name of className.split(/\s+/)) {
    if (!name) {
      continue;
    }

    if (!name.startsWith("active:") || name.length === "active:".length) {
      classNames.push(name);
    }
  }

  return {
    className: classNames.join(" ") || undefined,
  };
}
