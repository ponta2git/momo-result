import type {
  PlayerRadarAdministrationView,
  PlayerRadarPreviewView,
  RadarAdminResource,
  RadarAdminReceipt,
  RadarAdminHandlers,
  RadarEditingHandlers,
} from "@/features/seriesAnalysisAdmin/radar/playerRadarAdminTypes";
import type {
  RadarEditingModel,
  RadarEditingSource,
} from "@/features/seriesAnalysisAdmin/radar/radarThresholdEditorModel";
import {
  radarBasisInput,
  radarInputBasis,
} from "@/features/seriesAnalysisAdmin/radar/radarThresholdInput";
import {
  formatApiError,
  normalizeDisplayApiError,
  normalizeUnknownApiError,
} from "@/shared/api/problemDetails";
import type {
  SeriesPlayerRadarOperation,
  SeriesPlayerRadarState,
} from "@/shared/api/seriesPlayerRadar";
import { formatDateTimeLong } from "@/shared/lib/dateTime";
import {
  playerRadarBasisDisplay,
  playerRadarEvaluationDisplay,
  playerRadarSampleDisplay,
} from "@/shared/seriesAnalysis/playerRadarDisplay";
import { playerRadarAxes } from "@/shared/seriesAnalysis/playerRadarPresentation";

export function isRadarOperationInProgress(
  status: SeriesPlayerRadarOperation["status"] | undefined,
): boolean {
  return status === "pending" || status === "running";
}

export function radarSubmissionUncertain(error: unknown): boolean {
  if (!error) return false;
  const normalized = normalizeUnknownApiError(error);
  return (
    normalized.status === undefined ||
    normalized.status >= 500 ||
    normalized.category === "idempotency_in_progress"
  );
}

export function radarCommandErrorMessage(error: unknown): string {
  if (radarSubmissionUncertain(error))
    return "操作の受付結果はまだ不明です。この確認を閉じて「操作の状態を確認する」を選んでください。";
  if (normalizeUnknownApiError(error).status === 409)
    return "記録・変更案・基準の状態が変わりました。この確認を閉じて「基準の状態を更新」から最新の比較を確認してください。";
  return formatApiError(error, "操作を受け付けられません");
}

const operationNames = {
  candidate: "変更案の作成",
  manual: "適用前の確認",
  preview: "比較の計算",
  apply: "基準の適用",
  withdraw: "取り下げ",
  restore: "前回の基準からの変更案の作成",
  acknowledge: "見直し目安の確認",
  retry: "再試行",
} as const;

export function radarFailureMessage(code: string | null): string {
  switch (code) {
    case "no_matches":
      return "比較する試合がありません。記録を追加した後に比較を再試行してください。";
    case "source_changed":
    case "candidate_source_changed":
      return "変更案の作成元の記録が変わったため、適用できません。最新の記録から変更案を作り直してください。";
    case "preview_stale":
      return "比較後に記録または適用中の基準が変わりました。最新の記録で比較を計算してください。";
    case "basis_incompatible":
      return "現在の指標・計算方法ではこの基準を適用できません。新しい変更案を作成してください。";
    default:
      return "処理を完了できませんでした。現在の状態を確認し、変更案が有効なら再試行してください。";
  }
}

export function buildRadarOperationView(
  operation: SeriesPlayerRadarOperation,
): NonNullable<PlayerRadarAdministrationView["operation"]> {
  const name = operationNames[operation.kind];
  const title =
    operation.status === "pending"
      ? `${name}を受け付けました`
      : operation.status === "running"
        ? `${name}中です`
        : operation.status === "failed"
          ? `${name}を完了できませんでした`
          : operation.status === "withdrawn"
            ? `${name}を取り下げました`
            : `${name}が完了しました`;
  return {
    operationId: operation.operationId,
    kind: operation.kind,
    status: operation.status,
    title,
    detail: operation.status === "failed" ? radarFailureMessage(operation.safeFailureCode) : "",
  };
}

