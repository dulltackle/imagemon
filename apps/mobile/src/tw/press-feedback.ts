export interface PressFeedbackDelayProps {
  delayPressIn?: number;
  unstable_pressDelay?: number;
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
