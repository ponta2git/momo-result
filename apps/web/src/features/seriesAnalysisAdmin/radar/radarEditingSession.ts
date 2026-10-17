import type {
  PlayerRadarAdminModel,
  PlayerRadarPreviewModel,
} from "@/features/seriesAnalysisAdmin/radar/playerRadarAdminTypes";
import type {
  RadarEditingSource,
  RadarManualSave,
  RadarPreparedCandidate,
  RadarEditingModel,
} from "@/features/seriesAnalysisAdmin/radar/radarThresholdEditorModel";
import {
  parseRadarThresholdDrafts,
  previewRadarThresholds,
  radarBasisInput,
  radarInputBasis,
  radarThresholdDrafts,
  sameRadarThresholds,
} from "@/features/seriesAnalysisAdmin/radar/radarThresholdInput";
import type {
  RadarManualInput,
  RadarThresholdDrafts,
} from "@/features/seriesAnalysisAdmin/radar/radarThresholdInput";
import type {
  PlayerRadarAxisId,
  PlayerRadarBasis,
} from "@/shared/seriesAnalysis/playerRadarPresentation";

/** Private editing identity; the UI receives only the projection below. */
export type RadarEditSession = {
  source: RadarEditingSource;
  drafts: RadarThresholdDrafts;
  saved: { candidateId: string; input: RadarManualInput } | null;
  prepared: RadarPreparedCandidate | null;
  confirmed: boolean;
  confirmedPreviewId: string | null;
  comparisonChanged: boolean;
};
export type RadarReadyInput = {
  input: RadarManualInput;
  context: string;
  drafts: RadarThresholdDrafts;
};

export function beginRadarEdit(source: RadarEditingSource): RadarEditSession {
  return {
    source,
    drafts: radarThresholdDrafts(source.input),
    saved: source.savedCandidateId
      ? { candidateId: source.savedCandidateId, input: source.input }
      : null,
    prepared: null,
    confirmed: false,
    confirmedPreviewId: null,
    comparisonChanged: false,
  };
}
export function changeRadarThreshold(
  session: RadarEditSession | null,
  axis: PlayerRadarAxisId,
  index: number,
  value: string,
): RadarEditSession | null {
  return session
    ? {
        ...session,
        confirmed: false,
        drafts: {
          ...session.drafts,
          [axis]: session.drafts[axis].map((text, i) => (i === index ? value : text)),
        },
      }
    : null;
}
export function resetRadarThresholds(session: RadarEditSession | null): RadarEditSession | null {
  return session
    ? { ...session, drafts: radarThresholdDrafts(session.source.input), confirmed: false }
    : null;
}
export function adoptRadarEditingSource(
  session: RadarEditSession | null,
  source: RadarEditingSource,
): RadarEditSession | null {
  return session ? { ...session, source, saved: null, confirmed: false } : null;
}
function sameRadarSaveSource(a: RadarManualSave, b: RadarManualSave | RadarEditingSource) {
  return (
    a.sourceBasisId === b.sourceBasisId &&
    a.sourceCandidateId === b.sourceCandidateId &&
    a.expectedCurrentBasisId === b.expectedCurrentBasisId &&
    a.expectedCandidateId === b.expectedCandidateId
  );
}
export function matchesRadarSaveReceipt(request: RadarManualSave, accepted: RadarManualSave) {
  return (
    sameRadarSaveSource(request, accepted) &&
    sameRadarThresholds(request.manualInput, accepted.manualInput)
  );
}
export function confirmRadarSavedInput(
  session: RadarEditSession,
  input: RadarManualInput,
  candidateId: string,
  prepared: RadarPreparedCandidate | null,
): RadarEditSession {
  return {
    ...session,
    source: { ...session.source, expectedCandidateId: candidateId },
    saved: { candidateId, input },
    prepared,
    confirmed: true,
    confirmedPreviewId: null,
    comparisonChanged: false,
  };
}
export function acceptRadarSaveReceipt(
  session: RadarEditSession | null,
  submitted: RadarManualSave,
  receipt: NonNullable<RadarEditingModel["acceptedSave"]>,
): RadarEditSession | null {
  if (!session || !sameRadarSaveSource(submitted, session.source)) return session;
  const visible = parseRadarThresholdDrafts(session.drafts).input;
  if (!visible || !sameRadarThresholds(visible, submitted.manualInput)) return session;
  return confirmRadarSavedInput(session, submitted.manualInput, receipt.candidateId, {
    candidateId: receipt.candidateId,
    operationId: receipt.operationId,
  });
}
export function radarApplyReceiptMatches(
  session: RadarEditSession | null,
  receipt: NonNullable<RadarEditingModel["acceptedApply"]>,
) {
  if (!session?.saved || session.saved.candidateId !== receipt.candidateId) return false;
  const visible = parseRadarThresholdDrafts(session.drafts).input;
  return Boolean(visible && sameRadarThresholds(visible, session.saved.input));
}
export function reconcileRadarComparison(
  session: RadarEditSession | null,
  previewId: string | undefined,
): RadarEditSession | null {
  if (!session?.confirmed || !previewId || session.confirmedPreviewId === previewId) return session;
  return session.confirmedPreviewId === null
    ? { ...session, confirmedPreviewId: previewId }
    : { ...session, confirmed: false, comparisonChanged: true };
}
export function radarSaveRequest(
  session: RadarEditSession,
  input: RadarManualInput,
): RadarManualSave {
  return {
    sourceBasisId: session.source.sourceBasisId,
    sourceCandidateId: session.source.sourceCandidateId,
    expectedCurrentBasisId: session.source.expectedCurrentBasisId,
    expectedCandidateId: session.source.expectedCandidateId,
    manualInput: input,
  };
}