export function buildRadarReviewView(
  state: SeriesPlayerRadarState,
): PlayerRadarAdministrationView["review"] {
  const monitor = state.monitor;
  if (!monitor)
    return {
      explanation: state.currentBasis ? "見直しの目安は未計算です。" : null,
      reasons: [],
    };
  const explanation =
    monitor.status === "basis_unavailable"
      ? null
      : monitor.status === "insufficient_matches"
        ? `基準の作成元より新しい記録は${monitor.postSourceMatchCount}試合です。判定には40試合・8開催が必要です。`
        : monitor.status === "insufficient_events"
          ? `対象${monitor.evaluatedMatchCount}試合は${monitor.evaluatedHeldEventCount}開催分です（8開催以上で判定）。`
          : null;
  return {
    explanation,
    reasons: monitor.reasons.map((reason) => {
      const label =
        reason.kind === "initial_basis_eligible"
          ? "初回基準を作成できます。"
          : reason.kind === "source_changed"
            ? "基準を作った記録に訂正があります。"
            : reason.kind === "new_map"
              ? "作成元にないマップの記録が加わりました。"
              : `${reason.axisIds.map((id) => playerRadarAxes.find((axis) => axis.id === id)?.label ?? id).join("・")}で、続く2期間とも4人中3人以上が9点以上です。`;
      return {
        evidenceKey: reason.evidenceChecksum,
        label,
        acknowledged: state.acknowledgedEvidenceKeys.includes(reason.evidenceChecksum),
        evidence:
          reason.kind === "high_score_concentration"
            ? [
                {
                  label: "対象記録",
                  value: `${monitor.evaluatedMatchCount}試合・${monitor.evaluatedHeldEventCount}開催`,
                },
                ...monitor.latestWindows.map((window, index) => ({
                  label: `${index + 1}つ目の期間`,
                  value: `${formatDateTimeLong(window.firstMatch.playedAt)}〜${formatDateTimeLong(window.lastMatch.playedAt)}（${window.evaluation.sample.matchCount}試合・${window.evaluation.sample.heldEventCount}開催）`,
                })),
              ]
            : [],
      };
    }),
  };
}

