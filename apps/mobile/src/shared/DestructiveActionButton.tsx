import { AppButton } from "../ui/AppButton";

interface DestructiveActionButtonProps {
  disabled?: boolean;
  isDeleting?: boolean;
  label: string;
  onPress(): void;
}

export function DestructiveActionButton({
  disabled = false,
  isDeleting = false,
  label,
  onPress,
}: DestructiveActionButtonProps) {
  return (
    <AppButton
      disabled={disabled}
      icon="delete"
      label={isDeleting ? "删除中…" : label}
      loading={isDeleting}
      onPress={onPress}
      variant="danger"
    />
  );
}
