import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { isRadarOperationInProgress } from "@/features/seriesAnalysisAdmin/radar/playerRadarAdminPresentation";
import type {
  RadarAdminResource,
  RadarPreviewScope,
} from "@/features/seriesAnalysisAdmin/radar/playerRadarAdminTypes";
import { achievementResourceQueryOptions } from "@/shared/api/achievementQueryOptions";
import type { AchievementResource } from "@/shared/api/achievements";
import { runIdempotentMutation } from "@/shared/api/idempotency";
import { isInitialQueryLoading, shouldShowQueryError } from "@/shared/api/queryErrorState";
import { seriesAnalysisKeys, seriesPlayerRadarKeys } from "@/shared/api/queryKeys";
import type { SeriesComparisonAggregate } from "@/shared/api/seriesAnalysis";
import {
  seriesAnalysisAggregateQueryOptions,
  seriesAnalysisOptionsQueryOptions,
  seriesAnalysisStatusQueryOptions,
} from "@/shared/api/seriesAnalysisQueryOptions";
import { requestSeriesPlayerRadarOperation } from "@/shared/api/seriesPlayerRadar";
import type {
  SeriesAnalysisScopeStatus,
  SeriesAnalysisScopeStatusQuery,
  SeriesPlayerRadarCommand,
  SeriesPlayerRadarOperation,
  SeriesPlayerRadarState,
} from "@/shared/api/seriesPlayerRadar";
import type {
  PlayerRadarHistoryQuery,
  PlayerRadarRevisionDetail,
  PlayerRadarRevisionList,
} from "@/shared/api/seriesPlayerRadarHistory";
import {
  playerRadarHistoryQueryOptions,
  playerRadarRevisionQueryOptions,
  seriesAnalysisScopeStatusQueryOptions,
  seriesPlayerRadarOperationQueryOptions,
  seriesPlayerRadarPreviewQueryOptions,
  seriesPlayerRadarStateQueryOptions,
} from "@/shared/api/seriesPlayerRadarQueryOptions";
import { useIdempotencyKeyStore } from "@/shared/api/useIdempotencyKeyStore";
import type { AuthorizationAccess, AuthorizationLease } from "@/shared/auth/authorization";
import { canReadProtectedQuery } from "@/shared/auth/authorizationQueryAdapter";

type RadarCommandRequest = { request: SeriesPlayerRadarCommand; lease: AuthorizationLease };
type RadarEvaluationTarget = SeriesAnalysisScopeStatusQuery & { artifactId: string };

type RadarAdministrationReads = {
  resource: RadarAdminResource;
  loading: boolean;
  errors: { state: unknown; options: unknown };
  refreshState: () => Promise<{ state: SeriesPlayerRadarState | undefined; confirmed: boolean }>;
  confirmState: () => Promise<SeriesPlayerRadarState | undefined>;
  refreshOptions: () => Promise<void>;
  refreshPreview: () => Promise<void>;
  readOperation: (operationId: string) => Promise<void>;
  publishAcceptance: (
    request: SeriesPlayerRadarCommand,
    response: SeriesPlayerRadarOperation,
  ) => void;
  refreshAfterCreation: () => void;
};

