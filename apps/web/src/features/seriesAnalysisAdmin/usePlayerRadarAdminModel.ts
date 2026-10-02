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
  getSeriesPlayerRadarOperation,
  requestSeriesPlayerRadarOperation,
  seriesPlayerRadarPreviewQueryOptions,
  seriesPlayerRadarStateQueryOptions,
} from "@/shared/api/seriesPlayerRadar";
import type { SeriesPlayerRadarCommand } from "@/shared/api/seriesPlayerRadar";
import { useIdempotencyKeyStore } from "@/shared/api/useIdempotencyKeyStore";
import {
  playerRadarBasisDisplay,
  playerRadarEvaluationDisplay,
  playerRadarSampleDisplay,
} from "@/shared/seriesAnalysis/playerRadarDisplay";

/** Each mounted instance owns one title; scope changes never retarget a submitted command. */
export function usePlayerRadarAdminModel(
  gameTitleId: string,
  gameTitleName: string,
  onApplyAccepted?: (operationId: string) => void,
) {
  const queryClient = useQueryClient();
  const keys = useIdempotencyKeyStore();
  const commandPending = useRef(false);
  const mounted = useRef(false);
  const notifiedApplication = useRef<string | null>(null);
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
  const stateQuery = useQuery(seriesPlayerRadarStateQueryOptions(gameTitleId));
  const state = stateQuery.data;
  const title = optionsQuery.data?.titles.find((entry) => entry.gameTitleId === gameTitleId);
  const maps = title?.maps ?? [];
  const candidate = state?.candidate;
  const previewId = candidate?.latestPreview?.previewId;
  const previewQuery = useQuery(
    seriesPlayerRadarPreviewQueryOptions(
      previewId
        ? {
            gameTitleId,
            previewId,
            seasonMasterId: scope.seasonMasterId || undefined,
            mapMasterId: scope.mapMasterId || undefined,
          }
        : undefined,
    ),
  );

  const command = useMutation({
    mutationFn: (request: SeriesPlayerRadarCommand) =>
      runIdempotentMutation(keys, "seriesAnalysis.radarOperation", request, (options) =>
        requestSeriesPlayerRadarOperation(request, options),
      ),
    onMutate: () => setCheckError(undefined),
    onSuccess: (response, request) => {
      queryClient.setQueryData(
        seriesPlayerRadarKeys.operation(request.gameTitleId, response.operationId),
        response,
      );
      // Acceptance is durable before these reads. A slow or failed refresh must not keep
      // the confirmation dialog submitting or change the acknowledged operation outcome.
      void Promise.all([
        queryClient.invalidateQueries({
          queryKey: seriesPlayerRadarKeys.title(request.gameTitleId),
        }),
        queryClient.invalidateQueries({ queryKey: seriesAnalysisKeys.adminRoot() }),
        queryClient.invalidateQueries({ queryKey: seriesAnalysisKeys.statusRoot() }),
        queryClient.invalidateQueries({ queryKey: seriesPlayerRadarKeys.scopeStatusRoot() }),
      ]);
      if (
        request.kind === "apply" &&
        ["pending", "running", "succeeded"].includes(response.status) &&
        mounted.current &&
        notifiedApplication.current !== response.operationId
      ) {
        notifiedApplication.current = response.operationId;
        onApplyAccepted?.(response.operationId);
      }
    },
    onSettled: () => {
      commandPending.current = false;
    },
  });

  const accepted = command.data;
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
  const communicationUnknown = radarSubmissionUncertain(command.error);
  const conflictNeedsRefresh =
    !communicationUnknown &&
    command.error &&
    normalizeUnknownApiError(command.error).status === 409;
  const busyReason =
    command.isPending || checkingOperation
      ? "操作を受け付けています。"
      : communicationUnknown
        ? "操作の状態を確認してください。"
        : null;
  const operationReason =
    busyReason ?? (operationInProgress ? "現在の処理の完了を確認してください。" : null);
  const candidateActive =
    candidate && candidate.status !== "applied" && candidate.status !== "withdrawn";

  const submit = (request: SeriesPlayerRadarCommand) => {
    if (commandPending.current) return;
    commandPending.current = true;
    command.mutate(request);
  };
  const submitAsync = async (request: SeriesPlayerRadarCommand) => {
    if (commandPending.current) return;
    commandPending.current = true;
    await command.mutateAsync(request);
  };
  const refresh = async () => {
    setCheckError(undefined);
    const result = await stateQuery.refetch();
    await optionsQuery.refetch();
    if (result.data?.candidate?.latestPreview?.previewId === previewId && previewId)
      await previewQuery.refetch();
    if (result.isSuccess && conflictNeedsRefresh) command.reset();
  };
  const checkOperation = async () => {
    if (checkingOperation || commandPending.current) return;
    setCheckingOperation(true);
    setCheckError(undefined);
    try {
      if (communicationUnknown && command.variables) {
        // The same key recovers the durable acceptance when its response was lost.
        await submitAsync(command.variables);
      } else if (latestOperation) {
        const result = await getSeriesPlayerRadarOperation(
          gameTitleId,
          latestOperation.operationId,
        );
        queryClient.setQueryData(
          seriesPlayerRadarKeys.operation(gameTitleId, result.operationId),
          result,
        );
        await stateQuery.refetch();
      }
    } catch (error) {
      setCheckError(error);
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
    (!communicationUnknown ? command.error : null) ??
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
        applyPending: command.isPending && command.variables?.kind === "apply",
        actions: {
          refresh: {
            disabledReason:
              stateQuery.isFetching || previewQuery.isFetching || command.isPending
                ? "状態を更新中です。"
                : null,
            pending: stateQuery.isFetching || previewQuery.isFetching,
            run: refresh,
          },
          generate: {
            pending: command.isPending && command.variables?.kind === "candidate",
            disabledReason:
              operationReason ??
              (candidateActive ? "現在の変更案を確認または取り下げてください。" : missingRecords),
            run: () => submit({ gameTitleId, kind: "candidate" }),
          },
          rebuildPreview: {
            pending: command.isPending && command.variables?.kind === "preview",
            disabledReason: operationReason,
            run: () => {
              if (candidate)
                submit({ gameTitleId, kind: "preview", candidateId: candidate.candidateId });
            },
          },
          withdraw: {
            pending: command.isPending && command.variables?.kind === "withdraw",
            disabledReason: busyReason,
            run: () =>
              candidate
                ? submitAsync({ gameTitleId, kind: "withdraw", candidateId: candidate.candidateId })
                : undefined,
          },
          restore: {
            pending: command.isPending && command.variables?.kind === "restore",
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
            pending: command.isPending && command.variables?.kind === "retry",
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
            disabledReason: checkingOperation || command.isPending ? "操作を確認中です。" : null,
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
          selectSeason: (seasonMasterId) =>
            setScope((current) => ({
              ...current,
              seasonMasterId,
              seasonName:
                title?.seasons.find((season) => season.seasonMasterId === seasonMasterId)
                  ?.displayName ?? current.seasonName,
            })),
          selectMap: (mapMasterId) =>
            setScope((current) => ({
              ...current,
              mapMasterId,
              mapName:
                maps.find((map) => map.mapMasterId === mapMasterId)?.displayName ?? current.mapName,
            })),
          resetPreviewFilter: () =>
            setScope({ seasonMasterId: "", mapMasterId: "", seasonName: "", mapName: "" }),
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
