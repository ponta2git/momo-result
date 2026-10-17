import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import type {
  RadarAdminResource,
  RadarAdminHandlers,
  RadarEditingHandlers,
} from "@/features/seriesAnalysisAdmin/playerRadarAdminModel";
import {
  radarBasisPresentation,
  radarOperationState,
  radarDraftNoLongerOwned,
} from "@/features/seriesAnalysisAdmin/playerRadarAdminPresentation";
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
import type { AuthorizationLease, AuthorizationAccess } from "@/shared/auth/authorization";

type RadarCommandRequest = { request: SeriesPlayerRadarCommand; lease: AuthorizationLease };

/** Each mounted instance owns one title; scope changes never retarget a submitted command. */
export function usePlayerRadarAdminOwner(
  gameTitleId: string,
  authorization: AuthorizationAccess,
  onApplyAccepted?: (operationId: string) => void,
) {
  const queryClient = useQueryClient();
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
  const resource: RadarAdminResource = {
    state,
    title,
    scope,
    preview: previewQuery.data,
    previewFetching: previewQuery.isFetching,
    previewFailed: previewQuery.isError,
    stateFetching: stateQuery.isFetching,
    stateFailed: stateQuery.isError,
  };
  const basis = radarBasisPresentation(resource);
  const operation = radarOperationState({
    resource,
    previewState: basis.previewState,
    accepted,
    creationOperation: creationQuery.data,
    commandError,
    pending: command.isPending,
    checkingOperation,
    allowed: authorization.allowed.operations,
    paused: authorization.paused,
  });
  const {
    latestOperation,
    communicationUnknown,
    conflictNeedsRefresh,
    operationReason,
    applyDisabledReason,
  } = operation;
  const { currentBasis, previewState } = basis;
  const editingEvaluation = useRadarEditingEvaluation({
    active: editorActive && authorization.allowed.operations,
    gameTitleId,
    currentBasisId: currentBasis?.basisId ?? null,
    scope,
    prepared: basis.preparedEvaluation,
  });
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
    await editingEvaluation.refresh(() => mounted.current && authorization.canCommit(lease));
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

  const editingHandlers: RadarEditingHandlers = {
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
        if (!radarDraftNoLongerOwned(fresh, gameTitleId, prepared.candidateId)) throw error;
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
  };
  const handlers: RadarAdminHandlers = {
    refresh,
    generate: () => submit({ gameTitleId, kind: "candidate" }),
    rebuildPreview: () => {
      if (candidate) submit({ gameTitleId, kind: "preview", candidateId: candidate.candidateId });
    },
    withdraw: async () => {
      if (candidate)
        await submitAsync({ gameTitleId, kind: "withdraw", candidateId: candidate.candidateId });
    },
    restore: () =>
      submit({
        gameTitleId,
        kind: "restore",
        ...(currentBasis ? { expectedCurrentBasisId: currentBasis.basisId } : {}),
      }),
    retry: () => {
      if (latestOperation)
        submit({ gameTitleId, kind: "retry", originOperationId: latestOperation.operationId });
    },
    checkOperation,
    apply: async (target) => {
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
          title?.seasons.find((season) => season.seasonMasterId === seasonMasterId)?.displayName ??
          current.seasonName,
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
  };
  return {
    resource,
    basis,
    operation,
    receipt: {
      accepted,
      creationAccepted,
      submittedRequest,
      canCommit: Boolean(command.variables && authorization.canCommit(command.variables.lease)),
      pending: command.isPending,
      creationFailed: creationQuery.isError,
    },
    errors: {
      check: checkError,
      creation: creationAccepted && creationQuery.isError ? creationQuery.error : null,
      command: commandError,
      state: shouldShowQueryError(stateQuery) ? stateQuery.error : null,
      options: shouldShowQueryError(optionsQuery) ? optionsQuery.error : null,
    },
    editingEvaluation,
    handlers,
    editingHandlers,
    loading: isInitialQueryLoading(stateQuery),
    error: shouldShowQueryError(stateQuery) ? normalizeDisplayApiError(stateQuery.error) : null,
    refreshing: stateQuery.isFetching,
    refresh,
  };
}
