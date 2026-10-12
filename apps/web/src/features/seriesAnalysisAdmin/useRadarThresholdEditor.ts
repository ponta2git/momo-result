import { useEffect, useMemo, useRef, useState } from "react";

import type {
  PlayerRadarAdminModel,
  PlayerRadarPreviewModel,
} from "@/features/seriesAnalysisAdmin/playerRadarAdminModel";
import {
  radarCommandErrorMessage,
  radarSubmissionUncertain,
} from "@/features/seriesAnalysisAdmin/playerRadarAdminPresentation";
import type {
  RadarEditingSource,
  RadarManualSave,
} from "@/features/seriesAnalysisAdmin/radarThresholdEditorModel";
import {
  parseRadarThresholdDrafts,
  previewRadarThresholds,
  radarBasisInput,
  radarInputBasis,
  radarThresholdDrafts,
  sameRadarThresholds,
} from "@/features/seriesAnalysisAdmin/radarThresholdInput";
import type {
  RadarManualInput,
  RadarThresholdDrafts,
} from "@/features/seriesAnalysisAdmin/radarThresholdInput";
import { useDebouncedCallback } from "@/shared/lib/useDebouncedCallback";
import type { PlayerRadarAxisId } from "@/shared/seriesAnalysis/playerRadarPresentation";

type EditSession = {
  source: RadarEditingSource;
  drafts: RadarThresholdDrafts;
  saved: { candidateId: string; input: RadarManualInput } | null;
  confirmed: boolean;
  confirmedPreviewId: string | null;
  comparisonChanged: boolean;
};