/** Converts server bases and one scope preview into the editor's source identities. */
export function buildRadarBasisView({
  state,
  title,
  scope,
  preview,
  previewFetching,
  previewFailed,
}: RadarAdminResource) {
  const candidate = state?.candidate;
  const candidateActive =
    candidate && ["pending", "ready", "unavailable", "failed"].includes(candidate.status);
  const previewId = candidate?.latestPreview?.previewId;
  const maps = title?.maps ?? [];
  const currentBasis = state?.currentBasis
    ? playerRadarBasisDisplay(state.currentBasis, maps)
    : null;
  const previousBasis = state?.previousBasis
    ? playerRadarBasisDisplay(state.previousBasis, maps)
    : null;
  const candidateBasis =
    candidate?.result?.basis && candidate.basisId
      ? playerRadarBasisDisplay(
          {
            basisId: candidate.basisId,
            createdAt: candidate.createdAt,
            appliedAt: null,
            basis: candidate.result.basis,
            achievementCurve: candidate.achievementCurve,
          },
          maps,
        )
      : null;
  const previewState: PlayerRadarAdministrationView["previewState"] =
    preview?.status ?? candidate?.latestPreview?.status ?? "none";
  const beforeBasis =
    preview?.beforeBasisId === currentBasis?.basisId
      ? currentBasis
      : preview?.beforeBasisId === previousBasis?.basisId
        ? previousBasis
        : null;
  const previewDisplay: PlayerRadarPreviewView | null =
    previewId && candidateBasis
      ? {
          previewId,
          createdAt:
            preview?.createdAt ?? candidate?.latestPreview?.createdAt ?? candidate.createdAt,
          evaluationState:
            previewFetching && !preview
              ? "loading"
              : previewFailed
                ? "error"
                : preview
                  ? preview.scope.state === "empty"
                    ? "empty"
                    : preview.scope.state === "awaiting_analysis"
                      ? "awaiting_analysis"
                      : "ready"
                  : "loading",
          before: preview?.before
            ? playerRadarEvaluationDisplay(
                preview.before,
                beforeBasis,
                maps,
                [],
                preview.beforeAchievements,
              )
            : null,
          after: preview?.after
            ? playerRadarEvaluationDisplay(
                preview.after,
                candidateBasis,
                maps,
                [],
                preview.afterAchievements,
              )
            : null,
          beforeBasis,
          candidateBasis,
        }
      : null;

  const preparedEvaluation: RadarEditingModel["evaluation"] =
    previewDisplay?.after &&
    preview?.status === "ready" &&
    (preview.beforeBasisId ?? null) === (currentBasis?.basisId ?? null) &&
    !previewFailed
      ? {
          key: `${preview.previewId}:${preview.inputRevision}:${scope.seasonMasterId}:${scope.mapMasterId}`,
          before: previewDisplay.before,
          raw: previewDisplay.after,
          createdAt: preview.createdAt,
        }
      : null;
  const expectedCandidateId = candidateActive ? candidate.candidateId : null;
  const currentEditingSource: RadarEditingSource | null = currentBasis
    ? {
        label: "適用中の基準",
        basis: currentBasis,
        input: radarBasisInput(currentBasis),
        sourceBasisId: currentBasis.basisId,
        sourceCandidateId: null,
        expectedCurrentBasisId: currentBasis.basisId,
        expectedCandidateId,
        savedCandidateId: null,
      }
    : null;
  const sourceBasis = candidate?.sourceBasis
    ? playerRadarBasisDisplay(candidate.sourceBasis, maps)
    : candidateBasis;
  const manualSourceBasisId = candidate?.sourceBasisId;
  const editableBasis =
    candidate?.manualInput && sourceBasis && manualSourceBasisId
      ? radarInputBasis(sourceBasis, candidate.manualInput)
      : candidate?.status === "ready"
        ? candidateBasis
        : null;
  const candidateEditingSource: RadarEditingSource | null =
    candidateActive && editableBasis
      ? {
          label: candidate.manualInput ? "保存済みの手調整案" : "自動提案の変更案",
          basis: editableBasis,
          input: candidate.manualInput
            ? { ...candidate.manualInput, achievementCurve: candidate.achievementCurve }
            : radarBasisInput(editableBasis),
          sourceBasisId: manualSourceBasisId ?? editableBasis.basisId,
          sourceCandidateId: candidate.manualInput
            ? candidate.sourceCandidateId
            : candidate.candidateId,
          expectedCurrentBasisId: currentBasis?.basisId ?? null,
          expectedCandidateId,
          savedCandidateId: candidate.candidateId,
        }
      : null;

  return {
    currentBasis,
    previousBasis,
    candidateBasis,
    previewState,
    previewDisplay,
    preparedEvaluation,
    currentEditingSource,
    candidateEditingSource,
    candidateActive,
  };
}

