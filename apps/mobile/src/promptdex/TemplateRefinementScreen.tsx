import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  usePromptdexCatalogService,
  useTemplateRefinementDraftRepository,
  useTemplateRefinementService,
} from "../app-state";
import {
  getModelCallStatusLabel,
  useModelCallLock,
} from "../model-calls";
import {
  buildPromptdexTemplateFromRefinementProposal,
  validateTemplateRefinementInput,
  type TemplateRefinementDraft,
  type TemplateRefinementErrorSummary,
  type TemplateRefinementInputValidationIssue,
  type TemplateRefinementProposal,
} from "./index";

type ScreenPhase =
  | "loading"
  | "resume_choice"
  | "editing"
  | "generating"
  | "failed"
  | "review";

type Feedback =
  | {
      tone: "success" | "failure" | "notice";
      message: string;
    }
  | null;

export function TemplateRefinementScreen() {
  const router = useRouter();
  const draftRepository = useTemplateRefinementDraftRepository();
  const refinementService = useTemplateRefinementService();
  const catalogService = usePromptdexCatalogService();
  const modelCallLock = useModelCallLock();

  const [phase, setPhase] = useState<ScreenPhase>("loading");
  const [draft, setDraft] = useState<TemplateRefinementDraft | null>(null);
  const [externalPrompt, setExternalPrompt] = useState("");
  const [plannedUse, setPlannedUse] = useState("");
  const [inputIssues, setInputIssues] = useState<
    TemplateRefinementInputValidationIssue[]
  >([]);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [reviewName, setReviewName] = useState("");
  const [reviewDescription, setReviewDescription] = useState("");
  const [bodyApproved, setBodyApproved] = useState(false);
  const [additionsApproved, setAdditionsApproved] = useState(false);
  const [nameConflict, setNameConflict] = useState(false);
  const [isCheckingName, setIsCheckingName] = useState(false);
  const [contractError, setContractError] = useState<string | null>(null);
  const [isWriting, setIsWriting] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      async function loadDraft() {
        setPhase("loading");
        setFeedback(null);
        try {
          const currentDraft = await draftRepository.get();
          if (cancelled) {
            return;
          }
          setDraft(currentDraft);
          if (currentDraft) {
            hydrateDraftFields(currentDraft);
            setPhase("resume_choice");
          } else {
            resetForNewDraft();
            setPhase("editing");
          }
        } catch (error) {
          if (!cancelled) {
            setFeedback({
              tone: "failure",
              message: error instanceof Error ? error.message : String(error),
            });
            setPhase("editing");
          }
        }
      }

      void loadDraft();

      return () => {
        cancelled = true;
      };
    }, [draftRepository]),
  );

  const reviewProposal = useMemo(() => {
    if (!draft?.proposal) {
      return null;
    }
    return withReviewMetadata(draft.proposal, reviewName, reviewDescription);
  }, [draft?.proposal, reviewDescription, reviewName]);

  useEffect(() => {
    if (phase !== "review" || !reviewProposal) {
      setNameConflict(false);
      setContractError(null);
      setIsCheckingName(false);
      return;
    }

    try {
      buildPromptdexTemplateFromRefinementProposal(reviewProposal);
      setContractError(null);
    } catch (error) {
      setContractError(error instanceof Error ? error.message : String(error));
      setNameConflict(false);
      setIsCheckingName(false);
      return;
    }

    let cancelled = false;
    setIsCheckingName(true);
    void catalogService
      .get(reviewProposal.template.name)
      .then((existing) => {
        if (!cancelled) {
          setNameConflict(existing !== null);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setFeedback({
            tone: "failure",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsCheckingName(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [catalogService, phase, reviewProposal]);

  const additions = reviewProposal?.additions ?? [];
  const canWrite =
    phase === "review" &&
    reviewProposal !== null &&
    bodyApproved &&
    (additions.length === 0 || additionsApproved) &&
    !nameConflict &&
    !contractError &&
    !isCheckingName &&
    !isWriting;

  function hydrateDraftFields(currentDraft: TemplateRefinementDraft) {
    setExternalPrompt(currentDraft.externalPrompt);
    setPlannedUse(currentDraft.plannedUse);
    setInputIssues([]);
    setBodyApproved(false);
    setAdditionsApproved(false);
    setFeedback(null);
    if (currentDraft.proposal) {
      setReviewName(currentDraft.proposal.template.name);
      setReviewDescription(currentDraft.proposal.template.description);
    }
  }

  function resetForNewDraft() {
    setDraft(null);
    setExternalPrompt("");
    setPlannedUse("");
    setInputIssues([]);
    setReviewName("");
    setReviewDescription("");
    setBodyApproved(false);
    setAdditionsApproved(false);
    setNameConflict(false);
    setContractError(null);
  }

  function continueDraft() {
    if (!draft) {
      resetForNewDraft();
      setPhase("editing");
      return;
    }
    hydrateDraftFields(draft);
    switch (draft.status) {
      case "ready_for_review":
        setPhase("review");
        break;
      case "failed":
        setPhase("failed");
        break;
      case "generating":
        setPhase("generating");
        break;
      case "editing_input":
        setPhase("editing");
        break;
    }
  }

  async function discardDraft() {
    await refinementService.discardDraft();
    resetForNewDraft();
    setPhase("editing");
  }

  function updateExternalPrompt(value: string) {
    setExternalPrompt(value);
    updatePersistedInput(value, plannedUse);
  }

  function updatePlannedUse(value: string) {
    setPlannedUse(value);
    updatePersistedInput(externalPrompt, value);
  }

  function updatePersistedInput(nextExternalPrompt: string, nextPlannedUse: string) {
    setInputIssues([]);
    setFeedback(null);
    if (draft) {
      setPhase("editing");
      void refinementService
        .updateInput({
          externalPrompt: nextExternalPrompt,
          plannedUse: nextPlannedUse,
        })
        .then(setDraft)
        .catch((error) => {
          setFeedback({
            tone: "failure",
            message: error instanceof Error ? error.message : String(error),
          });
        });
    }
  }

  async function generateProposal() {
    const issues = validateTemplateRefinementInput({
      externalPrompt,
      plannedUse,
    });
    setInputIssues(issues);
    if (issues.length > 0) {
      setPhase("editing");
      return;
    }

    const lock = modelCallLock.beginModelCall("templateRefinement");
    if (lock.status === "blocked") {
      setFeedback({
        tone: "failure",
        message: `已有${getModelCallStatusLabel(lock.activeCall.type)}。`,
      });
      return;
    }

    setPhase("generating");
    setFeedback({
      tone: "notice",
      message: "模板提炼进行中。",
    });

    try {
      const result = await refinementService.generate({
        externalPrompt,
        plannedUse,
      });

      if (result.status === "invalid_input") {
        setInputIssues(result.issues);
        setPhase("editing");
        setFeedback(null);
        return;
      }

      setDraft(result.draft);
      if (result.status === "failed") {
        hydrateDraftFields(result.draft);
        setPhase("failed");
        setFeedback(null);
        return;
      }

      hydrateDraftFields(result.draft);
      setPhase("review");
      setFeedback({
        tone: "success",
        message: "提炼方案已生成。",
      });
    } catch (error) {
      setPhase("failed");
      setFeedback({
        tone: "failure",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      modelCallLock.endModelCall(lock.call.id);
    }
  }

  function updateReviewName(value: string) {
    setReviewName(value);
    resetApprovals();
    void persistReviewMetadata(value, reviewDescription);
  }

  function updateReviewDescription(value: string) {
    setReviewDescription(value);
    resetApprovals();
    void persistReviewMetadata(reviewName, value);
  }

  function resetApprovals() {
    setBodyApproved(false);
    setAdditionsApproved(false);
  }

  async function persistReviewMetadata(name: string, description: string) {
    const result = await refinementService.updateReviewTemplateMetadata({
      name,
      description,
    });
    if (result.status === "updated") {
      setDraft(result.draft);
    }
  }

  async function confirmWrite() {
    if (!canWrite) {
      return;
    }

    setIsWriting(true);
    setFeedback(null);
    try {
      const result = await refinementService.confirmWrite();
      if (result.status === "succeeded") {
        router.replace(
          `/promptdex/${encodeURIComponent(result.entry.name)}` as never,
        );
        return;
      }
      if (result.status === "duplicate_name") {
        setDraft(result.draft);
        setNameConflict(true);
        setFeedback({
          tone: "failure",
          message: "图鉴条目名称已存在，请修改名称后再写入。",
        });
        return;
      }
      if (result.status === "promptdex_contract_invalid") {
        setDraft(result.draft);
        setContractError(result.message);
        setFeedback({
          tone: "failure",
          message: result.message,
        });
        return;
      }
      setFeedback({
        tone: "failure",
        message: "提炼方案尚未准备好。",
      });
    } finally {
      setIsWriting(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.content} style={styles.screen}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.back()}
          style={styles.iconButton}
        >
          <Ionicons color="#0F172A" name="chevron-back" size={22} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title}>模板提炼</Text>
          <Text style={styles.subtitle}>从外部完整提示词写入个人图鉴条目</Text>
        </View>
      </View>

      {phase === "loading" ? (
        <StateBox icon="hourglass-outline" text="正在读取提炼草稿。" />
      ) : null}

      {phase === "resume_choice" && draft ? (
        <ResumeDraftPanel draft={draft} onContinue={continueDraft} onDiscard={discardDraft} />
      ) : null}

      {phase === "editing" || phase === "failed" ? (
        <>
          {phase === "failed" && draft?.errorSummary ? (
            <FailureBox
              message={formatTemplateRefinementErrorSummary(draft.errorSummary)}
            />
          ) : null}
          <InputForm
            externalPrompt={externalPrompt}
            inputIssues={inputIssues}
            onExternalPromptChange={updateExternalPrompt}
            onGenerate={generateProposal}
            onPlannedUseChange={updatePlannedUse}
            plannedUse={plannedUse}
            submitting={modelCallLock.activeCall?.type === "templateRefinement"}
          />
        </>
      ) : null}

      {phase === "generating" ? (
        <StateBox icon="hourglass-outline" text="模板提炼进行中。" />
      ) : null}

      {phase === "review" && reviewProposal ? (
        <ReviewPanel
          additionsApproved={additionsApproved}
          bodyApproved={bodyApproved}
          canWrite={canWrite}
          contractError={contractError}
          description={reviewDescription}
          isCheckingName={isCheckingName}
          isWriting={isWriting}
          name={reviewName}
          nameConflict={nameConflict}
          onAdditionsApprovedChange={setAdditionsApproved}
          onBodyApprovedChange={setBodyApproved}
          onConfirmWrite={confirmWrite}
          onDescriptionChange={updateReviewDescription}
          onNameChange={updateReviewName}
          onRegenerate={() => setPhase("editing")}
          proposal={reviewProposal}
        />
      ) : null}

      {feedback ? <FeedbackBox feedback={feedback} /> : null}
    </ScrollView>
  );
}

function InputForm({
  externalPrompt,
  inputIssues,
  onExternalPromptChange,
  onGenerate,
  onPlannedUseChange,
  plannedUse,
  submitting,
}: {
  externalPrompt: string;
  inputIssues: TemplateRefinementInputValidationIssue[];
  onExternalPromptChange: (value: string) => void;
  onGenerate: () => void;
  onPlannedUseChange: (value: string) => void;
  plannedUse: string;
  submitting: boolean;
}) {
  const issuesByField = groupIssuesByField(inputIssues);
  const hasIssues = inputIssues.length > 0;
  return (
    <>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>外部完整提示词</Text>
        <TextInput
          multiline
          onChangeText={onExternalPromptChange}
          placeholder="粘贴完整提示词"
          placeholderTextColor="#94A3B8"
          style={[styles.textArea, styles.largeTextArea]}
          textAlignVertical="top"
          value={externalPrompt}
        />
        <FieldMeta
          count={externalPrompt.trim().length}
          issues={issuesByField.externalPrompt}
          max={20_000}
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>计划用途</Text>
        <TextInput
          multiline
          onChangeText={onPlannedUseChange}
          placeholder="说明这个模板未来要服务的任务"
          placeholderTextColor="#94A3B8"
          style={styles.textArea}
          textAlignVertical="top"
          value={plannedUse}
        />
        <FieldMeta
          count={plannedUse.trim().length}
          issues={issuesByField.plannedUse}
          max={1_000}
        />
      </View>

      <Pressable
        accessibilityRole="button"
        disabled={submitting}
        onPress={onGenerate}
        style={({ pressed }) => [
          styles.primaryButton,
          submitting && styles.disabledButton,
          pressed && !submitting && styles.pressed,
        ]}
      >
        {submitting ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Ionicons color="#FFFFFF" name="sparkles-outline" size={18} />
        )}
        <Text style={styles.primaryButtonText}>
          {submitting ? "生成中" : hasIssues ? "重新检查并生成" : "生成提炼方案"}
        </Text>
      </Pressable>
    </>
  );
}

function ReviewPanel({
  additionsApproved,
  bodyApproved,
  canWrite,
  contractError,
  description,
  isCheckingName,
  isWriting,
  name,
  nameConflict,
  onAdditionsApprovedChange,
  onBodyApprovedChange,
  onConfirmWrite,
  onDescriptionChange,
  onNameChange,
  onRegenerate,
  proposal,
}: {
  additionsApproved: boolean;
  bodyApproved: boolean;
  canWrite: boolean;
  contractError: string | null;
  description: string;
  isCheckingName: boolean;
  isWriting: boolean;
  name: string;
  nameConflict: boolean;
  onAdditionsApprovedChange: (value: boolean) => void;
  onBodyApprovedChange: (value: boolean) => void;
  onConfirmWrite: () => void;
  onDescriptionChange: (value: string) => void;
  onNameChange: (value: string) => void;
  onRegenerate: () => void;
  proposal: TemplateRefinementProposal;
}) {
  return (
    <>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>写入信息</Text>
        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>name</Text>
          <TextInput
            autoCapitalize="none"
            onChangeText={onNameChange}
            placeholder="refined-template"
            placeholderTextColor="#94A3B8"
            style={styles.singleLineInput}
            value={name}
          />
        </View>
        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>description</Text>
          <TextInput
            multiline
            onChangeText={onDescriptionChange}
            placeholder="条目说明"
            placeholderTextColor="#94A3B8"
            style={styles.textArea}
            textAlignVertical="top"
            value={description}
          />
        </View>
        {isCheckingName ? (
          <Text style={styles.fieldMetaText}>正在检查名称。</Text>
        ) : null}
        {nameConflict ? <FailureBox message="图鉴条目名称已存在。" /> : null}
        {contractError ? <FailureBox message={contractError} /> : null}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>方案摘要</Text>
        <Text selectable style={styles.bodyText}>
          {proposal.taskTypeRationale}
        </Text>
        <SummaryList title="保留规则" values={proposal.retainedRules} />
        <RemovedRulesList values={proposal.removedRules} />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>提炼补充</Text>
        {proposal.additions.length === 0 ? (
          <Text style={styles.bodyText}>无</Text>
        ) : (
          proposal.additions.map((addition, index) => (
            <View key={`${addition.summary}-${index}`} style={styles.listItem}>
              <Text selectable style={styles.listItemTitle}>
                {addition.summary}
              </Text>
              <Text selectable style={styles.bodyText}>
                {addition.reason}
              </Text>
              <Text selectable style={styles.bodyText}>
                {addition.impactIfRejected}
              </Text>
            </View>
          ))
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>输入声明</Text>
        {Object.entries(proposal.template.inputs).map(([inputName, input]) => (
          <View key={inputName} style={styles.inputDeclarationRow}>
            <View style={styles.inputDeclarationHeader}>
              <Text selectable style={styles.inputName}>
                {inputName}
              </Text>
              <Text style={styles.inputRequirement}>
                {input.required ? "必需" : "可选"}
              </Text>
            </View>
            <Text selectable style={styles.bodyText}>
              {input.description}
            </Text>
          </View>
        ))}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>完整正文</Text>
        <View style={styles.bodyBox}>
          <Text selectable style={styles.markdownText}>
            {proposal.template.body}
          </Text>
        </View>
      </View>

      <View style={styles.section}>
        <ApprovalRow
          checked={bodyApproved}
          label="我已检查将写入的完整正文和输入声明。"
          onChange={onBodyApprovedChange}
        />
        {proposal.additions.length > 0 ? (
          <ApprovalRow
            checked={additionsApproved}
            label="我批准以上提炼补充写入图鉴条目。"
            onChange={onAdditionsApprovedChange}
          />
        ) : null}
      </View>

      <View style={styles.actionRow}>
        <Pressable
          accessibilityRole="button"
          disabled={isWriting}
          onPress={onRegenerate}
          style={({ pressed }) => [
            styles.secondaryButton,
            isWriting && styles.disabledSecondaryButton,
            pressed && !isWriting && styles.pressed,
          ]}
        >
          <Ionicons color="#0F766E" name="refresh-outline" size={18} />
          <Text style={styles.secondaryButtonText}>重新生成</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={!canWrite}
          onPress={onConfirmWrite}
          style={({ pressed }) => [
            styles.primaryButton,
            !canWrite && styles.disabledButton,
            pressed && canWrite && styles.pressed,
          ]}
        >
          {isWriting ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Ionicons color="#FFFFFF" name="checkmark-outline" size={18} />
          )}
          <Text style={styles.primaryButtonText}>写入个人图鉴</Text>
        </Pressable>
      </View>
    </>
  );
}

function ResumeDraftPanel({
  draft,
  onContinue,
  onDiscard,
}: {
  draft: TemplateRefinementDraft;
  onContinue: () => void;
  onDiscard: () => void;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>未完成草稿</Text>
      <Text style={styles.bodyText}>{getDraftStatusLabel(draft.status)}</Text>
      <View style={styles.actionRow}>
        <Pressable
          accessibilityRole="button"
          onPress={onDiscard}
          style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
        >
          <Ionicons color="#B91C1C" name="trash-outline" size={18} />
          <Text style={[styles.secondaryButtonText, styles.dangerText]}>
            丢弃
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={onContinue}
          style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
        >
          <Ionicons color="#FFFFFF" name="arrow-forward-outline" size={18} />
          <Text style={styles.primaryButtonText}>继续</Text>
        </Pressable>
      </View>
    </View>
  );
}

function ApprovalRow({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (value: boolean) => void;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      onPress={() => onChange(!checked)}
      style={({ pressed }) => [styles.approvalRow, pressed && styles.pressed]}
    >
      <Ionicons
        color={checked ? "#0F766E" : "#64748B"}
        name={checked ? "checkbox-outline" : "square-outline"}
        size={22}
      />
      <Text style={styles.approvalText}>{label}</Text>
    </Pressable>
  );
}

function FieldMeta({
  count,
  issues,
  max,
}: {
  count: number;
  issues: TemplateRefinementInputValidationIssue[];
  max: number;
}) {
  return (
    <View style={styles.fieldMeta}>
      <Text style={styles.fieldMetaText}>
        {count}/{max}
      </Text>
      {issues.map((issue) => (
        <Text key={`${issue.field}-${issue.code}`} style={styles.fieldIssueText}>
          {issue.message}
        </Text>
      ))}
    </View>
  );
}

function SummaryList({ title, values }: { title: string; values: string[] }) {
  return (
    <View style={styles.summaryBlock}>
      <Text style={styles.inputLabel}>{title}</Text>
      {values.length === 0 ? (
        <Text style={styles.bodyText}>无</Text>
      ) : (
        values.map((value, index) => (
          <Text key={`${value}-${index}`} selectable style={styles.bodyText}>
            {value}
          </Text>
        ))
      )}
    </View>
  );
}

function RemovedRulesList({
  values,
}: {
  values: TemplateRefinementProposal["removedRules"];
}) {
  return (
    <View style={styles.summaryBlock}>
      <Text style={styles.inputLabel}>删除规则</Text>
      {values.length === 0 ? (
        <Text style={styles.bodyText}>无</Text>
      ) : (
        values.map((value, index) => (
          <View key={`${value.summary}-${index}`} style={styles.listItem}>
            <Text selectable style={styles.listItemTitle}>
              {value.summary}
            </Text>
            <Text selectable style={styles.bodyText}>
              {value.reason}
            </Text>
          </View>
        ))
      )}
    </View>
  );
}

function FeedbackBox({ feedback }: { feedback: NonNullable<Feedback> }) {
  if (feedback.tone === "failure") {
    return <FailureBox message={feedback.message} />;
  }
  return (
    <View style={styles.noticeBox}>
      <Ionicons
        color="#0F766E"
        name={feedback.tone === "success" ? "checkmark-circle-outline" : "information-circle-outline"}
        size={20}
      />
      <Text style={styles.noticeText}>{feedback.message}</Text>
    </View>
  );
}

function FailureBox({ message }: { message: string }) {
  return (
    <View style={styles.failureBox}>
      <Ionicons color="#B91C1C" name="alert-circle-outline" size={20} />
      <Text selectable style={styles.failureText}>
        {message}
      </Text>
    </View>
  );
}

function StateBox({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  return (
    <View style={styles.stateBox}>
      <Ionicons color="#0F766E" name={icon} size={24} />
      <Text style={styles.stateText}>{text}</Text>
    </View>
  );
}

function groupIssuesByField(issues: TemplateRefinementInputValidationIssue[]) {
  return {
    externalPrompt: issues.filter((issue) => issue.field === "externalPrompt"),
    plannedUse: issues.filter((issue) => issue.field === "plannedUse"),
  };
}

function withReviewMetadata(
  proposal: TemplateRefinementProposal,
  name: string,
  description: string,
): TemplateRefinementProposal {
  return {
    ...proposal,
    template: {
      ...proposal.template,
      name,
      description,
    },
  };
}

function getDraftStatusLabel(status: TemplateRefinementDraft["status"]): string {
  switch (status) {
    case "editing_input":
      return "草稿停留在输入编辑状态。";
    case "generating":
      return "草稿显示模板提炼进行中。";
    case "ready_for_review":
      return "已有提炼方案等待审阅确认。";
    case "failed":
      return "上次提炼失败，可继续处理。";
  }
}

function formatTemplateRefinementErrorSummary(
  summary: TemplateRefinementErrorSummary,
): string {
  const suffix = summary.statusCode ? `（HTTP ${summary.statusCode}）` : "";
  switch (summary.reason) {
    case "missing_text_model_configuration":
      return "缺少就绪的默认文本模型配置。";
    case "missing_credential":
      return "默认文本模型配置缺少 API Key。";
    case "offline":
      return "当前设备离线，不能发起模板提炼。";
    case "unauthorized":
      return `API Key 未通过认证，请检查凭据。${suffix}`;
    case "rate_limited":
      return `模型服务请求受到限流，请稍后重试。${suffix}`;
    case "server_error":
      return `模型服务暂时不可用，请稍后重试。${suffix}`;
    case "network_error":
      return "无法连接模型服务，请检查网络或 base URL。";
    case "invalid_response":
      return "模型服务没有返回有效的提炼方案 JSON。";
    case "promptdex_contract_invalid":
      return "提炼方案不符合 Promptdex 图鉴条目契约。";
    case "unknown":
      return "模板提炼失败，请稍后重试或检查模型配置。";
  }
}

const styles = StyleSheet.create({
  actionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  approvalRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    minHeight: 44,
  },
  approvalText: {
    color: "#0F172A",
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  bodyBox: {
    backgroundColor: "#F8FAFC",
    borderColor: "#E2E8F0",
    borderRadius: 8,
    borderWidth: 1,
    padding: 12,
  },
  bodyText: {
    color: "#475569",
    fontSize: 14,
    lineHeight: 21,
  },
  content: {
    gap: 16,
    padding: 20,
    paddingBottom: 36,
  },
  dangerText: {
    color: "#B91C1C",
  },
  disabledButton: {
    backgroundColor: "#94A3B8",
  },
  disabledSecondaryButton: {
    opacity: 0.55,
  },
  failureBox: {
    alignItems: "flex-start",
    backgroundColor: "#FEF2F2",
    borderColor: "#FECACA",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    padding: 14,
  },
  failureText: {
    color: "#991B1B",
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  fieldIssueText: {
    color: "#B91C1C",
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    textAlign: "right",
  },
  fieldMeta: {
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between",
  },
  fieldMetaText: {
    color: "#64748B",
    fontSize: 13,
    lineHeight: 18,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    paddingTop: 8,
  },
  headerText: {
    flex: 1,
    gap: 4,
  },
  iconButton: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderColor: "#E2E8F0",
    borderRadius: 8,
    borderWidth: 1,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  inputDeclarationHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  inputDeclarationRow: {
    gap: 6,
  },
  inputGroup: {
    gap: 8,
  },
  inputLabel: {
    color: "#0F172A",
    fontSize: 14,
    fontWeight: "800",
  },
  inputName: {
    color: "#0F172A",
    flex: 1,
    fontSize: 15,
    fontWeight: "800",
  },
  inputRequirement: {
    backgroundColor: "#F1F5F9",
    borderRadius: 8,
    color: "#475569",
    fontSize: 12,
    fontWeight: "800",
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  largeTextArea: {
    minHeight: 220,
  },
  listItem: {
    gap: 6,
  },
  listItemTitle: {
    color: "#0F172A",
    fontSize: 14,
    fontWeight: "800",
    lineHeight: 20,
  },
  markdownText: {
    color: "#0F172A",
    fontFamily: "Courier",
    fontSize: 13,
    lineHeight: 20,
  },
  noticeBox: {
    alignItems: "flex-start",
    backgroundColor: "#ECFDF5",
    borderColor: "#A7F3D0",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    padding: 14,
  },
  noticeText: {
    color: "#047857",
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  pressed: {
    opacity: 0.72,
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: "#0F766E",
    borderRadius: 8,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: 16,
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "800",
  },
  screen: {
    backgroundColor: "#F8FAFC",
    flex: 1,
  },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderColor: "#CBD5E1",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: 16,
  },
  secondaryButtonText: {
    color: "#0F766E",
    fontSize: 15,
    fontWeight: "800",
  },
  section: {
    backgroundColor: "#FFFFFF",
    borderColor: "#E2E8F0",
    borderRadius: 8,
    borderWidth: 1,
    gap: 12,
    padding: 16,
  },
  sectionTitle: {
    color: "#0F172A",
    fontSize: 18,
    fontWeight: "800",
  },
  singleLineInput: {
    backgroundColor: "#F8FAFC",
    borderColor: "#CBD5E1",
    borderRadius: 8,
    borderWidth: 1,
    color: "#0F172A",
    fontSize: 15,
    minHeight: 46,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  stateBox: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderColor: "#E2E8F0",
    borderRadius: 8,
    borderWidth: 1,
    gap: 10,
    padding: 18,
  },
  stateText: {
    color: "#475569",
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
  subtitle: {
    color: "#64748B",
    fontSize: 14,
    lineHeight: 20,
  },
  summaryBlock: {
    gap: 8,
  },
  textArea: {
    backgroundColor: "#F8FAFC",
    borderColor: "#CBD5E1",
    borderRadius: 8,
    borderWidth: 1,
    color: "#0F172A",
    fontSize: 15,
    lineHeight: 21,
    minHeight: 110,
    padding: 12,
  },
  title: {
    color: "#0F172A",
    fontSize: 28,
    fontWeight: "800",
  },
});