/** Owns protected reads and their cache reconciliation for one mounted title. */
export function useRadarAdministrationReads(
  gameTitleId: string,
  scope: RadarPreviewScope,
  authorization: AuthorizationAccess,
): RadarAdministrationReads {
  const queryClient = useQueryClient();
  const optionsQuery = useQuery(seriesAnalysisOptionsQueryOptions());
  const stateOptions = seriesPlayerRadarStateQueryOptions(gameTitleId);
  const canReadState = canReadProtectedQuery(
    authorization,
    queryClient,
    "operations",
    stateOptions.queryKey,
  );
  const stateQuery = useQuery({
    ...stateOptions,
    enabled: () =>
      canReadState &&
      canReadProtectedQuery(authorization, queryClient, "operations", stateOptions.queryKey),
  });
  const state = authorization.retained.operations ? stateQuery.data : undefined;
  const title = optionsQuery.data?.titles.find((entry) => entry.gameTitleId === gameTitleId);
  const previewId = state?.candidate?.latestPreview?.previewId;
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
      canReadProtectedQuery(authorization, queryClient, "operations", previewOptions.queryKey),
  });
  const publishAcceptance = useCallback(
    (request: SeriesPlayerRadarCommand, response: SeriesPlayerRadarOperation) => {
      queryClient.setQueryData(
        seriesPlayerRadarKeys.operation(request.gameTitleId, response.operationId),
        response,
      );
      // Accepted commands finish before the refreshed reads settle.
      void Promise.all([
        queryClient.invalidateQueries({
          queryKey: seriesPlayerRadarKeys.title(request.gameTitleId),
        }),
        queryClient.invalidateQueries({ queryKey: seriesAnalysisKeys.adminRoot() }),
        queryClient.invalidateQueries({ queryKey: seriesAnalysisKeys.statusRoot() }),
        queryClient.invalidateQueries({ queryKey: seriesPlayerRadarKeys.scopeStatusRoot() }),
      ]);
    },
    [queryClient],
  );
  const refreshAfterCreation = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: seriesPlayerRadarKeys.title(gameTitleId) });
  }, [gameTitleId, queryClient]);
  return {
    resource: {
      state,
      title,
      scope,
      preview: previewQuery.data,
      previewFetching: previewQuery.isFetching,
      previewFailed: previewQuery.isError,
      stateFetching: stateQuery.isFetching,
      stateFailed: stateQuery.isError,
    },
    loading: isInitialQueryLoading(stateQuery),
    errors: {
      state: shouldShowQueryError(stateQuery) ? stateQuery.error : null,
      options: shouldShowQueryError(optionsQuery) ? optionsQuery.error : null,
    },
    refreshState: async () => {
      const result = await stateQuery.refetch();
      return { state: result.data, confirmed: result.isSuccess };
    },
    confirmState: async () => {
      const result = await stateQuery.refetch({ throwOnError: true });
      return result.isSuccess ? result.data : undefined;
    },
    refreshOptions: async () => {
      await optionsQuery.refetch();
    },
    refreshPreview: async () => {
      await previewQuery.refetch();
    },
    readOperation: async (operationId) => {
      await queryClient.fetchQuery(
        seriesPlayerRadarOperationQueryOptions(gameTitleId, operationId),
      );
    },
    publishAcceptance,
    refreshAfterCreation,
  };
}

/** Keeps transport retries and mutation state behind the radar command contract. */
export function useRadarCommandSubmission({
  canSubmit,
  onStart,
  onFailure,
  onFinish,
}: {
  canSubmit: (request: RadarCommandRequest) => boolean;
  onStart: () => void;
  onFailure: (error: unknown, request: RadarCommandRequest) => void;
  onFinish: () => void;
}): {
  submitted: RadarCommandRequest | undefined;
  accepted: SeriesPlayerRadarOperation | undefined;
  error: unknown;
  pending: boolean;
  submit: (request: RadarCommandRequest) => void;
  submitAndWait: (request: RadarCommandRequest) => Promise<SeriesPlayerRadarOperation>;
  clear: () => void;
} {
  const keys = useIdempotencyKeyStore();
  const mutation = useMutation({
    mutationFn: (submitted: RadarCommandRequest) => {
      if (!canSubmit(submitted)) throw new DOMException("権限を確認できません", "AbortError");
      return runIdempotentMutation(
        keys,
        "seriesAnalysis.radarOperation",
        submitted.request,
        (options) => requestSeriesPlayerRadarOperation(submitted.request, options),
      );
    },
    onMutate: onStart,
    onError: onFailure,
    onSettled: onFinish,
  });
  return {
    submitted: mutation.variables,
    accepted: mutation.data,
    error: mutation.error,
    pending: mutation.isPending,
    submit: mutation.mutate,
    submitAndWait: mutation.mutateAsync,
    clear: mutation.reset,
  };
}

export function useRadarCreationRead(
  gameTitleId: string,
  accepted: SeriesPlayerRadarOperation | undefined,
  authorization: AuthorizationAccess,
): {
  operation: SeriesPlayerRadarOperation | undefined;
  failed: boolean;
  error: unknown;
  refresh: () => Promise<void>;
} {
  const queryClient = useQueryClient();
  const options = seriesPlayerRadarOperationQueryOptions(gameTitleId, accepted?.operationId ?? "");
  const query = useQuery({
    ...options,
    enabled: (observed) =>
      Boolean(accepted) &&
      canReadProtectedQuery(authorization, queryClient, "operations", options.queryKey) &&
      isRadarOperationInProgress(observed.state.data?.status ?? accepted?.status),
    refetchOnWindowFocus: false,
    refetchIntervalInBackground: false,
    refetchInterval: (observed) =>
      observed.state.status !== "error" &&
      isRadarOperationInProgress(observed.state.data?.status ?? accepted?.status)
        ? 2000
        : false,
  });
  return {
    operation: query.data,
    failed: query.isError,
    error: query.isError ? query.error : null,
    refresh: async () => {
      await query.refetch();
    },
  };
}

