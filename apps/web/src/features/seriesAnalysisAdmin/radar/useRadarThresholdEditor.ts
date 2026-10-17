import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  radarCommandErrorMessage,
  radarSubmissionUncertain,
} from "@/features/seriesAnalysisAdmin/radar/playerRadarAdminPresentation";
import type { PlayerRadarAdministrationView } from "@/features/seriesAnalysisAdmin/radar/playerRadarAdminTypes";
import {
  acceptRadarSaveReceipt,
  adoptRadarEditingSource,
  beginRadarEdit,
  changeRadarThreshold,
  confirmRadarSavedInput,
  matchesRadarSaveReceipt,
  radarApplyReceiptMatches,
  buildRadarThresholdEditorView,
  buildRadarInputPreview,
  radarSaveRequest,
  reconcileRadarComparison,
  resetRadarThresholds,
} from "@/features/seriesAnalysisAdmin/radar/radarEditingSession";
import type {
  RadarEditSession,
  RadarSettledInput,
} from "@/features/seriesAnalysisAdmin/radar/radarEditingSession";
import type {
  RadarEditingSource,
  RadarManualSave,
  RadarThresholdEditor,
} from "@/features/seriesAnalysisAdmin/radar/radarThresholdEditorModel";
import {
  parseRadarThresholdDrafts,
  sameRadarThresholds,
} from "@/features/seriesAnalysisAdmin/radar/radarThresholdInput";
import { useRadarApplyConfirmation } from "@/features/seriesAnalysisAdmin/radar/useRadarApplyConfirmation";
import { useDebouncedCallback } from "@/shared/lib/useDebouncedCallback";
import type { PlayerRadarAxisId } from "@/shared/seriesAnalysis/playerRadarPresentation";

