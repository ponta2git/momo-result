import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import type {
  PlayerRadarAdminModel,
  PlayerRadarApplyTarget,
  PlayerRadarPreviewModel,
} from "@/features/seriesAnalysisAdmin/playerRadarAdminModel";
import {
  radarFailureMessage,
  radarOperationPresentation,
  radarReviewPresentation,
  radarSubmissionUncertain,
} from "@/features/seriesAnalysisAdmin/playerRadarAdminPresentation";
import type {
  RadarEditingModel,
  RadarEditingSource,
} from "@/features/seriesAnalysisAdmin/radarThresholdEditorModel";
import {
  radarBasisInput,
  radarInputBasis,
} from "@/features/seriesAnalysisAdmin/radarThresholdInput";
import { useRadarEditingEvaluation } from "@/features/seriesAnalysisAdmin/useRadarEditingEvaluation";
import { runIdempotentMutation } from "@/shared/api/idempotency";
import { normalizeDisplayApiError, normalizeUnknownApiError } from "@/shared/api/problemDetails";
import { isInitialQueryLoading, shouldShowQueryError } from "@/shared/api/queryErrorState";
import { seriesAnalysisKeys, seriesPlayerRadarKeys } from "@/shared/api/queryKeys";
import { seriesAnalysisOptionsQueryOptions } from "@/shared/api/seriesAnalysisQueryOptions";
import {
  requestSeriesPlayerRadarOperation,
  seriesPlayerRadarOperationQueryOptions,
  seriesPlayerRadarPreviewQueryOptions,
  seriesPlayerRadarStateQueryOptions,
} from "@/shared/api/seriesPlayerRadar";
import type {
  SeriesPlayerRadarCommand,
  SeriesPlayerRadarOperation,
} from "@/shared/api/seriesPlayerRadar";
import { useIdempotencyKeyStore } from "@/shared/api/useIdempotencyKeyStore";
import type { AuthorizationLease } from "@/shared/auth/authorization";
import { useAuthorization } from "@/shared/auth/useAuthorization";
import {
  playerRadarBasisDisplay,
  playerRadarEvaluationDisplay,
  playerRadarSampleDisplay,
} from "@/shared/seriesAnalysis/playerRadarDisplay";

type RadarCommandRequest = { request: SeriesPlayerRadarCommand; lease: AuthorizationLease };

