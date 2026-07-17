import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ActivityIndicator, Alert } from "react-native";

import { useReadyAppRuntime } from "../../src/app-state";
import { formatLocalDateTime } from "../../src/formatters/date-time";
import {
  BaseApiError,
  createBackupSessionStore,
  createBaseApiClient,
  parseConnectionInput,
  runBackup,
  useMigrationLock,
  type TableBackupConnection,
} from "../../src/table-backup";
import { cn, Text, TextInput, useCSSVariable, View } from "../../src/tw";
import { AppButton } from "../../src/ui/AppButton";
import { Badge } from "../../src/ui/Badge";
import { ScreenScrollView } from "../../src/ui/ScreenCanvas";
import { Surface } from "../../src/ui/Surface";

type Feedback = { tone: "success" | "danger" | "notice"; message: string } | null;

const WIKI_GUIDANCE =
  "检测到知识库（/wiki/）链接。知识库链接携带的是 wiki 节点 token，本通道无法解析。" +
  "请在该多维表格用「开发工具」插件查出 app_token 后粘贴，或直接粘贴云空间 /base/ 链接。";

export default function TableBackupScreen() {
  const router = useRouter();
  const runtime = useReadyAppRuntime();
  const connectionRepository = runtime.tableBackupConnectionRepository;
  const migrationLock = useMigrationLock();
  const actionColor = useCSSVariable("--app-action");

  const sessionRef = useRef(createBackupSessionStore());
  const session = sessionRef.current;
  const sessionState = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot,
  );

  const [connection, setConnection] = useState<TableBackupConnection | null>(null);
  const [hasToken, setHasToken] = useState(false);
  const [linkInput, setLinkInput] = useState("");
  const [tokenInput, setTokenInput] = useState("");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    const [current, token] = await Promise.all([
      connectionRepository.get(),
      connectionRepository.getToken(),
    ]);
    setConnection(current);
    setHasToken(token !== null);
    setLinkInput((previous) => (previous === "" && current ? current.appToken : previous));
  }, [connectionRepository]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await reload();
      if (!cancelled) {
        setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reload]);

  const parsedInput = parseConnectionInput(linkInput);
  const isRunning =
    sessionState.status === "running" || sessionState.status === "cancelling";

  async function handleSave() {
    if (saving || isRunning) {
      return;
    }
    setFeedback(null);
    const parsed = parseConnectionInput(linkInput);
    if (parsed.kind === "empty") {
      setFeedback({ tone: "danger", message: "请输入多维表格链接或 app_token。" });
      return;
    }
    if (parsed.kind === "wiki_link") {
      setFeedback({ tone: "danger", message: WIKI_GUIDANCE });
      return;
    }
    if (parsed.kind === "unrecognized") {
      setFeedback({
        tone: "danger",
        message: "无法识别的输入，请粘贴 /base/ 链接或裸 app_token。",
      });
      return;
    }

    const nextToken = tokenInput.trim();
    if (!hasToken && nextToken === "") {
      setFeedback({ tone: "danger", message: "请填写个人授权码。" });
      return;
    }

    setSaving(true);
    try {
      await connectionRepository.save({
        appToken: parsed.appToken,
        token: nextToken.length > 0 ? nextToken : undefined,
      });
      setTokenInput("");
      await reload();

      // 保存时自动做一次只读探测，失败不阻断保存。
      const token = await connectionRepository.getToken();
      if (!token) {
        setFeedback({ tone: "success", message: "已保存连接配置。" });
        return;
      }
      try {
        const client = createBaseApiClient({ appToken: parsed.appToken, token });
        await client.listTables({ pageSize: 1 });
        setFeedback({ tone: "success", message: "已保存，连接探测通过。" });
      } catch (error) {
        setFeedback({
          tone: "notice",
          message: `已保存，但探测未通过：${describeError(error)}`,
        });
      }
    } catch (error) {
      setFeedback({ tone: "danger", message: describeError(error) });
    } finally {
      setSaving(false);
    }
  }

  async function handleBackup() {
    if (isRunning || saving) {
      return;
    }
    if (!connection || !hasToken) {
      setFeedback({ tone: "danger", message: "请先配置连接与个人授权码。" });
      return;
    }
    setFeedback(null);
    const signal = session.start();
    const result = await runBackup({
      connection: connectionRepository,
      entries: runtime.personalPromptdexEntryRepository,
      imageTasks: runtime.imageTaskRepository,
      imageFileStorage: runtime.imageFileStorage,
      migrationLock,
      createClient: (appToken, token) => createBaseApiClient({ appToken, token }),
      signal,
    });
    if (result.status === "needs_table_choice") {
      session.settle({
        status: "failed",
        message: "发现现有 Imagemon 备份数据表，请选择恢复、覆盖或新建。",
      });
      return;
    }
    session.settle(result);
    if (result.status === "succeeded") {
      await reload();
    }
  }

  function handleClear() {
    if (isRunning || saving) {
      return;
    }
    Alert.alert("清除飞书连接", "将同步删除本机保存的个人授权码。", [
      { text: "取消", style: "cancel" },
      {
        text: "清除",
        style: "destructive",
        onPress: () => {
          void (async () => {
            await connectionRepository.clear();
            session.reset();
            setLinkInput("");
            setTokenInput("");
            await reload();
            setFeedback({ tone: "success", message: "已清除连接配置。" });
          })();
        },
      },
    ]);
  }

  if (!loaded) {
    return (
      <ScreenScrollView variant="tool">
        <ActivityIndicator color={actionColor} />
      </ScreenScrollView>
    );
  }

  return (
    <ScreenScrollView keyboardBehavior="form" variant="tool">
      <Surface variant="fieldGroup">
        <Text className="text-[13px] leading-[18px] text-app-ink-muted" selectable>
          将个人与内置条目组成的合并图鉴全量镜像到飞书，并为已生成条目附上最新一张展示图。
          展示图按原图上传，单张不得超过 20 MB。
        </Text>
        <Field
          autoCapitalize="none"
          editable={!saving && !isRunning}
          keyboardType="url"
          label="多维表格链接或 app_token"
          onChangeText={(value) => {
            setLinkInput(value);
            setFeedback(null);
          }}
          value={linkInput}
        />
        <Field
          autoCapitalize="none"
          editable={!saving && !isRunning}
          label="个人授权码"
          onChangeText={(value) => {
            setTokenInput(value);
            setFeedback(null);
          }}
          secureTextEntry
          value={tokenInput}
        />
        <Text className="text-[13px] leading-[18px] text-app-ink-muted" selectable>
          {credentialStatus(hasToken, tokenInput)}
        </Text>
      </Surface>

      {parsedInput.kind === "wiki_link" ? (
        <Surface tone="warning" variant="feedback">
          <Text className="text-sm leading-5 text-app-ink" selectable>
            {WIKI_GUIDANCE}
          </Text>
        </Surface>
      ) : null}

      <AppButton
        disabled={saving || isRunning}
        icon="save"
        label={saving ? "保存中" : "保存连接"}
        onPress={() => {
          void handleSave();
        }}
      />

      <Surface variant="fieldGroup">
        <View className="flex-row items-center justify-between gap-3">
          <Text className="text-sm font-semibold leading-5 text-app-ink" selectable>
            上次成功备份
          </Text>
          <Badge variant={connection?.lastBackupSucceededAt ? "success" : "warning"}>
            {connection?.lastBackupSucceededAt
              ? formatLocalDateTime(connection.lastBackupSucceededAt)
              : "尚未备份"}
          </Badge>
        </View>

        {sessionState.status === "succeeded" ? (
          <Text className="text-[13px] leading-[18px] text-app-success" selectable>
            {summaryLabel(sessionState.summary)}
          </Text>
        ) : null}
        {sessionState.status === "failed" ? (
          <Text className="text-[13px] leading-[18px] text-app-danger" selectable>
            {sessionState.message}
          </Text>
        ) : null}

        <AppButton
          disabled={!connection || !hasToken || isRunning || saving}
          icon="save"
          label={backupButtonLabel(sessionState.status)}
          onPress={() => {
            void handleBackup();
          }}
        />
        {isRunning ? (
          <AppButton
            disabled={sessionState.status === "cancelling"}
            icon="delete"
            label={sessionState.status === "cancelling" ? "正在取消" : "取消备份"}
            onPress={() => session.requestCancel()}
            variant="secondary"
          />
        ) : null}
        {isRunning ? <ActivityIndicator color={actionColor} /> : null}
      </Surface>

      <AppButton
        disabled={!connection || !hasToken || isRunning || saving}
        icon="refresh"
        label="表格恢复"
        onPress={() => router.push("/table-backup/restore" as never)}
        variant="secondary"
      />

      {feedback ? (
        <Surface
          tone={feedback.tone === "danger" ? "danger" : feedback.tone === "notice" ? "warning" : "success"}
          variant="feedback"
        >
          <Text
            className={cn(
              "text-sm leading-5",
              feedback.tone === "danger"
                ? "text-app-danger"
                : feedback.tone === "notice"
                  ? "text-app-ink"
                  : "text-app-success",
            )}
            selectable
          >
            {feedback.message}
          </Text>
        </Surface>
      ) : null}

      {connection ? (
        <AppButton
          disabled={saving || isRunning}
          icon="delete"
          label="清除连接"
          onPress={handleClear}
          variant="danger"
        />
      ) : null}
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

function credentialStatus(hasToken: boolean, tokenInput: string): string {
  if (tokenInput.trim().length > 0) {
    return "保存后替换个人授权码";
  }
  if (hasToken) {
    return "已保存凭据（不回显）";
  }
  return "未保存凭据";
}

function backupButtonLabel(status: string): string {
  if (status === "running") {
    return "备份中";
  }
  if (status === "cancelling") {
    return "正在取消";
  }
  return "立即备份";
}

function summaryLabel(summary: {
  created: number;
  updated: number;
  deleted: number;
  skipped: number;
  uploadedImages: number;
}): string {
  return `备份完成：新增 ${summary.created} · 更新 ${summary.updated} · 删除 ${summary.deleted} · 跳过 ${summary.skipped} · 上传图片 ${summary.uploadedImages}`;
}

function describeError(error: unknown): string {
  if (error instanceof BaseApiError) {
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}