export function useRadarHistoryRead(
  { revisionId, ...filters }: PlayerRadarHistoryQuery & { revisionId: string | undefined },
  authorization: Pick<AuthorizationAccess, "can" | "allowed">,
): {
  data: PlayerRadarRevisionList | undefined;
  revision: PlayerRadarRevisionDetail | undefined;
  loading: boolean;
  refreshing: boolean;
  error: unknown;
  hasData: boolean;
  refresh: () => Promise<void>;
} {
  const queryClient = useQueryClient();
  const listOptions = playerRadarHistoryQueryOptions(filters);
  const detailOptions = playerRadarRevisionQueryOptions(revisionId);
  const listQuery = useQuery({
    ...listOptions,
    enabled: () =>
      !revisionId &&
      canReadProtectedQuery(authorization, queryClient, "operations", listOptions.queryKey),
  });
  const revisionQuery = useQuery({
    ...detailOptions,
    enabled: () =>
      Boolean(revisionId) &&
      canReadProtectedQuery(authorization, queryClient, "operations", detailOptions.queryKey),
  });
  const activeQuery = revisionId ? revisionQuery : listQuery;
  return {
    data: authorization.allowed.operations ? listQuery.data : undefined,
    revision: authorization.allowed.operations ? revisionQuery.data : undefined,
    loading: isInitialQueryLoading(activeQuery),
    refreshing: activeQuery.isFetching,
    error: shouldShowQueryError(activeQuery) ? activeQuery.error : undefined,
    hasData: Boolean(activeQuery.data),
    refresh: async () => {
      await activeQuery.refetch();
    },
  };
}

/** Saved scope metrics are independent from the editor's threshold inputs. */
export function useRadarEvaluationRead({
  enabled,
  gameTitleId,
  scope,
}: {
  enabled: boolean;
  gameTitleId: string;
  scope: Pick<RadarPreviewScope, "seasonMasterId" | "mapMasterId">;
}): {
  target: RadarEvaluationTarget | undefined;
  aggregate: SeriesComparisonAggregate | undefined;
  achievements: AchievementResource | undefined;
  scopeState: SeriesAnalysisScopeStatus["state"] | undefined;
  fetching: boolean;
  failed: boolean;
  refreshPublication: () => Promise<string | undefined>;
  refreshScope: (target: RadarEvaluationTarget) => Promise<SeriesAnalysisScopeStatus["state"]>;
  refreshEvaluation: (target: RadarEvaluationTarget) => Promise<void>;
} {
  const queryClient = useQueryClient();
  const statusQuery = useQuery({ ...seriesAnalysisStatusQueryOptions(gameTitleId), enabled });
  const artifact = statusQuery.data?.currentArtifact;
  const target =
    enabled && artifact
      ? {
          gameTitleId,
          artifactId: artifact.artifactId,
          seasonMasterId: scope.seasonMasterId || undefined,
          mapMasterId: scope.mapMasterId || undefined,
        }
      : undefined;
  const scopeQuery = useQuery(seriesAnalysisScopeStatusQueryOptions(target));
  const achievementQuery = useQuery({
    ...achievementResourceQueryOptions(target?.gameTitleId, target?.artifactId),
    placeholderData: () => undefined,
  });
  const aggregateQuery = useQuery({
    ...seriesAnalysisAggregateQueryOptions(
      scopeQuery.data?.state === "available" ? target : undefined,
    ),
    // A new scope never borrows the previous scope's scores while loading.
    placeholderData: () => undefined,
  });
  return {
    target,
    aggregate: aggregateQuery.data,
    achievements: achievementQuery.data,
    scopeState: scopeQuery.data?.state,
    fetching:
      statusQuery.isFetching ||
      scopeQuery.isFetching ||
      aggregateQuery.isFetching ||
      achievementQuery.isFetching,
    failed:
      statusQuery.isError ||
      scopeQuery.isError ||
      aggregateQuery.isError ||
      achievementQuery.isError,
    refreshPublication: async () => {
      const status = await statusQuery.refetch({ cancelRefetch: false });
      return status.isSuccess ? status.data.currentArtifact?.artifactId : undefined;
    },
    refreshScope: async (capturedTarget) => {
      const status = await queryClient.fetchQuery({
        ...seriesAnalysisScopeStatusQueryOptions(capturedTarget),
        staleTime: 0,
      });
      return status.state;
    },
    refreshEvaluation: async (capturedTarget) => {
      await Promise.all([
        queryClient.refetchQueries(
          {
            queryKey: seriesAnalysisAggregateQueryOptions(capturedTarget).queryKey,
            exact: true,
            type: "active",
          },
          { cancelRefetch: false },
        ),
        queryClient.refetchQueries(
          {
            queryKey: achievementResourceQueryOptions(
              capturedTarget.gameTitleId,
              capturedTarget.artifactId,
            ).queryKey,
            exact: true,
            type: "active",
          },
          { cancelRefetch: false },
        ),
      ]);
    },
  };
}
