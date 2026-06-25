import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";

import type { ModelConfigurationType } from "../model-configurations";

interface FirstRunModelFormState {
  name: string;
  baseUrl: string;
  modelName: string;
  apiKey: string;
}

const defaultImageForm: FirstRunModelFormState = {
  name: "默认图片模型",
  baseUrl: "https://api.openai.com/v1",
  modelName: "gpt-image-2",
  apiKey: "",
};

const defaultTextForm: FirstRunModelFormState = {
  name: "默认文本模型",
  baseUrl: "https://api.openai.com/v1",
  modelName: "",
  apiKey: "",
};

export function FirstRunSetupScreen() {
  const [imageForm, setImageForm] = useState(defaultImageForm);
  const [textForm, setTextForm] = useState(defaultTextForm);
  const [useSameConnection, setUseSameConnection] = useState(false);

  function handleUseSameConnection(value: boolean) {
    setUseSameConnection(value);
    if (value) {
      setTextForm((current) => ({
        ...current,
        baseUrl: imageForm.baseUrl,
        apiKey: imageForm.apiKey,
      }));
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={styles.screen}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={styles.title}>首次设置</Text>
          <Text style={styles.subtitle}>模型配置</Text>
        </View>

        <ModelSection
          form={imageForm}
          onChange={setImageForm}
          title="图片模型"
          type="image"
        />

        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>文本模型使用相同连接信息</Text>
          <Switch
            onValueChange={handleUseSameConnection}
            thumbColor={useSameConnection ? "#0F766E" : "#F8FAFC"}
            trackColor={{ false: "#CBD5E1", true: "#99F6E4" }}
            value={useSameConnection}
          />
        </View>

        <ModelSection
          form={textForm}
          onChange={setTextForm}
          title="文本模型"
          type="text"
        />

        <View style={styles.footer}>
          <ActionButton icon="checkmark-circle-outline" label="完成" onPress={() => {}} />
          <ActionButton icon="play-skip-forward-outline" label="跳过" onPress={() => {}} variant="secondary" />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

interface ModelSectionProps {
  form: FirstRunModelFormState;
  onChange(next: FirstRunModelFormState): void;
  title: string;
  type: ModelConfigurationType;
}

function ModelSection({ form, onChange, title, type }: ModelSectionProps) {
  const testLabel = type === "image" ? "保存并测试图片模型" : "保存并测试文本模型";

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      <Field
        label="配置名称"
        onChangeText={(name) => onChange({ ...form, name })}
        value={form.name}
      />
      <Field
        autoCapitalize="none"
        keyboardType="url"
        label="Base URL"
        onChangeText={(baseUrl) => onChange({ ...form, baseUrl })}
        value={form.baseUrl}
      />
      <Field
        autoCapitalize="none"
        label="模型名"
        onChangeText={(modelName) => onChange({ ...form, modelName })}
        value={form.modelName}
      />
      <Field
        autoCapitalize="none"
        label="API Key"
        onChangeText={(apiKey) => onChange({ ...form, apiKey })}
        secureTextEntry
        value={form.apiKey}
      />
      <View style={styles.sectionActions}>
        <ActionButton icon="flash-outline" label={testLabel} onPress={() => {}} />
      </View>
    </View>
  );
}

interface FieldProps {
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  keyboardType?: "default" | "url";
  label: string;
  onChangeText(value: string): void;
  secureTextEntry?: boolean;
  value: string;
}

function Field({
  autoCapitalize = "sentences",
  keyboardType = "default",
  label,
  onChangeText,
  secureTextEntry = false,
  value,
}: FieldProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        autoCapitalize={autoCapitalize}
        keyboardType={keyboardType}
        onChangeText={onChangeText}
        secureTextEntry={secureTextEntry}
        style={styles.input}
        value={value}
      />
    </View>
  );
}

interface ActionButtonProps {
  disabled?: boolean;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress(): void;
  variant?: "primary" | "secondary";
}

function ActionButton({
  disabled = false,
  icon,
  label,
  onPress,
  variant = "primary",
}: ActionButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        variant === "secondary" && styles.secondaryButton,
        disabled && styles.disabledButton,
        pressed && !disabled && styles.pressedButton,
      ]}
    >
      <Ionicons
        color={variant === "secondary" ? "#0F766E" : "#FFFFFF"}
        name={icon}
        size={18}
      />
      <Text style={[styles.buttonLabel, variant === "secondary" && styles.secondaryButtonLabel]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    backgroundColor: "#0F766E",
    borderRadius: 8,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 16,
  },
  buttonLabel: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },
  content: {
    gap: 20,
    padding: 20,
    paddingBottom: 32,
  },
  disabledButton: {
    opacity: 0.5,
  },
  field: {
    gap: 8,
  },
  fieldLabel: {
    color: "#334155",
    fontSize: 14,
    fontWeight: "600",
  },
  footer: {
    gap: 12,
  },
  header: {
    gap: 4,
    paddingTop: 8,
  },
  input: {
    backgroundColor: "#FFFFFF",
    borderColor: "#CBD5E1",
    borderRadius: 8,
    borderWidth: 1,
    color: "#0F172A",
    fontSize: 16,
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  pressedButton: {
    opacity: 0.86,
  },
  screen: {
    backgroundColor: "#F8FAFC",
    flex: 1,
  },
  secondaryButton: {
    backgroundColor: "#E0F2F1",
  },
  secondaryButtonLabel: {
    color: "#0F766E",
  },
  section: {
    borderColor: "#E2E8F0",
    borderRadius: 8,
    borderWidth: 1,
    gap: 14,
    padding: 16,
  },
  sectionActions: {
    marginTop: 2,
  },
  sectionHeader: {
    flexDirection: "row",
  },
  sectionTitle: {
    color: "#0F172A",
    fontSize: 18,
    fontWeight: "700",
  },
  subtitle: {
    color: "#475569",
    fontSize: 15,
  },
  switchLabel: {
    color: "#0F172A",
    flex: 1,
    fontSize: 15,
    fontWeight: "600",
  },
  switchRow: {
    alignItems: "center",
    borderColor: "#E2E8F0",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    minHeight: 52,
    paddingHorizontal: 16,
  },
  title: {
    color: "#0F172A",
    fontSize: 28,
    fontWeight: "800",
  },
});