/** Owns input lifetime and asynchronous receipts; projections and transitions stay pure. */
export function useRadarThresholdEditor(
  administration: PlayerRadarAdministrationView,
  active = true,
): RadarThresholdEditor {
  const editing = administration.editing;
  const [session, setSession] = useState<RadarEditSession | null>(null);
  const [axis, setAxis] = useState<PlayerRadarAxisId>("averageRank");
  const [composing, setComposing] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [preparingApply, setPreparingApply] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [settledInput, setSettledInput] = useState<RadarSettledInput | null>(null);
  const navigationAllowed = useRef(false);
  const isNavigationAllowed = useCallback(() => navigationAllowed.current, []);
  const submittedSave = useRef<RadarManualSave | null>(null);
  const handledApply = useRef<string | null>(null);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const drafts = session?.drafts;
  const parsed = useMemo(() => (drafts ? parseRadarThresholdDrafts(drafts) : null), [drafts]);
  const evaluationKey = editing?.evaluation?.key ?? "";
  const inputDebounce = useDebouncedCallback(setSettledInput, 300);
  useEffect(() => {
    inputDebounce.cancel();
    if (drafts && parsed?.input && evaluationKey && !composing && !editing?.permissionReason)
      inputDebounce.schedule({ input: parsed.input, evaluationKey, drafts });
    return inputDebounce.cancel;
  }, [drafts, parsed?.input, evaluationKey, composing, editing?.permissionReason, inputDebounce]);

  const acceptedSave = editing?.acceptedSave;
  useEffect(() => {
    const submitted = submittedSave.current;
    if (
      !submitted ||
      !acceptedSave ||
      editing?.permissionReason ||
      !matchesRadarSaveReceipt(submitted, acceptedSave.request)
    )
      return;
    submittedSave.current = null;
    setSession((current) => acceptRadarSaveReceipt(current, submitted, acceptedSave));
    setApplyError(null);
  }, [acceptedSave, editing?.permissionReason]);

  // A receipt may recover after the original promise was interrupted by authorization.
  const acceptedApply = editing?.acceptedApply;
  useEffect(() => {
    if (
      editing?.permissionReason ||
      !acceptedApply ||
      handledApply.current === acceptedApply.operationId
    )
      return;
    handledApply.current = acceptedApply.operationId;
    if (!radarApplyReceiptMatches(session, acceptedApply)) return;
    navigationAllowed.current = true;
    inputDebounce.cancel();
    submittedSave.current = null;
    // Reconcile an externally recovered receipt after the original event handler ended.
    // oxlint-disable-next-line react/set-state-in-effect
    setSession(null);
    setSettledInput(null);
    setApplyError(null);
    editing?.onActiveChange(false);
  }, [acceptedApply, session, inputDebounce, editing]);

  const sourceBasis = session?.source.basis;
  const currentBasis = administration.currentBasis;
  const evaluation = editing?.evaluation;
  const permissionReason = editing?.permissionReason;
  const localPreview = useMemo(
    () =>
      buildRadarInputPreview({
        basis: sourceBasis,
        currentBasis,
        settledInput,
        evaluation,
        permissionReason,
      }),
    [sourceBasis, currentBasis, settledInput, evaluation, permissionReason],
  );
  const projection = useMemo(
    () =>
      buildRadarThresholdEditorView(
        session,
        administration,
        settledInput,
        composing,
        applyError,
        localPreview,
      ),
    [session, administration, settledInput, composing, applyError, localPreview],
  );
  const reconciled = reconcileRadarComparison(session, projection.formalPreviewId);
  // Never publish a changed formal comparison as already confirmed.
  if (reconciled !== session) setSession(reconciled);
  const view = {
    ...projection.view,
    axis,
    composing,
    showErrors,
    preparingApply,
    discarding,
    applyError,
  };
  const onActiveChange = editing?.onActiveChange;
  const begin = useCallback(
    (source: RadarEditingSource) => {
      if (permissionReason || preparingApply) return;
      navigationAllowed.current = false;
      submittedSave.current = null;
      setSession(beginRadarEdit(source));
      setAxis("averageRank");
      setComposing(false);
      setShowErrors(false);
      setApplyError(null);
      setSettledInput(null);
      onActiveChange?.(true);
    },
    [permissionReason, preparingApply, onActiveChange],
  );
  const currentSource = editing?.current;
  const candidateSource = editing?.candidate;
  const beginFromCurrent = useCallback(() => {
    if (currentSource) begin(currentSource);
  }, [begin, currentSource]);
  const beginFromCandidate = useCallback(() => {
    if (candidateSource) begin(candidateSource);
  }, [begin, candidateSource]);
  const enteredCandidate = useRef<string | null>(null);
  const candidateId = administration.candidate?.candidateId;
  const candidateStatus = administration.candidate?.status;
  useEffect(() => {
    const id = administration.autoEditCandidateId;
    if (
      !active ||
      view.active ||
      !id ||
      enteredCandidate.current === id ||
      candidateId !== id ||
      candidateStatus !== "ready" ||
      !candidateSource ||
      editing?.saveDisabledReason
    )
      return;
    enteredCandidate.current = id;
    beginFromCandidate();
  }, [
    active,
    view.active,
    administration.autoEditCandidateId,
    candidateId,
    candidateStatus,
    candidateSource,
    editing?.saveDisabledReason,
    beginFromCandidate,
  ]);

  function finish() {
    if (preparingApply || administration.communicationUnknown) return;
    navigationAllowed.current = true;
    inputDebounce.cancel();
    submittedSave.current = null;
    setSession(null);
    setSettledInput(null);
    setApplyError(null);
    editing?.onActiveChange(false);
  }
  async function discard() {
    if (!session || !editing || preparingApply || discarding || administration.communicationUnknown)
      return;
    setDiscarding(true);
    try {
      if (session.prepared) await editing.discard(session.prepared);
      finish();
    } catch (error) {
      throw new Error(radarCommandErrorMessage(error), { cause: error });
    } finally {
      setDiscarding(false);
    }
  }
  function change(axisId: PlayerRadarAxisId, index: number, value: string) {
    inputDebounce.cancel();
    setSession((current) => changeRadarThreshold(current, axisId, index, value));
    setApplyError(null);
  }
  function adoptCurrentSource() {
    const source = currentSource ?? candidateSource;
    if (!source || preparingApply) return;
    setSession((current) => adoptRadarEditingSource(current, source));
    setApplyError(null);
  }
  async function prepareApply() {
    if (!session || !editing || preparingApply || composing) return null;
    // Submit the full visible input, independent of debounce and blur.
    const latest = parseRadarThresholdDrafts(session.drafts);
    setShowErrors(true);
    if (!latest.input) return latest.errors[0] ?? null;
    const submittedInput = latest.input;
    if (
      editing.saveDisabledReason ||
      projection.contextChangedBeforeAcceptance ||
      view.noChangeFromCurrent
    )
      return null;
    setPreparingApply(true);
    setApplyError(null);
    const submitted = session;
    try {
      let acceptedCandidate: string;
      let prepared = session.prepared;
      if (session.saved && sameRadarThresholds(latest.input, session.saved.input)) {
        acceptedCandidate = session.saved.candidateId;
        await editing.reuseCandidate(acceptedCandidate);
      } else {
        const request = radarSaveRequest(session, latest.input);
        submittedSave.current = request;
        prepared = await editing.save(request);
        acceptedCandidate = prepared.candidateId;
        submittedSave.current = null;
      }
      if (mounted.current)
        setSession((current) =>
          current === submitted
            ? confirmRadarSavedInput(current, submittedInput, acceptedCandidate, prepared)
            : current,
        );
    } catch (error) {
      if (!radarSubmissionUncertain(error)) submittedSave.current = null;
      if (mounted.current) setApplyError(radarCommandErrorMessage(error));
    } finally {
      // Activity retains state while effects are suspended. The event must still settle.
      setPreparingApply(false);
    }
    return null;
  }
  const confirmation = useRadarApplyConfirmation(
    administration,
    view,
    active,
    prepareApply,
    finish,
  );
  return {
    ...view,
    currentSourceAvailable: Boolean(currentSource),
    candidateSourceAvailable: Boolean(candidateSource),
    saveDisabledReason: editing?.saveDisabledReason ?? null,
    beginFromCurrent,
    beginFromCandidate,
    setAxis,
    setComposing: (value) => {
      inputDebounce.cancel();
      setComposing(value);
    },
    isNavigationAllowed,
    discard,
    change,
    adoptCurrentSource,
    reset: () => {
      if (!session) return;
      inputDebounce.cancel();
      setSession(resetRadarThresholds);
      setShowErrors(false);
    },
    confirmation: confirmation.view,
    requestApply: confirmation.request,
    confirmApply: confirmation.confirm,
    setConfirmationOpen: confirmation.setOpen,
  };
}