/** Keeps visible text and its saved identity separate from asynchronous comparison results. */
export function useRadarThresholdEditor(model: PlayerRadarAdminModel) {
  const editing = model.editing;
  const [session, setSession] = useState<EditSession | null>(null);
  const [axis, setAxis] = useState<PlayerRadarAxisId>("averageRank");
  const [composing, setComposing] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [ready, setReady] = useState<{
    input: RadarManualInput;
    context: string;
    drafts: RadarThresholdDrafts;
  } | null>(null);
  const navigationAllowedRef = useRef(false);
  const submittedSave = useRef<RadarManualSave | null>(null);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const drafts = session?.drafts;
  const parsed = useMemo(() => (drafts ? parseRadarThresholdDrafts(drafts) : null), [drafts]);
  const context = editing?.evaluation?.key ?? "";
  const debounce = useDebouncedCallback(setReady, 300);
  useEffect(() => {
    debounce.cancel();
    if (drafts && parsed?.input && context && !composing && !editing?.permissionReason) {
      debounce.schedule({ input: parsed.input, context, drafts });
    }
    return debounce.cancel;
  }, [drafts, parsed?.input, context, composing, editing?.permissionReason, debounce]);

  const acceptedSave = editing?.acceptedSave;
  useEffect(() => {
    const submitted = submittedSave.current;
    if (!submitted || !acceptedSave || editing?.permissionReason) return;
    const accepted = acceptedSave.request;
    if (
      accepted.sourceBasisId !== submitted.sourceBasisId ||
      accepted.sourceCandidateId !== submitted.sourceCandidateId ||
      accepted.expectedCurrentBasisId !== submitted.expectedCurrentBasisId ||
      accepted.expectedCandidateId !== submitted.expectedCandidateId ||
      !sameRadarThresholds(accepted.manualInput, submitted.manualInput)
    )
      return;
    submittedSave.current = null;
    setSession((current) => {
      if (
        !current ||
        current.source.sourceBasisId !== submitted.sourceBasisId ||
        current.source.sourceCandidateId !== submitted.sourceCandidateId ||
        current.source.expectedCurrentBasisId !== submitted.expectedCurrentBasisId ||
        current.source.expectedCandidateId !== submitted.expectedCandidateId
      )
        return current;
      const visible = parseRadarThresholdDrafts(current.drafts).input;
      if (!visible || !sameRadarThresholds(visible, submitted.manualInput)) return current;
      return {
        ...current,
        source: { ...current.source, expectedCandidateId: acceptedSave.candidateId },
        saved: { candidateId: acceptedSave.candidateId, input: submitted.manualInput },
        confirmed: true,
        confirmedPreviewId: null,
        comparisonChanged: false,
      };
    });
    setSaveError(null);
  }, [acceptedSave, editing?.permissionReason]);

  const currentId = model.currentBasis?.basisId ?? null;
  const candidateId =
    model.candidate &&
    ["pending", "ready", "unavailable", "failed"].includes(model.candidate.status)
      ? model.candidate.candidateId
      : null;
  const contextChanged =
    session &&
    (session.source.expectedCurrentBasisId !== currentId ||
      session.source.expectedCandidateId !== candidateId);
  // A saved operation may be accepted before its state query has caught up.
  const waitingForSavedState = Boolean(
    session?.saved &&
    candidateId !== session.saved.candidateId &&
    model.operation &&
    ["pending", "running"].includes(model.operation.status) &&
    model.operation.kind === "manual",
  );
  const changed = Boolean(
    session &&
    (!parsed?.input ||
      !sameRadarThresholds(parsed.input, session.saved?.input ?? session.source.input)),
  );
  const matchesSaved = Boolean(
    session?.saved &&
    parsed?.input &&
    sameRadarThresholds(parsed.input, session.saved.input) &&
    candidateId === session.saved.candidateId,
  );
  const formal = matchesSaved && model.previewState === "ready" ? model.preview : null;
  const formalPreviewId = formal?.previewId;
  // A refreshed server comparison changes confirmation identity; a scope change does not.
  // Adjust during render so the new comparison is never briefly exposed as confirmed.
  if (session?.confirmed && formalPreviewId && session.confirmedPreviewId !== formalPreviewId) {
    setSession(
      session.confirmedPreviewId === null
        ? { ...session, confirmedPreviewId: formalPreviewId }
        : { ...session, confirmed: false, comparisonChanged: true },
    );
  }
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
  const readyCurrent =
    ready &&
    session &&
    ready.drafts === session.drafts &&
    ready.context === context &&
    !composing &&
    !editing?.permissionReason;
  const localPreview: PlayerRadarPreviewModel | null =
    ready &&
    session &&
    ready.context === context &&
    editing?.evaluation &&
    !editing.permissionReason
      ? {
          previewId: `local:${context}`,
          createdAt: editing.evaluation.createdAt,
          evaluationState: editing.evaluation.raw.sample.matchCount ? "ready" : "empty",
          before: editing.evaluation.before,
          after: previewRadarThresholds(editing.evaluation.raw, session.source.basis, ready.input),
          beforeBasis: model.currentBasis,
          candidateBasis: radarInputBasis(session.source.basis, ready.input),
        }
      : null;
  const preview = session?.confirmed && formal ? formal : localPreview;
  const noChangeFromCurrent = Boolean(
    !matchesSaved &&
    parsed?.input &&
    model.currentBasis &&
    sameRadarThresholds(parsed.input, radarBasisInput(model.currentBasis)),
  );

  function begin(source: RadarEditingSource) {
    if (editing?.permissionReason || saving) return;
    navigationAllowedRef.current = false;
    submittedSave.current = null;
    setSession({
      source,
      drafts: radarThresholdDrafts(source.input),
      saved: source.savedCandidateId
        ? { candidateId: source.savedCandidateId, input: source.input }
        : null,
      confirmed: false,
      confirmedPreviewId: null,
      comparisonChanged: false,
    });
    setAxis("averageRank");
    setShowErrors(false);
    setSaveError(null);
    setReady(null);
    editing?.onActiveChange(true);
  }
  function finish() {
    if (saving || model.communicationUnknown) return;
    debounce.cancel();
    submittedSave.current = null;
    setSession(null);
    setReady(null);
    setSaveError(null);
    editing?.onActiveChange(false);
  }
  function change(axisId: PlayerRadarAxisId, index: number, value: string) {
    debounce.cancel();
    setSession((current) =>
      current
        ? {
            ...current,
            confirmed: false,
            drafts: {
              ...current.drafts,
              [axisId]: current.drafts[axisId].map((text, i) => (i === index ? value : text)),
            },
          }
        : null,
    );
    setSaveError(null);
  }
  function adoptCurrentSource() {
    const source = editing?.current ?? editing?.candidate;
    if (!source || saving) return;
    setSession((current) =>
      current ? { ...current, source, saved: null, confirmed: false } : null,
    );
    setSaveError(null);
  }
  async function save() {
    if (!session || !editing || saving || composing) return null;
    // Do not rely on a debounced parse or blur to determine the submitted snapshot.
    const latest = parseRadarThresholdDrafts(session.drafts);
    setShowErrors(true);
    if (!latest.input) return latest.errors[0] ?? null;
    const submittedInput = latest.input;
    if (editing.saveDisabledReason || contextChanged || noChangeFromCurrent) return null;
    setSaving(true);
    setSaveError(null);
    const submitted = session;
    try {
      let acceptedCandidate: string;
      if (session.saved && sameRadarThresholds(latest.input, session.saved.input)) {
        acceptedCandidate = session.saved.candidateId;
        await editing.reuseCandidate(acceptedCandidate);
      } else {
        const request: RadarManualSave = {
          sourceBasisId: session.source.sourceBasisId,
          sourceCandidateId: session.source.sourceCandidateId,
          expectedCurrentBasisId: session.source.expectedCurrentBasisId,
          expectedCandidateId: session.source.expectedCandidateId,
          manualInput: latest.input,
        };
        submittedSave.current = request;
        acceptedCandidate = await editing.save(request);
        submittedSave.current = null;
      }
      if (mounted.current)
        setSession((current) =>
          current === submitted
            ? {
                ...current,
                source: { ...current.source, expectedCandidateId: acceptedCandidate },
                saved: { candidateId: acceptedCandidate, input: submittedInput },
                confirmed: true,
                confirmedPreviewId: null,
                comparisonChanged: false,
              }
            : current,
        );
    } catch (error) {
      if (!radarSubmissionUncertain(error)) submittedSave.current = null;
      if (mounted.current) setSaveError(radarCommandErrorMessage(error));
    } finally {
      if (mounted.current) setSaving(false);
    }
    return null;
  }

  return {
    session,
    active: session !== null,
    axis,
    setAxis,
    parsed,
    preview,
    ready: Boolean(readyCurrent),
    composing,
    setComposing: (value: boolean) => {
      debounce.cancel();
      setComposing(value);
    },
    showErrors,
    saving,
    saveError,
    changed,
    canApply,
    formalMismatch,
    comparisonChanged: session?.comparisonChanged ?? false,
    noChangeFromCurrent,
    contextChanged: Boolean(contextChanged && !waitingForSavedState),
    waitingForSavedState,
    navigationAllowedRef,
    begin,
    finish,
    change,
    save,
    adoptCurrentSource,
    reset: () => {
      if (session) {
        debounce.cancel();
        setSession({
          ...session,
          drafts: radarThresholdDrafts(session.source.input),
          confirmed: false,
        });
        setShowErrors(false);
      }
    },
  };
}

export type RadarThresholdEditor = ReturnType<typeof useRadarThresholdEditor>;
