import * as Clipboard from "expo-clipboard";
import { useFocusEffect, useIsFocused } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  usePromptdexCatalogService,
  useReadyAppRuntime,
  useTemplateRefinementDraftRepository,
  useTemplateRefinementService,
} from "../app-state";
import {
  shouldClearTemplateRefinementAttention,
  useBusinessCallAttentionSnapshot,
} from "../business-call-attentions";
import {
  type ActiveModelCall,
  TEMPLATE_REFINEMENT_MODEL_CALL_OWNER_KEY,
  getModelCallStatusLabel,
  useModelCallLock,
} from "../model-calls";
import { AppButton } from "../ui/AppButton";
import { Badge } from "../ui/Badge";
import { ScreenScrollView } from "../ui/ScreenCanvas";
import { SectionTitle } from "../ui/SectionTitle";
import { Surface } from "../ui/Surface";
import {
  buildPromptdexTemplateFromRefinementProposal,
  validateTemplateRefinementInput,
  type TemplateRefinementDraft,
  type TemplateRefinementErrorSummary,
  type TemplateRefinementInputValidationIssue,
  type TemplateRefinementProposal,
} from "./index";
import {
  type AppIconName,
  KeyboardAvoidingView,
  Pressable,
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

type DraftLoadStatus = "loading" | "failed" | "ready";

const INTERRUPTED_REFINEMENT_MESSAGE =
  "上次提炼在结果确认前中断，可修改输入后重新生成。";

export function TemplateRefinementScreen() {
  const router = useRouter();
  const draftRepository = useTemplateRefinementDraftRepository();
  const refinementService = useTemplateRefinementService();
  const catalogService = usePromptdexCatalogService();
  const runtime = useReadyAppRuntime();
  const modelCallLock = useModelCallLock();
  const attentionSnapshot = useBusinessCallAttentionSnapshot();
  const isFocused = useIsFocused();

  const [phase, setPhase] = useState<ScreenPhase>("loading");
  const [draftLoadStatus, setDraftLoadStatus] =
    useState<DraftLoadStatus>("loading");
  const [draft, setDraft] = useState<TemplateRefinementDraft | null>(null);
  const [externalPrompt, setExternalPrompt] = useState("");
  const [isPastingExternalPrompt, setIsPastingExternalPrompt] = useState(false);
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
  const pasteExternalPromptRequestId = useRef(0);
  const externalPromptRef = useRef(externalPrompt);
  const loadDraftRequestId = useRef(0);
  const focusedDraftLoadReadyRef = useRef(false);
  const attentionClearInFlightRef = useRef(new Map<string, string>());
  const ownedRefinementCall =
    modelCallLock.activeCall?.type === "templateRefinement" &&
    modelCallLock.activeCall.ownerKey ===
      TEMPLATE_REFINEMENT_MODEL_CALL_OWNER_KEY
      ? modelCallLock.activeCall
      : null;
  const ownedRefinementCallRef = useRef<ActiveModelCall | null>(
    ownedRefinementCall,
  );
  const previousOwnedRefinementCallRef = useRef<ActiveModelCall | null>(null);
  ownedRefinementCallRef.current = ownedRefinementCall;
  externalPromptRef.current = externalPrompt;

  useEffect(() => {
    return () => {
      pasteExternalPromptRequestId.current += 1;
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      const requestId = ++loadDraftRequestId.current;
      focusedDraftLoadReadyRef.current = false;
      setDraftLoadStatus("loading");

      async function loadDraft() {
        setPhase("loading");
        setFeedback(null);
        try {
          const currentDraft = await draftRepository.get();
          if (cancelled || requestId !== loadDraftRequestId.current) {
            return;
          }
          focusedDraftLoadReadyRef.current = true;
          setDraftLoadStatus("ready");
          setDraft(currentDraft);
          if (currentDraft) {
            hydrateDraftFields(currentDraft);
            if (ownedRefinementCallRef.current) {
              setPhase("generating");
            } else if (currentDraft.status === "ready_for_review") {
              setPhase("review");
            } else if (currentDraft.status === "failed") {
              setPhase("failed");
            } else {
              setPhase("resume_choice");
            }
          } else {
            resetForNewDraft();
            setPhase(ownedRefinementCallRef.current ? "generating" : "editing");
          }
        } catch (error) {
          if (!cancelled && requestId === loadDraftRequestId.current) {
            focusedDraftLoadReadyRef.current = false;
            setDraftLoadStatus("failed");
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
        focusedDraftLoadReadyRef.current = false;
      };
    }, [draftRepository]),
  );

  useEffect(() => {
    if (ownedRefinementCall) {
      previousOwnedRefinementCallRef.current = ownedRefinementCall;
      setPhase("generating");
      return;
    }

    if (!previousOwnedRefinementCallRef.current) {
      return;
    }
    previousOwnedRefinementCallRef.current = null;

    let cancelled = false;
    const requestId = ++loadDraftRequestId.current;
    focusedDraftLoadReadyRef.current = false;
    setDraftLoadStatus("loading");
    setPhase("loading");

    async function reloadCompletedDraft() {
      try {
        const currentDraft = await draftRepository.get();
        if (cancelled || requestId !== loadDraftRequestId.current) {
          return;
        }
        focusedDraftLoadReadyRef.current = true;
        setDraftLoadStatus("ready");
        setDraft(currentDraft);
        setFeedback(null);
        if (!currentDraft) {
          resetForNewDraft();
          setPhase("editing");
          return;
        }

        hydrateDraftFields(currentDraft);
        switch (currentDraft.status) {
          case "ready_for_review":
            setPhase("review");
            break;
          case "failed":
            setPhase("failed");
            break;
          case "generating":
            setPhase("editing");
            setFeedback({
              tone: "notice",
              message: INTERRUPTED_REFINEMENT_MESSAGE,
            });
            break;
          case "editing_input":
            setPhase("editing");
            break;
        }
      } catch (error) {
        if (!cancelled && requestId === loadDraftRequestId.current) {
          focusedDraftLoadReadyRef.current = false;
          setDraftLoadStatus("failed");
          setFeedback({
            tone: "failure",
            message: error instanceof Error ? error.message : String(error),
          });
          setPhase("editing");
        }
      }
    }

    void reloadCompletedDraft();

    return () => {
      cancelled = true;
      focusedDraftLoadReadyRef.current = false;
    };
  }, [draftRepository, ownedRefinementCall]);

  const templateAttention = attentionSnapshot.templateRefinement;

  useEffect(() => {
    const effectiveLoadStatus = focusedDraftLoadReadyRef.current
      ? draftLoadStatus
      : "loading";
    if (
      !shouldClearTemplateRefinementAttention({
        isFocused,
        loadStatus: effectiveLoadStatus,
        hasActiveCall: ownedRefinementCall !== null,
        attentionKind: templateAttention?.kind ?? null,
      }) ||
      !templateAttention
    ) {
      return;
    }

    const subjectId = templateAttention.subjectId;
    const attentionCreatedAt = templateAttention.createdAt;
    if (
      attentionClearInFlightRef.current.get(subjectId) === attentionCreatedAt
    ) {
      return;
    }
    attentionClearInFlightRef.current.set(subjectId, attentionCreatedAt);

    void runtime.businessCallAttentionRepository
      .clearTemplateRefinement()
      .catch(() => {
        console.warn("[template-refinement] 清除提炼提示失败");
      })
      .finally(() => {
        if (
          attentionClearInFlightRef.current.get(subjectId) ===
          attentionCreatedAt
        ) {
          attentionClearInFlightRef.current.delete(subjectId);
        }
      });
  }, [
    draftLoadStatus,
    isFocused,
    ownedRefinementCall,
    runtime.businessCallAttentionRepository,
    templateAttention,
  ]);

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
    externalPromptRef.current = currentDraft.externalPrompt;
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
    externalPromptRef.current = "";
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
        setPhase("editing");
        setFeedback({
          tone: "notice",
          message: INTERRUPTED_REFINEMENT_MESSAGE,
        });
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
    externalPromptRef.current = value;
    setExternalPrompt(value);
    updatePersistedInput(value, plannedUse);
  }

  async function pasteExternalPrompt() {
    if (isPastingExternalPrompt || ownedRefinementCall) {
      return;
    }

    const requestId = ++pasteExternalPromptRequestId.current;
    const externalPromptAtStart = externalPromptRef.current;
    setIsPastingExternalPrompt(true);
    setFeedback(null);
    try {
      const clipboardText = await Clipboard.getStringAsync();
      if (requestId !== pasteExternalPromptRequestId.current) {
        return;
      }
      if (externalPromptRef.current !== externalPromptAtStart) {
        setFeedback({
          tone: "notice",
          message: "输入已发生变化，未覆盖当前内容。",
        });
        return;
      }
      if (clipboardText.trim().length === 0) {
        setFeedback({
          tone: "notice",
          message: "剪贴板中没有可粘贴的文字。",
        });
        return;
      }
      updateExternalPrompt(clipboardText);
    } catch {
      if (requestId === pasteExternalPromptRequestId.current) {
        setFeedback({
          tone: "failure",
          message: "读取剪贴板失败，请检查权限后重试。",
        });
      }
    } finally {
      if (requestId === pasteExternalPromptRequestId.current) {
        setIsPastingExternalPrompt(false);
      }
    }
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

    const lock = modelCallLock.beginModelCall({
      type: "templateRefinement",
      returnHref: "/promptdex/refine",
      ownerKey: TEMPLATE_REFINEMENT_MODEL_CALL_OWNER_KEY,
    });
    if (lock.status === "blocked") {
      setFeedback({
        tone: "failure",
        message:
          lock.reason === "migration"
            ? "已有表格备份或恢复进行中。"
            : `已有${getModelCallStatusLabel(lock.activeCall.type)}。`,
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

  const renderedPhase = ownedRefinementCall ? "generating" : phase;

  return (
    <KeyboardAvoidingView
      behavior={process.env.EXPO_OS === "ios" ? "padding" : undefined}
      className="flex-1 bg-app-surface-raised"
    >
      <ScreenScrollView keyboardBehavior="form" variant="tool">
        {renderedPhase === "loading" ? (
          <StateBox icon="pending" text="正在读取提炼草稿。" />
        ) : null}

        {renderedPhase === "resume_choice" && draft ? (
          <ResumeDraftPanel
            draft={draft}
            onContinue={continueDraft}
            onDiscard={discardDraft}
          />
        ) : null}

        {renderedPhase === "editing" || renderedPhase === "failed" ? (
          <>
            {renderedPhase === "failed" && draft?.errorSummary ? (
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
              onPasteExternalPrompt={pasteExternalPrompt}
              onPlannedUseChange={updatePlannedUse}
              pastingExternalPrompt={isPastingExternalPrompt}
              plannedUse={plannedUse}
              submitting={ownedRefinementCall !== null}
            />
          </>
        ) : null}

        {renderedPhase === "generating" ? (
          <StateBox icon="pending" text="模板提炼进行中。" />
        ) : null}

        {renderedPhase === "review" && reviewProposal ? (
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
            onReturnToInput={() => {
              setNameConflict(false);
              setContractError(null);
              setPhase("editing");
            }}
            proposal={reviewProposal}
          />
        ) : null}

        {feedback ? <FeedbackBox feedback={feedback} /> : null}
      </ScreenScrollView>
    </KeyboardAvoidingView>
  );
}

function InputForm({
  externalPrompt,
  inputIssues,
  onExternalPromptChange,
  onGenerate,
  onPasteExternalPrompt,
  onPlannedUseChange,
  pastingExternalPrompt,
  plannedUse,
  submitting,
}: {
  externalPrompt: string;
  inputIssues: TemplateRefinementInputValidationIssue[];
  onExternalPromptChange: (value: string) => void;
  onGenerate: () => void;
  onPasteExternalPrompt: () => void;
  onPlannedUseChange: (value: string) => void;
  pastingExternalPrompt: boolean;
  plannedUse: string;
  submitting: boolean;
}) {
  const issuesByField = groupIssuesByField(inputIssues);
  const hasIssues = inputIssues.length > 0;
  const placeholderColor = useCSSVariable("--app-ink-muted");
  const generateLabel = submitting
    ? "生成中"
    : hasIssues
      ? "重新检查并生成"
      : "生成提炼方案";

  return (
    <>
      <Surface variant="fieldGroup">
        <View className="flex-row items-center justify-between gap-3">
          <View className="min-w-0 flex-1">
            <SectionTitle>外部完整提示词</SectionTitle>
          </View>
          <AppButton
            disabled={submitting}
            icon="copy"
            label={pastingExternalPrompt ? "粘贴中" : "粘贴"}
            loading={pastingExternalPrompt}
            onPress={onPasteExternalPrompt}
            variant="secondary"
          />
        </View>
        <TextInput
          className="min-h-[220px] rounded-[14px] border border-app-stroke bg-app-field p-3 text-[15px] leading-[21px] text-app-ink"
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
      </Surface>

      <Surface variant="fieldGroup">
        <SectionTitle>计划用途</SectionTitle>
        <TextInput
          className="min-h-[110px] rounded-[14px] border border-app-stroke bg-app-field p-3 text-[15px] leading-[21px] text-app-ink"
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
      </Surface>

      <AppButton
        disabled={submitting || pastingExternalPrompt}
        icon="sparkles"
        label={generateLabel}
        loading={submitting}
        onPress={onGenerate}
      />
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
  onReturnToInput,
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
  onReturnToInput: () => void;
  proposal: TemplateRefinementProposal;
}) {
  const placeholderColor = useCSSVariable("--app-ink-muted");

  return (
    <>
      <Surface variant="fieldGroup">
        <SectionTitle>写入信息</SectionTitle>
        <View className="gap-2">
          <InputLabel>名称</InputLabel>
          <TextInput
            className="min-h-[46px] rounded-[14px] border border-app-stroke bg-app-field px-3 py-2.5 text-[15px] leading-[21px] text-app-ink"
            autoCapitalize="none"
            onChangeText={onNameChange}
            placeholder="refined-template"
            placeholderTextColor={placeholderColor}
            value={name}
          />
        </View>
        <View className="gap-2">
          <InputLabel>说明</InputLabel>
          <TextInput
            className="min-h-[110px] rounded-[14px] border border-app-stroke bg-app-field p-3 text-[15px] leading-[21px] text-app-ink"
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
            className="text-[13px] leading-[18px] text-app-ink-muted"
          >
            正在检查名称。
          </Text>
        ) : null}
        {nameConflict ? <FailureBox message="图鉴条目名称已存在。" /> : null}
        {contractError ? <FailureBox message={contractError} /> : null}
      </Surface>

      <Surface>
        <SectionTitle>方案摘要</SectionTitle>
        <BodyText>{proposal.taskTypeRationale}</BodyText>
        <SummaryList title="保留规则" values={proposal.retainedRules} />
        <RemovedRulesList values={proposal.removedRules} />
      </Surface>

      <Surface>
        <SectionTitle>提炼补充</SectionTitle>
        {proposal.additions.length === 0 ? (
          <BodyText>无</BodyText>
        ) : (
          proposal.additions.map((addition, index) => (
            <View className="gap-1.5" key={`${addition.summary}-${index}`}>
              <Text
                className="text-sm font-bold leading-5 text-app-ink"
                selectable
              >
                {addition.summary}
              </Text>
              <BodyText>{addition.reason}</BodyText>
              <BodyText>{addition.impactIfRejected}</BodyText>
            </View>
          ))
        )}
      </Surface>

      <Surface>
        <SectionTitle>输入声明</SectionTitle>
        {Object.entries(proposal.template.inputs).map(([inputName, input]) => (
          <View className="gap-1.5" key={inputName}>
            <View className="flex-row items-center gap-2">
              <Text
                className="flex-1 text-[15px] font-bold leading-[21px] text-app-ink"
              >
                {inputName}
              </Text>
              <RequiredBadge required={input.required} />
            </View>
            <BodyText>{input.description}</BodyText>
          </View>
        ))}
      </Surface>

      <Surface>
        <SectionTitle>完整正文</SectionTitle>
        <View
          className="rounded-[14px] border border-app-stroke bg-app-field p-3"
          style={{ borderCurve: "continuous" }}
        >
          <Text
            className="font-mono text-[13px] leading-5 text-app-ink"
            selectable
          >
            {proposal.template.body}
          </Text>
        </View>
      </Surface>

      <Surface variant="fieldGroup">
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
      </Surface>

      <View className="flex-row flex-wrap gap-3">
        <AppButton
          disabled={isWriting}
          icon="edit"
          label="返回修改输入"
          onPress={onReturnToInput}
          variant="secondary"
        />
        <AppButton
          disabled={!canWrite}
          icon="confirm"
          label="写入个人图鉴"
          loading={isWriting}
          onPress={onConfirmWrite}
        />
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
    <Surface>
      <SectionTitle>未完成草稿</SectionTitle>
      <BodyText>{getDraftStatusLabel(draft.status)}</BodyText>
      <View className="flex-row flex-wrap gap-3">
        <AppButton
          icon="delete"
          label="丢弃"
          onPress={onDiscard}
          variant="danger"
        />
        <AppButton icon="next" label="继续" onPress={onContinue} />
      </View>
    </Surface>
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
  const actionColor = useCSSVariable("--app-action");
  const mutedColor = useCSSVariable("--app-ink-muted");

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      onPress={() => onChange(!checked)}
      className="min-h-11 flex-row items-center gap-2.5 rounded-[14px] px-1 transition-colors duration-150 active:bg-app-action-soft"
      style={{ borderCurve: "continuous" }}
    >
      <SymbolIcon
        className="h-[22px] w-[22px]"
        name={checked ? "checkbox-checked" : "checkbox-empty"}
        tintColor={checked ? actionColor : mutedColor}
      />
      <Text className="flex-1 text-sm leading-5 text-app-ink">
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
      <Text
        className="text-[13px] leading-[18px] tabular-nums text-app-ink-muted"
      >
        {count}/{max}
      </Text>
      {issues.map((issue) => (
        <Text
          className="flex-1 text-right text-[13px] leading-[18px] text-app-danger"
          key={`${issue.field}-${issue.code}`}
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
              className="text-sm font-bold leading-5 text-app-ink"
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
  const successColor = useCSSVariable("--app-success");
  const neutralColor = useCSSVariable("--app-action");
  if (feedback.tone === "failure") {
    return <FailureBox message={feedback.message} />;
  }

  const isSuccess = feedback.tone === "success";

  return (
    <Surface tone={isSuccess ? "success" : "neutral"} variant="feedback">
      <View className="flex-row items-start gap-2.5">
        <SymbolIcon
          className="h-5 w-5"
          name={isSuccess ? "success" : "information"}
          tintColor={isSuccess ? successColor : neutralColor}
        />
        <Text
          className={`flex-1 text-sm leading-5 ${isSuccess ? "text-app-success" : "text-app-ink"}`}
        >
          {feedback.message}
        </Text>
      </View>
    </Surface>
  );
}

function FailureBox({ message }: { message: string }) {
  const dangerColor = useCSSVariable("--app-danger");
  return (
    <Surface tone="danger" variant="feedback">
      <View className="flex-row items-start gap-2.5">
        <SymbolIcon
          className="h-5 w-5"
          name="warning"
          tintColor={dangerColor}
        />
        <Text className="flex-1 text-sm leading-5 text-app-danger">
          {message}
        </Text>
      </View>
    </Surface>
  );
}

function StateBox({ icon, text }: { icon: AppIconName; text: string }) {
  const actionColor = useCSSVariable("--app-action");
  return (
    <Surface variant="feedback">
      <View className="items-center gap-2.5">
        <SymbolIcon className="h-6 w-6" name={icon} tintColor={actionColor} />
        <Text
          className="text-center text-sm leading-5 text-app-ink-muted"
        >
          {text}
        </Text>
      </View>
    </Surface>
  );
}

function InputLabel({ children }: { children: string }) {
  return (
    <Text className="text-sm font-bold leading-5 text-app-ink">
      {children}
    </Text>
  );
}

function RequiredBadge({ required }: { required: boolean }) {
  return <Badge variant="neutral">{required ? "必需" : "可选"}</Badge>;
}

function BodyText({ children }: { children: string }) {
  return (
    <Text className="text-sm leading-[21px] text-app-ink-muted" selectable>
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
      return INTERRUPTED_REFINEMENT_MESSAGE;
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
