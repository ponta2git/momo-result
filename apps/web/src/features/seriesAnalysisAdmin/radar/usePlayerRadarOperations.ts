import { useEffect, useRef, useState } from "react";

import {
  buildRadarBasisView,
  radarOperationState,
  radarDraftNoLongerOwned,
  isRadarOperationInProgress,
} from "@/features/seriesAnalysisAdmin/radar/playerRadarAdminPresentation";
import type {
  RadarAdminHandlers,
  RadarEditingHandlers,
} from "@/features/seriesAnalysisAdmin/radar/playerRadarAdminTypes";
import {
  useRadarAdministrationReads,
  useRadarCommandSubmission,
  useRadarCreationRead,
} from "@/features/seriesAnalysisAdmin/radar/playerRadarQueryAdapter";
import { useRadarEditingEvaluation } from "@/features/seriesAnalysisAdmin/radar/useRadarEditingEvaluation";
import { normalizeDisplayApiError, normalizeUnknownApiError } from "@/shared/api/problemDetails";
import type {
  SeriesPlayerRadarCommand,
  SeriesPlayerRadarOperation,
} from "@/shared/api/seriesPlayerRadar";
import type { AuthorizationAccess } from "@/shared/auth/authorization";

/** Each mounted instance owns one title; scope changes never retarget a submitted command. */
export function usePlayerRadarOperations(
  gameTitleId: string,
  authorization: AuthorizationAccess,
  onApplyAccepted?: (operationId: string) => void,
) {
  const commandPending = useRef(false);
  const mounted = useRef(false);
  const notifiedOperationId = useRef<string | null>(null);
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
  const reads = useRadarAdministrationReads(gameTitleId, scope, authorization);
  const { resource, publishAcceptance, refreshAfterCreation } = reads;
  const { title, state } = resource;
  const maps = title?.maps ?? [];
  const candidate = state?.candidate;
  const previewId = candidate?.latestPreview?.previewId;
  const command = useRadarCommandSubmission({
    canSubmit: ({ lease }) => mounted.current && authorization.canCommit(lease),
    onStart: () => setCheckError(undefined),
    onFailure: (error, { lease }) => {
      if (mounted.current) authorization.reportError(error, lease);
    },
    onFinish: () => {
      commandPending.current = false;
    },
  });

  // Keep a confirmed receipt during temporary auth checks. Its cache updates and navigation
  // resume once for the same authorized owner; a revoked owner never recreates protected data.
  useEffect(() => {
    const response = command.accepted;
    const submitted = command.submitted;
    if (
      !response ||
      !submitted ||
      handledAcceptance.current === response ||
      !authorization.canCommit(submitted.lease)
    )
      return;
    handledAcceptance.current = response;
    const { request } = submitted;
    publishAcceptance(request, response);
    if (
      request.kind === "apply" &&
      ["pending", "running", "succeeded"].includes(response.status) &&
      notifiedOperationId.current !== response.operationId
    ) {
      notifiedOperationId.current = response.operationId;
      onApplyAccepted?.(response.operationId);
    }
  }, [authorization, command.accepted, command.submitted, onApplyAccepted, publishAcceptance]);

  const currentCommand = command.submitted
    ? authorization.isCurrent(command.submitted.lease)
    : false;
  const submittedRequest = command.submitted?.request;
  const commandError = currentCommand ? command.error : undefined;
  const accepted = currentCommand ? command.accepted : undefined;
  const creationAccepted =
    accepted && (accepted.kind === "candidate" || accepted.kind === "restore")
      ? accepted
      : undefined;
  const creation = useRadarCreationRead(gameTitleId, creationAccepted, authorization);
  const completedCreation = useRef<string | null>(null);
  useEffect(() => {
    const operation = creation.operation;
    if (
      !creationAccepted ||
      !operation ||
      !authorization.allowed.operations ||
      isRadarOperationInProgress(operation.status) ||
      completedCreation.current === operation.operationId
    )
      return;
    completedCreation.current = operation.operationId;
    refreshAfterCreation();
  }, [
    authorization.allowed.operations,
    creationAccepted,
    creation.operation,
    refreshAfterCreation,
  ]);
  const basis = buildRadarBasisView(resource);
  const operation = radarOperationState({
    resource,
    previewState: basis.previewState,
    accepted,
    creationOperation: creation.operation,
    commandError,
    pending: command.pending,
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
    command.submit({ request, lease });
  };
  const submitAsync = async (request: SeriesPlayerRadarCommand) => {
    if (commandPending.current) throw new Error("操作を受け付けています。");
    const lease = authorization.begin("operations");
    if (!lease) throw new DOMException("権限を確認できません", "AbortError");
    commandPending.current = true;
    const response = await command.submitAndWait({ request, lease });
    if (!mounted.current || !authorization.canCommit(lease))
      throw new DOMException("権限を確認できません", "AbortError");
    return response;
  };
  const refresh = async () => {
    const lease = authorization.begin("operations");
    if (!lease) return;
    setCheckError(undefined);
    if (creationAccepted && creation.failed) await creation.refresh();
    if (!mounted.current || !authorization.canCommit(lease)) return;
    const result = await reads.refreshState();
    if (!mounted.current || !authorization.canCommit(lease)) return;
    await reads.refreshOptions();
    if (!mounted.current || !authorization.canCommit(lease)) return;
    if (result.state?.candidate?.latestPreview?.previewId === previewId && previewId)
      await reads.refreshPreview();
    await editingEvaluation.refresh(() => mounted.current && authorization.canCommit(lease));
    if (!mounted.current || !authorization.canCommit(lease)) return;
    if (result.confirmed && conflictNeedsRefresh) command.clear();
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
        await reads.readOperation(latestOperation.operationId);
        if (!mounted.current || !authorization.canCommit(lease)) return;
        await reads.refreshState();
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
      const curve = request.manualInput.achievementCurve;
      if (curve && !("pointThresholds" in curve))
        throw new Error("実績ポイントの採点境界を確認してください。");
      const response = await submitAsync({
        gameTitleId,
        kind: "manual",
        ...request,
        manualInput: {
          axes: request.manualInput.axes,
          ...(curve ? { achievementCurve: { pointThresholds: [...curve.pointThresholds] } } : {}),
        },
      });
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
        const fresh = await reads.confirmState();
        if (!mounted.current || !authorization.canCommit(lease))
          throw new DOMException("権限を確認できません", "AbortError");
        if (!radarDraftNoLongerOwned(fresh, gameTitleId, prepared.candidateId)) throw error;
        // Preserve the newer/shared server candidate; only this local edit ends.
        command.clear();
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
      canCommit: Boolean(command.submitted && authorization.canCommit(command.submitted.lease)),
      pending: command.pending,
      creationFailed: creation.failed,
    },
    errors: {
      check: checkError,
      creation: creationAccepted && creation.failed ? creation.error : null,
      command: commandError,
      ...reads.errors,
    },
    editingEvaluation,
    handlers,
    editingHandlers,
    loading: reads.loading,
    error: reads.errors.state ? normalizeDisplayApiError(reads.errors.state) : null,
    refreshing: resource.stateFetching,
    refresh,
  };
}