/** Each mounted instance owns one title; scope changes never retarget a submitted command. */
export function usePlayerRadarAdminModel(
  gameTitleId: string,
  gameTitleName: string,
  onApplyAccepted?: (operationId: string) => void,
) {
  const queryClient = useQueryClient();
  const authorization = useAuthorization();
  const keys = useIdempotencyKeyStore();
  const commandPending = useRef(false);
  const mounted = useRef(false);
  const notifiedApplication = useRef<string | null>(null);
  const handledAcceptance = useRef<SeriesPlayerRadarOperation | undefined>(undefined);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [scope, setScope] = useState({
    seasonMasterId: "",
    mapMasterId: "",
    seasonName: "",
    mapName: "",
  });
  const [editorActive, setEditorActive] = useState(false);
  const [checkingOperation, setCheckingOperation] = useState(false);
  const [checkError, setCheckError] = useState<unknown>();
  const optionsQuery = useQuery(seriesAnalysisOptionsQueryOptions());
  const stateOptions = seriesPlayerRadarStateQueryOptions(gameTitleId);
  const canReadState = authorization.canRead("operations", stateOptions.queryKey);
  const stateQuery = useQuery({
    ...stateOptions,
    enabled: () => canReadState && authorization.canRead("operations", stateOptions.queryKey),
  });
  const state = authorization.retained.operations ? stateQuery.data : undefined;
  const title = optionsQuery.data?.titles.find((entry) => entry.gameTitleId === gameTitleId);
  const maps = title?.maps ?? [];
  const candidate = state?.candidate;
  const previewId = candidate?.latestPreview?.previewId;
  const previewOptions = seriesPlayerRadarPreviewQueryOptions(
    previewId
      ? {
          gameTitleId,
          previewId,
          seasonMasterId: scope.seasonMasterId || undefined,
          mapMasterId: scope.mapMasterId || undefined,
        }
      : undefined,
  );
  const previewQuery = useQuery({
    ...previewOptions,
    enabled: () =>
      authorization.allowed.operations &&
      Boolean(previewOptions.enabled) &&
      authorization.canRead("operations", previewOptions.queryKey),
  });

  const command = useMutation({
    mutationFn: ({ request, lease }: RadarCommandRequest) => {
      if (!mounted.current || !authorization.canCommit(lease))
        throw new DOMException("権限を確認できません", "AbortError");
      return runIdempotentMutation(keys, "seriesAnalysis.radarOperation", request, (options) =>
        requestSeriesPlayerRadarOperation(request, options),
      );
    },
    onMutate: () => setCheckError(undefined),
    onError: (error, { lease }) => {
      if (mounted.current) authorization.reportError(error, lease);
    },
    onSettled: () => {
      commandPending.current = false;
    },
  });

  // Keep a confirmed receipt during temporary auth checks. Its cache updates and navigation
  // resume once for the same authorized owner; a revoked owner never recreates protected data.
  useEffect(() => {
    const response = command.data;
    const submitted = command.variables;
    if (
      !response ||
      !submitted ||
      handledAcceptance.current === response ||
      !authorization.canCommit(submitted.lease)
    )
      return;
    handledAcceptance.current = response;
    const { request } = submitted;
    queryClient.setQueryData(
      seriesPlayerRadarKeys.operation(request.gameTitleId, response.operationId),
      response,
    );
    // Read reconciliation does not keep the already accepted confirmation submitting.
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: seriesPlayerRadarKeys.title(request.gameTitleId) }),
      queryClient.invalidateQueries({ queryKey: seriesAnalysisKeys.adminRoot() }),
      queryClient.invalidateQueries({ queryKey: seriesAnalysisKeys.statusRoot() }),
      queryClient.invalidateQueries({ queryKey: seriesPlayerRadarKeys.scopeStatusRoot() }),
    ]);
    if (
      request.kind === "apply" &&
      ["pending", "running", "succeeded"].includes(response.status) &&
      notifiedApplication.current !== response.operationId
    ) {
      notifiedApplication.current = response.operationId;
      onApplyAccepted?.(response.operationId);
    }
  }, [authorization, command.data, command.variables, onApplyAccepted, queryClient]);

  const currentCommand = command.variables
    ? authorization.isCurrent(command.variables.lease)
    : false;
  const submittedRequest = command.variables?.request;
  const commandError = currentCommand ? command.error : undefined;
  const accepted = currentCommand ? command.data : undefined;
  const creationAccepted =
    accepted && (accepted.kind === "candidate" || accepted.kind === "restore")
      ? accepted
      : undefined;
  const creationOptions = seriesPlayerRadarOperationQueryOptions(
    gameTitleId,
    creationAccepted?.operationId ?? "",
  );
  const creationQuery = useQuery({
    ...creationOptions,
    enabled: (query) => {
      const status = query.state.data?.status ?? creationAccepted?.status;
      return (
        Boolean(creationAccepted) &&
        authorization.canRead("operations", creationOptions.queryKey) &&
        (status === "pending" || status === "running")
      );
    },
    refetchOnWindowFocus: false,
    refetchIntervalInBackground: false,
    refetchInterval: (query) => {
      if (query.state.status === "error") return false;
      const status = query.state.data?.status ?? creationAccepted?.status;
      return status === "pending" || status === "running" ? 2000 : false;
    },
  });
  const completedCreation = useRef<string | null>(null);
  useEffect(() => {
    const operation = creationQuery.data;
    if (
      !creationAccepted ||
      !operation ||
      !authorization.allowed.operations ||
      operation.status === "pending" ||
      operation.status === "running" ||
      completedCreation.current === operation.operationId
    )
      return;
    completedCreation.current = operation.operationId;
    void queryClient.invalidateQueries({ queryKey: seriesPlayerRadarKeys.title(gameTitleId) });
  }, [
    authorization.allowed.operations,
    creationAccepted,
    creationQuery.data,
    gameTitleId,
    queryClient,
  ]);
  const operations = state?.operations ?? [];
  const acceptedOperation = accepted
    ? (creationQuery.data ??
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
  const permissionReason = authorization.allowed.operations
    ? null
    : authorization.paused
      ? "権限を確認できるまで操作できません。"
      : "運用担当の権限が必要です。";
  const busyReason =
    permissionReason ??
    (command.isPending || checkingOperation
      ? "操作を受け付けています。"
      : communicationUnknown
        ? "操作の状態を確認してください。"
        : null);
  const operationReason =
    busyReason ?? (operationInProgress ? "現在の処理の完了を確認してください。" : null);
  const candidateActive =
    candidate && ["pending", "ready", "unavailable", "failed"].includes(candidate.status);

  const submit = (request: SeriesPlayerRadarCommand) => {
    if (commandPending.current) return;
    const lease = authorization.begin("operations");
    if (!lease) return;
    commandPending.current = true;
    command.mutate({ request, lease });
  };
  const submitAsync = async (request: SeriesPlayerRadarCommand) => {
    if (commandPending.current) throw new Error("操作を受け付けています。");
    const lease = authorization.begin("operations");
    if (!lease) throw new DOMException("権限を確認できません", "AbortError");
    commandPending.current = true;
    const response = await command.mutateAsync({ request, lease });
    if (!mounted.current || !authorization.canCommit(lease))
      throw new DOMException("権限を確認できません", "AbortError");
    return response;
  };
  const refresh = async () => {
    const lease = authorization.begin("operations");
    if (!lease) return;
    setCheckError(undefined);
    if (creationAccepted && creationQuery.isError) await creationQuery.refetch();
    if (!mounted.current || !authorization.canCommit(lease)) return;
    const result = await stateQuery.refetch();
    if (!mounted.current || !authorization.canCommit(lease)) return;
    await optionsQuery.refetch();
    if (!mounted.current || !authorization.canCommit(lease)) return;
    if (result.data?.candidate?.latestPreview?.previewId === previewId && previewId)
      await previewQuery.refetch();
    await editingEvaluation.refresh();
    if (!mounted.current || !authorization.canCommit(lease)) return;
    if (result.isSuccess && conflictNeedsRefresh) command.reset();
  };
  const checkOperation = async () => {
    if (checkingOperation || commandPending.current) return;
    const lease = authorization.begin("operations");
    if (!lease) return;
    setCheckingOperation(true);
    setCheckError(undefined);
    try {
      if (communicationUnknown && submittedRequest) {
        // The same key recovers the durable acceptance when its response was lost.
        await submitAsync(submittedRequest);
      } else if (latestOperation) {
        await queryClient.fetchQuery(
          seriesPlayerRadarOperationQueryOptions(gameTitleId, latestOperation.operationId),
        );
        if (!mounted.current || !authorization.canCommit(lease)) return;
        await stateQuery.refetch();
      }
    } catch (error) {
      if (mounted.current && authorization.isCurrent(lease)) {
        setCheckError(error);
        authorization.reportError(error, lease);
      }
    } finally {
      setCheckingOperation(false);
    }
  };

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
          },
          maps,
        )
      : null;
  const preview = previewQuery.data;
  const previewState = preview?.status ?? candidate?.latestPreview?.status ?? "none";
  const beforeBasis =
    preview?.beforeBasisId === currentBasis?.basisId
      ? currentBasis
      : preview?.beforeBasisId === previousBasis?.basisId
        ? previousBasis
        : null;
  const previewDisplay: PlayerRadarPreviewModel | null =
    previewId && candidateBasis
      ? {
          previewId,
          createdAt:
            preview?.createdAt ?? candidate?.latestPreview?.createdAt ?? candidate.createdAt,
          evaluationState:
            previewQuery.isFetching && !preview
              ? "loading"
              : previewQuery.isError
                ? "error"
                : preview
                  ? preview.scope.state === "empty"
                    ? "empty"
                    : preview.scope.state === "awaiting_analysis"
                      ? "awaiting_analysis"
                      : "ready"
                  : "loading",
          before: preview?.before
            ? playerRadarEvaluationDisplay(preview.before, beforeBasis, maps)
            : null,
          after: preview?.after
            ? playerRadarEvaluationDisplay(preview.after, candidateBasis, maps)
            : null,
          beforeBasis,
          candidateBasis,
        }
      : null;

  const preparedEvaluation: RadarEditingModel["evaluation"] =
    previewDisplay?.after &&
    preview?.status === "ready" &&
    (preview.beforeBasisId ?? null) === (currentBasis?.basisId ?? null) &&
    !previewQuery.isError
      ? {
          key: `${preview.previewId}:${preview.inputRevision}:${scope.seasonMasterId}:${scope.mapMasterId}`,
          before: previewDisplay.before,
          raw: previewDisplay.after,
          createdAt: preview.createdAt,
        }
      : null;
  const editingEvaluation = useRadarEditingEvaluation({
    active: editorActive && authorization.allowed.operations,
    gameTitleId,
    currentBasisId: currentBasis?.basisId ?? null,
    scope,
    prepared: preparedEvaluation,
  });
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
          input: candidate.manualInput ?? radarBasisInput(editableBasis),
          sourceBasisId: manualSourceBasisId ?? editableBasis.basisId,
          sourceCandidateId: candidate.manualInput
            ? candidate.sourceCandidateId
            : candidate.candidateId,
          expectedCurrentBasisId: currentBasis?.basisId ?? null,
          expectedCandidateId,
          savedCandidateId: candidate.candidateId,
        }
      : null;

  const applyDisabledReason =
    operationReason ??
    (conflictNeedsRefresh ? "基準の状態を更新し、最新の比較を確認してください。" : null) ??
    (candidate?.status === "ready"
      ? previewState === "ready"
        ? previewQuery.isFetching || stateQuery.isFetching
          ? "最新の状態を読み込んでいます。"
          : previewQuery.isError || stateQuery.isError
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
  const feedbackError =
    checkError ??
    (creationAccepted && creationQuery.isError ? creationQuery.error : null) ??
    (communicationUnknown ? null : commandError) ??
    (shouldShowQueryError(stateQuery) ? stateQuery.error : null) ??
    (shouldShowQueryError(optionsQuery) ? optionsQuery.error : null);
  const normalizedError = feedbackError ? normalizeDisplayApiError(feedbackError) : null;
  const feedback: PlayerRadarAdminModel["feedback"] = normalizedError
    ? { title: normalizedError.title, detail: normalizedError.detail, tone: "warning" }
    : accepted && latestOperation?.status === "succeeded"
      ? {
          title: radarOperationPresentation(acceptedOperation ?? accepted).title,
          detail: "",
          tone: "success",
        }
      : null;

  const model: PlayerRadarAdminModel | null = state
    ? {
        authorizationRevision: authorization.revision,
        editing: {
          acceptedApply:
            accepted?.kind === "apply" &&
            accepted.candidateId &&
            ["pending", "running", "succeeded"].includes(accepted.status) &&
            command.variables &&
            authorization.canCommit(command.variables.lease)
              ? { operationId: accepted.operationId, candidateId: accepted.candidateId }
              : null,
          acceptedSave:
            accepted?.candidateId &&
            submittedRequest?.kind === "manual" &&
            submittedRequest.manualInput &&
            submittedRequest.sourceBasisId &&
            command.variables &&
            authorization.canCommit(command.variables.lease)
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
                    },
                  },
                }
              : null,
          current: currentEditingSource,
          candidate: candidateEditingSource,
          evaluation: editingEvaluation.evaluation,
          evaluationMessage: editingEvaluation.message,
          evaluationUpdating: editingEvaluation.loading || previewQuery.isFetching,
          permissionReason,
          saveDisabledReason:
            operationReason ?? (conflictNeedsRefresh ? "基準の状態を更新してください。" : null),
          onActiveChange: setEditorActive,
          save: async (request) => {
            if (operationReason) throw new Error(operationReason);
            const response = await submitAsync({ gameTitleId, kind: "manual", ...request });
            if (!response.candidateId) throw new Error("保存済みの案を確認できません。");
            return { candidateId: response.candidateId, operationId: response.operationId };
          },
          discard: async (prepared) => {
            const lease = authorization.begin("operations");
            if (!lease) throw new DOMException("権限を確認できません", "AbortError");
            try {
              await submitAsync({
                gameTitleId,
                kind: "withdraw",
                candidateId: prepared.candidateId,
                originOperationId: prepared.operationId,
              });
            } catch (error) {
              if (normalizeUnknownApiError(error).status !== 409) throw error;
              if (!mounted.current || !authorization.canCommit(lease))
                throw new DOMException("権限を確認できません", "AbortError");
              // The save receipt can precede the state cache. Only a fresh read after
              // the guarded rejection can prove this edit no longer owns a live draft.
              const result = await stateQuery.refetch({ throwOnError: true });
              if (!mounted.current || !authorization.canCommit(lease))
                throw new DOMException("権限を確認できません", "AbortError");
              const fresh = result.isSuccess ? result.data : undefined;
              const freshCandidate = fresh?.candidate;
              const superseded =
                freshCandidate &&
                (freshCandidate.candidateId !== prepared.candidateId ||
                  ["withdrawn", "applied"].includes(freshCandidate.status));
              const applicationAccepted = fresh?.operations.some(
                (operation) =>
                  operation.kind === "apply" && operation.candidateId === prepared.candidateId,
              );
              if (
                !fresh ||
                fresh.gameTitleId !== gameTitleId ||
                (!superseded && !applicationAccepted)
              )
                throw error;
              // Preserve the newer/shared server candidate; only this local edit ends.
              command.reset();
            }
          },
          reuseCandidate: async (id) => {
            if (candidate?.candidateId !== id || operationReason)
              throw new Error("最新の共有案を確認してください。");
            if (previewState !== "ready")
              await submitAsync({ gameTitleId, kind: "preview", candidateId: id });
          },
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
        previewUpdating: previewQuery.isFetching,
        operation: latestOperation ? radarOperationPresentation(latestOperation) : null,
        review: radarReviewPresentation(state),
        feedback,
        communicationUnknown,
        applyDisabledReason,
        applyPending: command.isPending && submittedRequest?.kind === "apply",
        autoEditCandidateId: creationAccepted?.candidateId ?? null,
        creationPending:
          (command.isPending &&
            (submittedRequest?.kind === "candidate" || submittedRequest?.kind === "restore")) ||
          Boolean(
            creationAccepted &&
            !creationQuery.isError &&
            (acceptedOperation?.status === "pending" ||
              acceptedOperation?.status === "running" ||
              (acceptedOperation?.status === "succeeded" &&
                stateQuery.isFetching &&
                candidate?.status !== "ready")),
          ),
        actions: {
          refresh: {
            disabledReason:
              permissionReason ??
              (stateQuery.isFetching || previewQuery.isFetching || command.isPending
                ? "状態を更新中です。"
                : null),
            pending: stateQuery.isFetching || previewQuery.isFetching,
            run: refresh,
          },
          generate: {
            pending: command.isPending && submittedRequest?.kind === "candidate",
            disabledReason:
              operationReason ??
              (candidateActive ? "現在の変更案を確認または取り下げてください。" : missingRecords),
            run: () => submit({ gameTitleId, kind: "candidate" }),
          },
          rebuildPreview: {
            pending: command.isPending && submittedRequest?.kind === "preview",
            disabledReason: operationReason,
            run: () => {
              if (candidate)
                submit({ gameTitleId, kind: "preview", candidateId: candidate.candidateId });
            },
          },
          withdraw: {
            pending: command.isPending && submittedRequest?.kind === "withdraw",
            disabledReason: busyReason,
            run: async () => {
              if (candidate)
                await submitAsync({
                  gameTitleId,
                  kind: "withdraw",
                  candidateId: candidate.candidateId,
                });
            },
          },
          restore: {
            pending: command.isPending && submittedRequest?.kind === "restore",
            disabledReason:
              operationReason ??
              (candidateActive ? "現在の変更案を確認または取り下げてください。" : null),
            run: () =>
              submit({
                gameTitleId,
                kind: "restore",
                ...(currentBasis ? { expectedCurrentBasisId: currentBasis.basisId } : {}),
              }),
          },
          retry: {
            pending: command.isPending && submittedRequest?.kind === "retry",
            disabledReason:
              operationReason ??
              (!candidate?.manualInput &&
              (candidate?.status === "invalid" || candidate?.status === "unavailable")
                ? "変更案を取り下げ、最新の記録から作り直してください。"
                : null),
            run: () => {
              if (latestOperation)
                submit({
                  gameTitleId,
                  kind: "retry",
                  originOperationId: latestOperation.operationId,
                });
            },
          },
          checkOperation: {
            disabledReason:
              permissionReason ??
              (checkingOperation || command.isPending ? "操作を確認中です。" : null),
            pending: checkingOperation,
            run: checkOperation,
          },
          apply: async (target: PlayerRadarApplyTarget) => {
            if (target.gameTitleId !== gameTitleId || applyDisabledReason)
              throw new Error("最新の比較を確認してください。");
            await submitAsync({
              gameTitleId: target.gameTitleId,
              kind: "apply",
              candidateId: target.candidateId,
              previewId: target.previewId,
              ...(target.expectedCurrentBasisId
                ? { expectedCurrentBasisId: target.expectedCurrentBasisId }
                : {}),
            });
          },
          acknowledge: (evidenceKey) => submit({ gameTitleId, kind: "acknowledge", evidenceKey }),
          selectSeason: (seasonMasterId) => {
            if (!authorization.begin("operations")) return;
            setScope((current) => ({
              ...current,
              seasonMasterId,
              seasonName:
                title?.seasons.find((season) => season.seasonMasterId === seasonMasterId)
                  ?.displayName ?? current.seasonName,
            }));
          },
          selectMap: (mapMasterId) => {
            if (!authorization.begin("operations")) return;
            setScope((current) => ({
              ...current,
              mapMasterId,
              mapName:
                maps.find((map) => map.mapMasterId === mapMasterId)?.displayName ?? current.mapName,
            }));
          },
          resetPreviewFilter: () => {
            if (authorization.begin("operations"))
              setScope({ seasonMasterId: "", mapMasterId: "", seasonName: "", mapName: "" });
          },
        },
      }
    : null;

  return {
    model,
    loading: isInitialQueryLoading(stateQuery),
    error: shouldShowQueryError(stateQuery) ? normalizeDisplayApiError(stateQuery.error) : null,
    refreshing: stateQuery.isFetching,
    refresh,
  };
}