/** Selects the relevant receipt and explains which commands the current state permits. */
export function radarOperationState({
  resource,
  previewState,
  accepted,
  creationOperation,
  commandError,
  pending,
  checkingOperation,
  allowed,
  paused,
}: {
  resource: RadarAdminResource;
  previewState: PlayerRadarAdministrationView["previewState"];
  accepted: SeriesPlayerRadarOperation | undefined;
  creationOperation: SeriesPlayerRadarOperation | undefined;
  commandError: unknown;
  pending: boolean;
  checkingOperation: boolean;
  allowed: boolean;
  paused: boolean;
}) {
  const state = resource.state;
  const candidate = state?.candidate;
  const operations = state?.operations ?? [];
  const acceptedOperation = accepted
    ? (creationOperation ??
      operations.find((operation) => operation.operationId === accepted.operationId) ??
      accepted)
    : undefined;
  const activeOperation = operations.find(
    (operation) => operation.status === "pending" || operation.status === "running",
  );
  const latestOperation = activeOperation ?? acceptedOperation ?? operations[0];
  const operationInProgress =
    latestOperation?.status === "pending" || latestOperation?.status === "running";
  const communicationUnknown = radarSubmissionUncertain(commandError);
  const conflictNeedsRefresh =
    !communicationUnknown && commandError && normalizeUnknownApiError(commandError).status === 409;
  const permissionReason = allowed
    ? null
    : paused
      ? "権限を確認できるまで操作できません。"
      : "運用担当の権限が必要です。";
  const busyReason =
    permissionReason ??
    (pending || checkingOperation
      ? "操作を受け付けています。"
      : communicationUnknown
        ? "操作の状態を確認してください。"
        : null);
  const operationReason =
    busyReason ?? (operationInProgress ? "現在の処理の完了を確認してください。" : null);
  const applyDisabledReason =
    operationReason ??
    (conflictNeedsRefresh ? "基準の状態を更新し、最新の比較を確認してください。" : null) ??
    (candidate?.status === "ready"
      ? previewState === "ready"
        ? resource.previewFetching || resource.stateFetching
          ? "最新の状態を読み込んでいます。"
          : resource.previewFailed || resource.stateFailed
            ? "比較と基準の状態を再読み込みしてください。"
            : null
        : "最新の記録で比較を計算し、内容を確認してください。"
      : "有効な変更案が必要です。");
  const missingRecords =
    state && (state.eligibility.matchCount < 40 || state.eligibility.heldEventCount < 8)
      ? `作成にはあと${[
          state.eligibility.matchCount < 40 ? `${40 - state.eligibility.matchCount}試合` : null,
          state.eligibility.heldEventCount < 8
            ? `${8 - state.eligibility.heldEventCount}開催`
            : null,
        ]
          .filter(Boolean)
          .join("・")}が必要です。`
      : null;

  return {
    acceptedOperation,
    latestOperation,
    communicationUnknown,
    conflictNeedsRefresh,
    permissionReason,
    busyReason,
    operationReason,
    applyDisabledReason,
    missingRecords,
    checkingOperation,
  };
}

/** A guarded 409 only disposes a local edit when a subsequent read proves ownership ended. */
export function radarDraftNoLongerOwned(
  state: SeriesPlayerRadarState | undefined,
  gameTitleId: string,
  candidateId: string,
) {
  if (!state || state.gameTitleId !== gameTitleId) return false;
  const candidate = state.candidate;
  const superseded =
    candidate &&
    (candidate.candidateId !== candidateId || ["withdrawn", "applied"].includes(candidate.status));
  const applicationAccepted = state.operations.some(
    (operation) => operation.kind === "apply" && operation.candidateId === candidateId,
  );
  return Boolean(superseded || applicationAccepted);
}