/** Only settled input and its evaluation context affect the expensive local comparison. */
export function radarReadyPreview({
  basis,
  currentBasis,
  ready,
  evaluation,
  permissionReason,
}: {
  basis: PlayerRadarBasis | undefined;
  currentBasis: PlayerRadarBasis | null;
  ready: RadarReadyInput | null;
  evaluation: RadarEditingModel["evaluation"] | undefined;
  permissionReason: string | null | undefined;
}): PlayerRadarPreviewModel | null {
  if (!basis || !ready || !evaluation || ready.context !== evaluation.key || permissionReason)
    return null;
  return {
    previewId: `local:${evaluation.key}`,
    createdAt: evaluation.createdAt,
    evaluationState: evaluation.raw.sample.matchCount ? "ready" : "empty",
    before: evaluation.before,
    after: previewRadarThresholds(evaluation.raw, basis, ready.input),
    beforeBasis: currentBasis,
    candidateBasis: radarInputBasis(basis, ready.input),
  };
}

/** Saved, debounced, and visible input remain distinct until their identities match. */
export function radarEditingView(
  session: RadarEditSession | null,
  model: PlayerRadarAdminModel,
  ready: RadarReadyInput | null,
  composing: boolean,
  applyError: string | null,
  localPreview: PlayerRadarPreviewModel | null,
) {
  const editing = model.editing;
  const parsed = session ? parseRadarThresholdDrafts(session.drafts) : null;
  const context = editing?.evaluation?.key ?? "";
  const candidateId =
    model.candidate &&
    ["pending", "ready", "unavailable", "failed"].includes(model.candidate.status)
      ? model.candidate.candidateId
      : null;
  const contextChanged = Boolean(
    session &&
    (session.source.expectedCurrentBasisId !== (model.currentBasis?.basisId ?? null) ||
      session.source.expectedCandidateId !== candidateId),
  );
  const waitingForSavedState = Boolean(
    session?.saved &&
    candidateId !== session.saved.candidateId &&
    model.operation &&
    ["pending", "running"].includes(model.operation.status) &&
    model.operation.kind === "manual",
  );
  const matchesSaved = Boolean(
    session?.saved &&
    parsed?.input &&
    sameRadarThresholds(parsed.input, session.saved.input) &&
    candidateId === session.saved.candidateId,
  );
  const formal = matchesSaved && model.previewState === "ready" ? model.preview : null;
  const formalMismatch = Boolean(
    formal?.after &&
    parsed?.input &&
    session &&
    previewRadarThresholds(formal.after, session.source.basis, parsed.input).players.some(
      (player) =>
        player.axes.some(
          (cell) =>
            cell.score !==
            formal.after?.players
              .find((p) => p.memberId === player.memberId)
              ?.axes.find((c) => c.axisId === cell.axisId)?.score,
        ),
    ),
  );
  const canApply = Boolean(
    session?.confirmed &&
    formal &&
    (session.confirmedPreviewId === null || session.confirmedPreviewId === formal.previewId) &&
    !formalMismatch &&
    !contextChanged &&
    !composing &&
    !editing?.permissionReason,
  );
  const noChangeFromCurrent = Boolean(
    !matchesSaved &&
    parsed?.input &&
    model.currentBasis &&
    sameRadarThresholds(parsed.input, radarBasisInput(model.currentBasis)),
  );
  return {
    parsed,
    formalPreviewId: formal?.previewId,
    contextChangedBeforeAcceptance: contextChanged,
    view: {
      active: session !== null,
      drafts: session?.drafts ?? null,
      errors: parsed?.errors ?? [],
      inputValid: Boolean(parsed?.input),
      sourceLabel: session?.source.label ?? "",
      referenceThresholds: session
        ? (Object.fromEntries(
            session.source.basis.axes.map((axis) => [
              axis.axisId,
              axis.thresholds.map((threshold) => threshold.rawValue),
            ]),
          ) as Partial<Record<PlayerRadarAxisId, readonly number[]>>)
        : null,
      replacesCandidate: Boolean(session?.source.expectedCandidateId),
      preview: session?.confirmed && formal ? formal : localPreview,
      ready: Boolean(
        ready &&
        session &&
        ready.drafts === session.drafts &&
        ready.context === context &&
        !composing &&
        !editing?.permissionReason,
      ),
      changed: Boolean(
        session && (!parsed?.input || !sameRadarThresholds(parsed.input, session.source.input)),
      ),
      canApply,
      awaitingValidation: Boolean(
        session?.confirmed &&
        !formal &&
        !applyError &&
        !contextChanged &&
        model.operation &&
        ["manual", "preview", "retry"].includes(model.operation.kind) &&
        ["pending", "running"].includes(model.operation.status),
      ),
      formalMismatch,
      comparisonChanged: session?.comparisonChanged ?? false,
      noChangeFromCurrent,
      contextChanged: contextChanged && !waitingForSavedState,
      waitingForSavedState,
      permissionReason: editing?.permissionReason ?? null,
      applyReason:
        editing?.saveDisabledReason ??
        (contextChanged && !waitingForSavedState
          ? "最新の基準・共有案を確認してください。"
          : noChangeFromCurrent
            ? "適用中の境界と同じ値です。"
            : null),
      evaluationMessage: editing?.evaluationMessage ?? null,
      evaluationUpdating: editing?.evaluationUpdating ?? false,
      latestSourceAvailable: Boolean(editing?.current ?? editing?.candidate),
    },
  };
}
