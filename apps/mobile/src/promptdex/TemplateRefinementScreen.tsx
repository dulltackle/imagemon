import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator } from "react-native";

import {
  usePromptdexCatalogService,
  useTemplateRefinementDraftRepository,
  useTemplateRefinementService,
} from "../app-state";
import { getModelCallStatusLabel, useModelCallLock } from "../model-calls";
import {
  buildPromptdexTemplateFromRefinementProposal,
  validateTemplateRefinementInput,
  type TemplateRefinementDraft,
  type TemplateRefinementErrorSummary,
  type TemplateRefinementInputValidationIssue,
  type TemplateRefinementProposal,
} from "./index";
import {
  cn,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  type SFSymbolName,
  SymbolIcon,
  Text,
  TextInput,
  useCSSVariable,
  View,
} from "../tw";

type ScreenPhase =
  "loading" | "resume_choice" | "editing" | "generating" | "failed" | "review";

type Feedback = {
  tone: "success" | "failure" | "notice";
  message: string;
} | null;

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
  const updateInputRequestId = useRef(0);

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
    const timer = setTimeout(() => {
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
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
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
    try {
      await refinementService.discardDraft();
      resetForNewDraft();
      setPhase("editing");
    } catch (error) {
      setFeedback({
        tone: "failure",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  function updateExternalPrompt(value: string) {
    setExternalPrompt(value);
    updatePersistedInput(value, plannedUse);
  }

  function updatePlannedUse(value: string) {
    setPlannedUse(value);
    updatePersistedInput(externalPrompt, value);
  }

  function updatePersistedInput(
    nextExternalPrompt: string,
    nextPlannedUse: string,
  ) {
    setInputIssues([]);
    setFeedback(null);
    if (draft) {
      setPhase("editing");
      const requestId = ++updateInputRequestId.current;
      void refinementService
        .updateInput({
          externalPrompt: nextExternalPrompt,
          plannedUse: nextPlannedUse,
        })
        .then((updatedDraft) => {
          if (requestId === updateInputRequestId.current) {
            setDraft(updatedDraft);
          }
        })
        .catch((error) => {
          if (requestId === updateInputRequestId.current) {
            setFeedback({
              tone: "failure",
              message: error instanceof Error ? error.message : String(error),
            });
          }
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
    try {
      const result = await refinementService.updateReviewTemplateMetadata({
        name,
        description,
      });
      if (result.status === "updated") {
        setDraft(result.draft);
      }
    } catch (error) {
      setFeedback({
        tone: "failure",
        message: error instanceof Error ? error.message : String(error),
      });
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
    } catch (error) {
      setFeedback({
        tone: "failure",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsWriting(false);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={process.env.EXPO_OS === "ios" ? "padding" : undefined}
      className="flex-1 bg-sf-bg-2"
    >
      <ScrollView
        className="flex-1 bg-sf-bg-2"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerClassName="gap-4 p-5 pb-9"
        keyboardDismissMode={
          process.env.EXPO_OS === "ios" ? "interactive" : "none"
        }
        keyboardShouldPersistTaps="handled"
      >
        {phase === "loading" ? (
          <StateBox icon="hourglass" text="正在读取提炼草稿。" />
        ) : null}

        {phase === "resume_choice" && draft ? (
          <ResumeDraftPanel
            draft={draft}
            onContinue={continueDraft}
            onDiscard={discardDraft}
          />
        ) : null}

        {phase === "editing" || phase === "failed" ? (
          <>
            {phase === "failed" && draft?.errorSummary ? (
              <FailureBox
                message={formatTemplateRefinementErrorSummary(
                  draft.errorSummary,
                )}
              />
            ) : null}
            <InputForm
              externalPrompt={externalPrompt}
              inputIssues={inputIssues}
              onExternalPromptChange={updateExternalPrompt}
              onGenerate={generateProposal}
              onPlannedUseChange={updatePlannedUse}
              plannedUse={plannedUse}
              submitting={
                modelCallLock.activeCall?.type === "templateRefinement"
              }
            />
          </>
        ) : null}

        {phase === "generating" ? (
          <StateBox icon="hourglass" text="模板提炼进行中。" />
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
            onRegenerate={() => {
              setNameConflict(false);
              setContractError(null);
              setPhase("editing");
            }}
            proposal={reviewProposal}
          />
        ) : null}

        {feedback ? <FeedbackBox feedback={feedback} /> : null}
      </ScrollView>
    </KeyboardAvoidingView>
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
  const placeholderColor = useCSSVariable("--sf-text-3");
  return (
    <>
      <View className="gap-3 rounded-lg border border-sf-separator bg-sf-bg-3 p-4">
        <SectionTitle>外部完整提示词</SectionTitle>
        <TextInput
          className="min-h-[220px] rounded-lg border border-sf-separator bg-sf-bg p-3 text-[15px] leading-[21px] text-sf-text"
          multiline
          onChangeText={onExternalPromptChange}
          placeholder="粘贴完整提示词"
          placeholderTextColor={placeholderColor}
          textAlignVertical="top"
          value={externalPrompt}
        />
        <FieldMeta
          count={externalPrompt.trim().length}
          issues={issuesByField.externalPrompt}
          max={20_000}
        />
      </View>

      <View className="gap-3 rounded-lg border border-sf-separator bg-sf-bg-3 p-4">
        <SectionTitle>计划用途</SectionTitle>
        <TextInput
          className="min-h-[110px] rounded-lg border border-sf-separator bg-sf-bg p-3 text-[15px] leading-[21px] text-sf-text"
          multiline
          onChangeText={onPlannedUseChange}
          placeholder="说明这个模板未来要服务的任务"
          placeholderTextColor={placeholderColor}
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
        className={cn(
          "min-h-12 flex-row items-center justify-center gap-2 rounded-lg bg-sf-blue px-4 active:opacity-75",
          submitting && "bg-sf-text-3",
        )}
      >
        {submitting ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <SymbolIcon
            className="h-[18px] w-[18px]"
            name="sparkles"
            tintColor="#FFFFFF"
          />
        )}
        <Text className="text-[15px] font-extrabold leading-[21px] text-white">
          {submitting
            ? "生成中"
            : hasIssues
              ? "重新检查并生成"
              : "生成提炼方案"}
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
  const accentColor = useCSSVariable("--sf-blue");
  const placeholderColor = useCSSVariable("--sf-text-3");

  return (
    <>
      <View className="gap-3 rounded-lg border border-sf-separator bg-sf-bg-3 p-4">
        <SectionTitle>写入信息</SectionTitle>
        <View className="gap-2">
          <InputLabel>name</InputLabel>
          <TextInput
            className="min-h-[46px] rounded-lg border border-sf-separator bg-sf-bg px-3 py-2.5 text-[15px] leading-[21px] text-sf-text"
            autoCapitalize="none"
            onChangeText={onNameChange}
            placeholder="refined-template"
            placeholderTextColor={placeholderColor}
            value={name}
          />
        </View>
        <View className="gap-2">
          <InputLabel>description</InputLabel>
          <TextInput
            className="min-h-[110px] rounded-lg border border-sf-separator bg-sf-bg p-3 text-[15px] leading-[21px] text-sf-text"
            multiline
            onChangeText={onDescriptionChange}
            placeholder="条目说明"
            placeholderTextColor={placeholderColor}
            textAlignVertical="top"
            value={description}
          />
        </View>
        {isCheckingName ? (
          <Text
            className="text-[13px] leading-[18px] text-sf-text-2"
            selectable
          >
            正在检查名称。
          </Text>
        ) : null}
        {nameConflict ? <FailureBox message="图鉴条目名称已存在。" /> : null}
        {contractError ? <FailureBox message={contractError} /> : null}
      </View>

      <View className="gap-3 rounded-lg border border-sf-separator bg-sf-bg-3 p-4">
        <SectionTitle>方案摘要</SectionTitle>
        <BodyText>{proposal.taskTypeRationale}</BodyText>
        <SummaryList title="保留规则" values={proposal.retainedRules} />
        <RemovedRulesList values={proposal.removedRules} />
      </View>

      <View className="gap-3 rounded-lg border border-sf-separator bg-sf-bg-3 p-4">
        <SectionTitle>提炼补充</SectionTitle>
        {proposal.additions.length === 0 ? (
          <BodyText>无</BodyText>
        ) : (
          proposal.additions.map((addition, index) => (
            <View className="gap-1.5" key={`${addition.summary}-${index}`}>
              <Text
                className="text-sm font-extrabold leading-5 text-sf-text"
                selectable
              >
                {addition.summary}
              </Text>
              <BodyText>{addition.reason}</BodyText>
              <BodyText>{addition.impactIfRejected}</BodyText>
            </View>
          ))
        )}
      </View>

      <View className="gap-3 rounded-lg border border-sf-separator bg-sf-bg-3 p-4">
        <SectionTitle>输入声明</SectionTitle>
        {Object.entries(proposal.template.inputs).map(([inputName, input]) => (
          <View className="gap-1.5" key={inputName}>
            <View className="flex-row items-center gap-2">
              <Text
                className="flex-1 text-[15px] font-extrabold leading-[21px] text-sf-text"
                selectable
              >
                {inputName}
              </Text>
              <RequiredBadge required={input.required} />
            </View>
            <BodyText>{input.description}</BodyText>
          </View>
        ))}
      </View>

      <View className="gap-3 rounded-lg border border-sf-separator bg-sf-bg-3 p-4">
        <SectionTitle>完整正文</SectionTitle>
        <View className="rounded-lg border border-sf-separator bg-sf-bg p-3">
          <Text
            className="font-mono text-[13px] leading-5 text-sf-text"
            selectable
          >
            {proposal.template.body}
          </Text>
        </View>
      </View>

      <View className="gap-3 rounded-lg border border-sf-separator bg-sf-bg-3 p-4">
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

      <View className="flex-row flex-wrap gap-3">
        <Pressable
          accessibilityRole="button"
          disabled={isWriting}
          onPress={onRegenerate}
          className={cn(
            "min-h-12 flex-row items-center justify-center gap-2 rounded-lg border border-sf-separator bg-sf-bg-3 px-4 active:opacity-75",
            isWriting && "opacity-55",
          )}
        >
          <SymbolIcon
            className="h-[18px] w-[18px]"
            name="arrow.clockwise"
            tintColor={accentColor}
          />
          <Text className="text-[15px] font-extrabold leading-[21px] text-sf-blue">
            重新生成
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={!canWrite}
          onPress={onConfirmWrite}
          className={cn(
            "min-h-12 flex-row items-center justify-center gap-2 rounded-lg bg-sf-blue px-4 active:opacity-75",
            !canWrite && "bg-sf-text-3",
          )}
        >
          {isWriting ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <SymbolIcon
              className="h-[18px] w-[18px]"
              name="checkmark"
              tintColor="#FFFFFF"
            />
          )}
          <Text className="text-[15px] font-extrabold leading-[21px] text-white">
            写入个人图鉴
          </Text>
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
  const dangerColor = useCSSVariable("--sf-red");
  return (
    <View className="gap-3 rounded-lg border border-sf-separator bg-sf-bg-3 p-4">
      <SectionTitle>未完成草稿</SectionTitle>
      <BodyText>{getDraftStatusLabel(draft.status)}</BodyText>
      <View className="flex-row flex-wrap gap-3">
        <Pressable
          accessibilityRole="button"
          onPress={onDiscard}
          className="min-h-12 flex-row items-center justify-center gap-2 rounded-lg border border-sf-separator bg-sf-bg-3 px-4 active:opacity-75"
        >
          <SymbolIcon
            className="h-[18px] w-[18px]"
            name="trash"
            tintColor={dangerColor}
          />
          <Text className="text-[15px] font-extrabold leading-[21px] text-sf-red">
            丢弃
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={onContinue}
          className="min-h-12 flex-row items-center justify-center gap-2 rounded-lg bg-sf-blue px-4 active:opacity-75"
        >
          <SymbolIcon
            className="h-[18px] w-[18px]"
            name="arrow.right"
            tintColor="#FFFFFF"
          />
          <Text className="text-[15px] font-extrabold leading-[21px] text-white">
            继续
          </Text>
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
  const accentColor = useCSSVariable("--sf-blue");
  const mutedColor = useCSSVariable("--sf-text-2");

  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      onPress={() => onChange(!checked)}
      className="min-h-11 flex-row items-center gap-2.5 active:opacity-75"
    >
      <SymbolIcon
        className="h-[22px] w-[22px]"
        name={checked ? "checkmark.square" : "square"}
        tintColor={checked ? accentColor : mutedColor}
      />
      <Text className="flex-1 text-sm leading-5 text-sf-text" selectable>
        {label}
      </Text>
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
    <View className="flex-row justify-between gap-2.5">
      <Text className="text-[13px] leading-[18px] text-sf-text-2" selectable>
        {count}/{max}
      </Text>
      {issues.map((issue) => (
        <Text
          className="flex-1 text-right text-[13px] leading-[18px] text-sf-red"
          key={`${issue.field}-${issue.code}`}
          selectable
        >
          {issue.message}
        </Text>
      ))}
    </View>
  );
}

function SummaryList({ title, values }: { title: string; values: string[] }) {
  return (
    <View className="gap-2">
      <InputLabel>{title}</InputLabel>
      {values.length === 0 ? (
        <BodyText>无</BodyText>
      ) : (
        values.map((value, index) => (
          <BodyText key={`${value}-${index}`}>{value}</BodyText>
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
    <View className="gap-2">
      <InputLabel>删除规则</InputLabel>
      {values.length === 0 ? (
        <BodyText>无</BodyText>
      ) : (
        values.map((value, index) => (
          <View className="gap-1.5" key={`${value.summary}-${index}`}>
            <Text
              className="text-sm font-extrabold leading-5 text-sf-text"
              selectable
            >
              {value.summary}
            </Text>
            <BodyText>{value.reason}</BodyText>
          </View>
        ))
      )}
    </View>
  );
}

function FeedbackBox({ feedback }: { feedback: NonNullable<Feedback> }) {
  const accentColor = useCSSVariable("--sf-green");
  if (feedback.tone === "failure") {
    return <FailureBox message={feedback.message} />;
  }
  return (
    <View className="flex-row items-start gap-2.5 rounded-lg border border-sf-green bg-sf-bg-3 p-3.5">
      <SymbolIcon
        className="h-5 w-5"
        name={feedback.tone === "success" ? "checkmark.circle" : "info.circle"}
        tintColor={accentColor}
      />
      <Text className="flex-1 text-sm leading-5 text-sf-text" selectable>
        {feedback.message}
      </Text>
    </View>
  );
}

function FailureBox({ message }: { message: string }) {
  const dangerColor = useCSSVariable("--sf-red");
  return (
    <View className="flex-row items-start gap-2.5 rounded-lg border border-sf-red bg-sf-bg-3 p-3.5">
      <SymbolIcon
        className="h-5 w-5"
        name="exclamationmark.triangle"
        tintColor={dangerColor}
      />
      <Text className="flex-1 text-sm leading-5 text-sf-text" selectable>
        {message}
      </Text>
    </View>
  );
}

function StateBox({ icon, text }: { icon: SFSymbolName; text: string }) {
  const accentColor = useCSSVariable("--sf-blue");
  return (
    <View className="items-center gap-2.5 rounded-lg border border-sf-separator bg-sf-bg-3 p-[18px]">
      <SymbolIcon className="h-6 w-6" name={icon} tintColor={accentColor} />
      <Text className="text-center text-sm leading-5 text-sf-text-2" selectable>
        {text}
      </Text>
    </View>
  );
}

function SectionTitle({ children }: { children: string }) {
  return (
    <Text className="text-lg font-extrabold leading-6 text-sf-text" selectable>
      {children}
    </Text>
  );
}

function InputLabel({ children }: { children: string }) {
  return (
    <Text className="text-sm font-extrabold leading-5 text-sf-text" selectable>
      {children}
    </Text>
  );
}

function RequiredBadge({ required }: { required: boolean }) {
  return (
    <View className="min-h-[22px] shrink-0 items-center justify-center rounded-lg bg-sf-fill px-2">
      <Text
        className="text-xs font-extrabold leading-4 text-sf-text-2"
        selectable
      >
        {required ? "必需" : "可选"}
      </Text>
    </View>
  );
}

function BodyText({ children }: { children: string }) {
  return (
    <Text className="text-sm leading-[21px] text-sf-text-2" selectable>
      {children}
    </Text>
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

function getDraftStatusLabel(
  status: TemplateRefinementDraft["status"],
): string {
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
      return `模型服务没有返回有效的提炼方案 JSON。${suffix}`;
    case "promptdex_contract_invalid":
      return "提炼方案不符合 Promptdex 图鉴条目契约。";
    case "unknown":
      return "模板提炼失败，请稍后重试或检查模型配置。";
  }
}
