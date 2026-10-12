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
  const operations = state?.operations ?? [];
  const acceptedOperation = accepted
    ? (operations.find((operation) => operation.operationId === accepted.operationId) ?? accepted)
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
    candidate && candidate.status !== "applied" && candidate.status !== "withdrawn";

  const submit = (request: SeriesPlayerRadarCommand) => {
    if (commandPending.current) return;
    const lease = authorization.begin("operations");
    if (!lease) return;
    commandPending.current = true;
    command.mutate({ request, lease });
  };
  const submitAsync = async (request: SeriesPlayerRadarCommand) => {
    if (commandPending.current) return;
    const lease = authorization.begin("operations");
    if (!lease) throw new DOMException("権限を確認できません", "AbortError");
    commandPending.current = true;
    await command.mutateAsync({ request, lease });
  };
  const refresh = async () => {
    const lease = authorization.begin("operations");
    if (!lease) return;
    setCheckError(undefined);
    const result = await stateQuery.refetch();
    if (!mounted.current || !authorization.canCommit(lease)) return;
    await optionsQuery.refetch();
    if (!mounted.current || !authorization.canCommit(lease)) return;
    if (result.data?.candidate?.latestPreview?.previewId === previewId && previewId)
      await previewQuery.refetch();
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
                : !preview
                  ? "loading"
                  : preview.scope.state === "empty"
                    ? "empty"
                    : preview.scope.state === "awaiting_analysis"
                      ? "awaiting_analysis"
                      : "ready",
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

  const applyDisabledReason =
    operationReason ??
    (conflictNeedsRefresh ? "基準の状態を更新し、最新の比較を確認してください。" : null) ??
    (candidate?.status !== "ready"
      ? "有効な変更案が必要です。"
      : previewState !== "ready"
        ? "最新の記録で比較を計算し、内容を確認してください。"
        : previewQuery.isFetching || stateQuery.isFetching
          ? "最新の状態を読み込んでいます。"
          : previewQuery.isError || stateQuery.isError
            ? "比較と基準の状態を再読み込みしてください。"
            : null);
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
    (!communicationUnknown ? commandError : null) ??
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
        gameTitleId,
        gameTitleName,
        currentBasis,
        previousBasis,
        eligibility: state.eligibility,
        candidate: candidate
          ? {
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
            run: () =>
              candidate
                ? submitAsync({ gameTitleId, kind: "withdraw", candidateId: candidate.candidateId })
                : undefined,
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
              (candidate?.status === "invalid" || candidate?.status === "unavailable"
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
