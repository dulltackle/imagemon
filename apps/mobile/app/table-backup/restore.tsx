import { useState } from "react";
import { ActivityIndicator } from "react-native";

import {
  usePersonalPromptdexEntryRepository,
  useTableBackupConnectionRepository,
} from "../../src/app-state";
import {
  createBaseApiClient,
  runRestoreCommit,
  runRestorePreflight,
  useMigrationLock,
  type RestoreInvalidRecord,
  type RestorePreflight,
  type RestoreValidRecord,
} from "../../src/table-backup";
import { cn, Pressable, SymbolIcon, Text, useCSSVariable, View } from "../../src/tw";
import { AppButton } from "../../src/ui/AppButton";
import { Badge } from "../../src/ui/Badge";
import { ScreenScrollView } from "../../src/ui/ScreenCanvas";
import { SectionTitle } from "../../src/ui/SectionTitle";
import { Surface } from "../../src/ui/Surface";

type Phase = "idle" | "preflighting" | "report" | "restoring" | "done";
type Feedback = { tone: "danger" | "success"; message: string } | null;

export default function TableRestoreScreen() {
  const connectionRepository = useTableBackupConnectionRepository();
  const entriesRepository = usePersonalPromptdexEntryRepository();
  const migrationLock = useMigrationLock();
  const actionColor = useCSSVariable("--app-action");
  const onActionColor = useCSSVariable("--app-on-action");

  const [phase, setPhase] = useState<Phase>("idle");
  const [preflight, setPreflight] = useState<RestorePreflight | null>(null);
  const [excludeInvalid, setExcludeInvalid] = useState(false);
  const [restored, setRestored] = useState(0);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const validRecords: RestoreValidRecord[] = preflight
    ? [...preflight.additions, ...preflight.overwrites]
    : [];
  const hasBlockingInvalid =
    preflight !== null && preflight.invalid.length > 0 && !excludeInvalid;
  const canConfirm =
    phase === "report" && validRecords.length > 0 && !hasBlockingInvalid;

  async function handlePreflight() {
    if (phase === "preflighting" || phase === "restoring") {
      return;
    }
    setFeedback(null);
    setPreflight(null);
    setExcludeInvalid(false);
    setPhase("preflighting");
    const result = await runRestorePreflight({
      connection: connectionRepository,
      existingNames: async () => {
        const entries = await entriesRepository.list();
        return new Set(entries.map((entry) => entry.name));
      },
      createClient: (appToken, token) => createBaseApiClient({ appToken, token }),
      migrationLock,
    });
    if (result.status === "ready") {
      setPreflight(result.preflight);
      setPhase("report");
      return;
    }
    setPhase("idle");
    setFeedback({
      tone: "danger",
      message:
        result.status === "failed"
          ? result.message
          : preflightErrorMessage(result.status),
    });
  }

  async function handleConfirm() {
    if (!canConfirm) {
      return;
    }
    setFeedback(null);
    setPhase("restoring");
    const result = await runRestoreCommit({
      entries: entriesRepository,
      records: validRecords,
      migrationLock,
    });
    if (result.status === "succeeded") {
      setRestored(result.restored);
      setPhase("done");
      return;
    }
    setPhase("report");
    setFeedback({
      tone: "danger",
      message:
        result.status === "blocked"
          ? "已有其他操作进行中，请稍后重试。"
          : result.message,
    });
  }

  if (phase === "done") {
    return (
      <ScreenScrollView variant="tool">
        <Surface tone="success" variant="feedback">
          <Text className="text-sm leading-5 text-app-success" selectable>
            恢复完成：写入 {restored} 条条目，时间戳已按表格记录保真回写。
          </Text>
        </Surface>
        <AppButton
          icon="refresh"
          label="再次预检"
          onPress={() => {
            setPhase("idle");
            setPreflight(null);
            setRestored(0);
            setFeedback(null);
          }}
          variant="secondary"
        />
      </ScreenScrollView>
    );
  }

  return (
    <ScreenScrollView variant="tool">
      <Surface variant="fieldGroup">
        <Text className="text-[13px] leading-[18px] text-app-ink-muted" selectable>
          从飞书备份数据表读取记录并生成预检报告。确认后同名条目覆盖、本机独有保留，
          时间戳沿用表格记录。确认后不可取消。
        </Text>
        <AppButton
          disabled={phase === "preflighting" || phase === "restoring"}
          icon="refresh"
          label={phase === "preflighting" ? "预检中" : "开始恢复预检"}
          onPress={() => {
            void handlePreflight();
          }}
        />
        {phase === "preflighting" ? <ActivityIndicator color={actionColor} /> : null}
      </Surface>

      {feedback ? (
        <Surface tone={feedback.tone === "danger" ? "danger" : "success"} variant="feedback">
          <Text
            className={cn(
              "text-sm leading-5",
              feedback.tone === "danger" ? "text-app-danger" : "text-app-success",
            )}
            selectable
          >
            {feedback.message}
          </Text>
        </Surface>
      ) : null}

      {preflight ? (
        <>
          <RecordSection
            decoration="teal"
            title={`新增 ${preflight.additions.length}`}
            emptyLabel="无新增条目"
            names={preflight.additions.map((r) => r.name)}
          />
          <RecordSection
            decoration="sand"
            title={`覆盖 ${preflight.overwrites.length}`}
            emptyLabel="无覆盖条目"
            names={preflight.overwrites.map((r) => r.name)}
          />
          <BuiltInSection count={preflight.builtInRecords.length} />
          <InvalidSection invalid={preflight.invalid} />

          {preflight.invalid.length > 0 ? (
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: excludeInvalid }}
              onPress={() => setExcludeInvalid((value) => !value)}
              className="flex-row items-center gap-3"
            >
              <View
                className={cn(
                  "h-6 w-6 items-center justify-center rounded-md border",
                  excludeInvalid
                    ? "border-app-action bg-app-action"
                    : "border-app-stroke bg-app-field",
                )}
                style={{ borderCurve: "continuous" }}
              >
                {excludeInvalid ? (
                  <SymbolIcon className="h-4 w-4" name="confirm" tintColor={onActionColor} />
                ) : null}
              </View>
              <Text className="flex-1 text-sm leading-5 text-app-ink" selectable>
                排除非法记录继续（非法记录不会写入）
              </Text>
            </Pressable>
          ) : null}

          <AppButton
            disabled={!canConfirm}
            icon="confirm"
            label={phase === "restoring" ? "恢复中" : "确认恢复"}
            onPress={() => {
              void handleConfirm();
            }}
          />
          {hasBlockingInvalid ? (
            <Text className="text-[13px] leading-[18px] text-app-danger" selectable>
              存在非法记录，请勾选「排除非法记录继续」后再确认。
            </Text>
          ) : null}
          {validRecords.length === 0 ? (
            <Text className="text-[13px] leading-[18px] text-app-ink-muted" selectable>
              没有可写入的有效记录。
            </Text>
          ) : null}
          {phase === "restoring" ? <ActivityIndicator color={actionColor} /> : null}
        </>
      ) : null}
    </ScreenScrollView>
  );
}