export function buildRadarAdministrationView({
  gameTitleId,
  gameTitleName,
  authorizationRevision,
  resource,
  basis,
  operation,
  receipt,
  errors,
  editingEvaluation,
  handlers,
  editingHandlers,
}: {
  gameTitleId: string;
  gameTitleName: string;
  authorizationRevision: number;
  resource: RadarAdminResource;
  basis: ReturnType<typeof buildRadarBasisView>;
  operation: ReturnType<typeof radarOperationState>;
  receipt: RadarAdminReceipt;
  errors: { check: unknown; creation: unknown; command: unknown; state: unknown; options: unknown };
  editingEvaluation: {
    evaluation: RadarEditingModel["evaluation"];
    message: string | null;
    loading: boolean;
  };
  handlers: RadarAdminHandlers;
  editingHandlers: RadarEditingHandlers;
}): PlayerRadarAdministrationView | null {
  const { state, title, scope } = resource;
  const candidate = state?.candidate;
  const maps = title?.maps ?? [];
  const {
    currentBasis,
    previousBasis,
    candidateBasis,
    previewState,
    previewDisplay,
    currentEditingSource,
    candidateEditingSource,
    candidateActive,
  } = basis;
  const {
    acceptedOperation,
    latestOperation,
    communicationUnknown,
    conflictNeedsRefresh,
    permissionReason,
    busyReason,
    operationReason,
    applyDisabledReason,
    missingRecords,
    checkingOperation,
  } = operation;
  const { accepted, creationAccepted, submittedRequest } = receipt;
  const feedbackError =
    errors.check ??
    errors.creation ??
    (communicationUnknown ? null : errors.command) ??
    errors.state ??
    errors.options;
  const normalizedError = feedbackError ? normalizeDisplayApiError(feedbackError) : null;
  const feedback: PlayerRadarAdministrationView["feedback"] = normalizedError
    ? { title: normalizedError.title, detail: normalizedError.detail, tone: "warning" }
    : accepted && latestOperation?.status === "succeeded"
      ? {
          title: buildRadarOperationView(acceptedOperation ?? accepted).title,
          detail: "",
          tone: "success",
        }
      : null;

  const view: PlayerRadarAdministrationView | null = state
    ? {
        authorizationRevision,
        editing: {
          acceptedApply:
            accepted?.kind === "apply" &&
            accepted.candidateId &&
            ["pending", "running", "succeeded"].includes(accepted.status) &&
            receipt.canCommit
              ? { operationId: accepted.operationId, candidateId: accepted.candidateId }
              : null,
          acceptedSave:
            accepted?.candidateId &&
            submittedRequest?.kind === "manual" &&
            submittedRequest.manualInput &&
            submittedRequest.sourceBasisId &&
            receipt.canCommit
              ? {
                  candidateId: accepted.candidateId,
                  operationId: accepted.operationId,
                  request: {
                    sourceBasisId: submittedRequest.sourceBasisId,
                    sourceCandidateId: submittedRequest.sourceCandidateId ?? null,
                    expectedCurrentBasisId: submittedRequest.expectedCurrentBasisId ?? null,
                    expectedCandidateId: submittedRequest.expectedCandidateId ?? null,
                    manualInput: {
                      axes: (submittedRequest.manualInput.axes ?? []).map((axis) => ({
                        axisId: axis.axisId,
                        thresholds: axis.thresholds ?? [],
                      })),
                      ...(submittedRequest.manualInput.achievementCurve
                        ? { achievementCurve: submittedRequest.manualInput.achievementCurve }
                        : {}),
                    },
                  },
                }
              : null,
          current: currentEditingSource,
          candidate: candidateEditingSource,
          evaluation: editingEvaluation.evaluation,
          evaluationMessage: editingEvaluation.message,
          evaluationUpdating: editingEvaluation.loading || resource.previewFetching,
          permissionReason,
          saveDisabledReason:
            operationReason ?? (conflictNeedsRefresh ? "基準の状態を更新してください。" : null),
          ...editingHandlers,
        },
        gameTitleId,
        gameTitleName,
        currentBasis,
        previousBasis,
        eligibility: state.eligibility,
        candidate: candidate
          ? {
              manuallyEdited: Boolean(candidate.manualInput),
              candidateId: candidate.candidateId,
              status: candidate.status,
              basis: candidateBasis,
              source: candidate.result
                ? playerRadarSampleDisplay(candidate.result.sourceSummary, maps)
                : null,
              failureMessage: candidate.safeFailureCode
                ? radarFailureMessage(candidate.safeFailureCode)
                : null,
              unavailableAxes:
                candidate.result?.axes
                  .filter((axis) => axis.unavailableReasons.length > 0)
                  .map((axis) => ({
                    axisId: axis.axisId,
                    reason: axis.unavailableReasons.includes("degenerate_distribution")
                      ? "分布の広がりが不足しています"
                      : "作成元の試合・開催件数が不足しています",
                  })) ?? [],
            }
          : null,
        preview: previewDisplay,
        previewState,
        previewFilter: {
          seasonMasterId: scope.seasonMasterId,
          mapMasterId: scope.mapMasterId,
          seasonOptions: [
            { label: "全期間", value: "" },
            ...(title?.seasons.map((season) => ({
              label: season.displayName,
              value: season.seasonMasterId,
            })) ?? []),
            ...(scope.seasonMasterId &&
            !title?.seasons.some((season) => season.seasonMasterId === scope.seasonMasterId)
              ? [{ label: scope.seasonName, value: scope.seasonMasterId }]
              : []),
          ],
          mapOptions: [
            { label: "全マップ", value: "" },
            ...maps.map((map) => ({ label: map.displayName, value: map.mapMasterId })),
            ...(scope.mapMasterId && !maps.some((map) => map.mapMasterId === scope.mapMasterId)
              ? [{ label: scope.mapName, value: scope.mapMasterId }]
              : []),
          ],
        },
        previewUpdating: resource.previewFetching,
        operation: latestOperation ? buildRadarOperationView(latestOperation) : null,
        review: buildRadarReviewView(state),
        feedback,
        communicationUnknown,
        applyDisabledReason,
        applyPending: receipt.pending && submittedRequest?.kind === "apply",
        autoEditCandidateId: creationAccepted?.candidateId ?? null,
        creationPending:
          (receipt.pending &&
            (submittedRequest?.kind === "candidate" || submittedRequest?.kind === "restore")) ||
          Boolean(
            creationAccepted &&
            !receipt.creationFailed &&
            (acceptedOperation?.status === "pending" ||
              acceptedOperation?.status === "running" ||
              (acceptedOperation?.status === "succeeded" &&
                resource.stateFetching &&
                candidate?.status !== "ready")),
          ),
        actions: {
          refresh: {
            disabledReason:
              permissionReason ??
              (resource.stateFetching || resource.previewFetching || receipt.pending
                ? "状態を更新中です。"
                : null),
            pending: resource.stateFetching || resource.previewFetching,
            run: handlers.refresh,
          },
          generate: {
            pending: receipt.pending && submittedRequest?.kind === "candidate",
            disabledReason:
              operationReason ??
              (candidateActive ? "現在の変更案を確認または取り下げてください。" : missingRecords),
            run: handlers.generate,
          },
          rebuildPreview: {
            pending: receipt.pending && submittedRequest?.kind === "preview",
            disabledReason: operationReason,
            run: handlers.rebuildPreview,
          },
          withdraw: {
            pending: receipt.pending && submittedRequest?.kind === "withdraw",
            disabledReason: busyReason,
            run: handlers.withdraw,
          },
          restore: {
            pending: receipt.pending && submittedRequest?.kind === "restore",
            disabledReason:
              operationReason ??
              (candidateActive ? "現在の変更案を確認または取り下げてください。" : null),
            run: handlers.restore,
          },
          retry: {
            pending: receipt.pending && submittedRequest?.kind === "retry",
            disabledReason:
              operationReason ??
              (!candidate?.manualInput &&
              (candidate?.status === "invalid" || candidate?.status === "unavailable")
                ? "変更案を取り下げ、最新の記録から作り直してください。"
                : null),
            run: handlers.retry,
          },
          checkOperation: {
            disabledReason:
              permissionReason ??
              (checkingOperation || receipt.pending ? "操作を確認中です。" : null),
            pending: checkingOperation,
            run: handlers.checkOperation,
          },
          apply: handlers.apply,
          acknowledge: handlers.acknowledge,
          selectSeason: handlers.selectSeason,
          selectMap: handlers.selectMap,
          resetPreviewFilter: handlers.resetPreviewFilter,
        },
      }
    : null;
  return view;
}