interface RecordSectionProps {
  decoration: "teal" | "sand";
  title: string;
  emptyLabel: string;
  names: string[];
}

function RecordSection({ decoration, title, emptyLabel, names }: RecordSectionProps) {
  return (
    <View className="gap-2">
      <SectionTitle decoration={decoration}>{title}</SectionTitle>
      {names.length === 0 ? (
        <Text className="text-[13px] leading-[18px] text-app-ink-muted" selectable>
          {emptyLabel}
        </Text>
      ) : (
        <Surface variant="fieldGroup">
          {names.map((name) => (
            <Text key={name} className="text-sm leading-5 text-app-ink" selectable>
              {name}
            </Text>
          ))}
        </Surface>
      )}
    </View>
  );
}

function InvalidSection({ invalid }: { invalid: RestoreInvalidRecord[] }) {
  return (
    <View className="gap-2">
      <SectionTitle decoration="rose">{`非法 ${invalid.length}`}</SectionTitle>
      {invalid.length === 0 ? (
        <Text className="text-[13px] leading-[18px] text-app-ink-muted" selectable>
          无非法记录
        </Text>
      ) : (
        <Surface tone="danger" variant="feedback">
          {invalid.map((record, index) => (
            <Text
              key={`${record.name}-${index}`}
              className="text-[13px] leading-[18px] text-app-danger"
              selectable
            >
              {record.name || "（空名称）"}：{record.reason}
            </Text>
          ))}
        </Surface>
      )}
    </View>
  );
}

function BuiltInSection({ count }: { count: number }) {
  return (
    <View className="gap-2">
      <SectionTitle decoration="peach">{`内置记录 ${count}`}</SectionTitle>
      <Surface variant="fieldGroup">
        <Text className="text-[13px] leading-[18px] text-app-ink-muted" selectable>
          {count === 0
            ? "无内置记录。"
            : `已识别 ${count} 条内置图鉴记录，仅作备份目录展示，不会写入个人图鉴。`}
        </Text>
      </Surface>
    </View>
  );
}

function preflightErrorMessage(
  status:
    | "needs_table_choice"
    | "not_found"
    | "not_configured"
    | "blocked"
    | "cancelled",
): string {
  switch (status) {
    case "needs_table_choice":
      return "发现现有 Imagemon 备份数据表，请先选择恢复来源。";
    case "not_found":
      return "未发现可恢复的备份数据表。";
    case "not_configured":
      return "尚未配置飞书连接或个人授权码。";
    case "blocked":
      return "已有其他操作进行中，请稍后重试。";
    case "cancelled":
      return "预检已取消。";
  }
}
