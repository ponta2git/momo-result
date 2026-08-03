import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { MatchFormValues, WorkspaceMode } from "@/features/matches/workspace/matchFormTypes";
import {
  loadMatchWorkspaceSessionDraft,
  matchWorkspaceDraftFingerprint,
  matchWorkspaceSessionDraftKey,
  matchWorkspaceValuesFingerprint,
  removeMatchWorkspaceSessionDraft,
  saveMatchWorkspaceSessionDraft,
} from "@/features/matches/workspace/matchWorkspaceSessionDraft";
import type { MatchWorkspaceSessionDraft } from "@/features/matches/workspace/matchWorkspaceSessionDraft";

type SessionState = {
  baselineDraftFingerprint: string;
  baselineValuesFingerprint: string;
  key: string;
  recovery: MatchWorkspaceSessionDraft | null;
};

export function useMatchWorkspaceSessionDraft({
  acknowledgedCellIds,
  enabled,
  mode,
  onRestore,
  values,
  workspaceKey,
}: {
  acknowledgedCellIds: readonly string[];
  enabled: boolean;
  mode: WorkspaceMode;
  onRestore: (draft: MatchWorkspaceSessionDraft) => void;
  values: MatchFormValues;
  workspaceKey: string;
}) {
  const storageKey = matchWorkspaceSessionDraftKey({ mode, workspaceKey });
  const latestValuesRef = useRef(values);
  latestValuesRef.current = values;
  const navigationAllowedRef = useRef(false);
  const [committedKey, setCommittedKey] = useState<string | null>(null);
  const [sessionState, setSessionState] = useState<SessionState | null>(null);

  useEffect(() => {
    navigationAllowedRef.current = false;
    setCommittedKey(null);
    setSessionState(null);
  }, [storageKey]);

  useEffect(() => {
    if (!enabled || sessionState?.key === storageKey) {
      return;
    }

    const initialValues = latestValuesRef.current;
    const baselineValuesFingerprint = matchWorkspaceValuesFingerprint(initialValues, mode);
    const baselineDraftFingerprint = matchWorkspaceDraftFingerprint({
      acknowledgedCellIds: [],
      mode,
      values: initialValues,
    });
    const stored = loadMatchWorkspaceSessionDraft(storageKey);
    const recovery =
      stored && stored.baselineFingerprint === baselineValuesFingerprint ? stored : null;
    if (stored && !recovery) {
      removeMatchWorkspaceSessionDraft(storageKey);
    }
    setSessionState({
      baselineDraftFingerprint,
      baselineValuesFingerprint,
      key: storageKey,
      recovery,
    });
  }, [enabled, mode, sessionState?.key, storageKey]);

  const currentFingerprint = useMemo(
    () => matchWorkspaceDraftFingerprint({ acknowledgedCellIds, mode, values }),
    [acknowledgedCellIds, mode, values],
  );
  const activeState = sessionState?.key === storageKey ? sessionState : null;
  const dirty = Boolean(
    enabled &&
    activeState &&
    committedKey !== storageKey &&
    currentFingerprint !== activeState.baselineDraftFingerprint,
  );

  useEffect(() => {
    if (!activeState || activeState.recovery) {
      return;
    }
    if (!dirty) {
      removeMatchWorkspaceSessionDraft(storageKey);
      return;
    }
    saveMatchWorkspaceSessionDraft(storageKey, {
      acknowledgedCellIds: [...acknowledgedCellIds],
      baselineFingerprint: activeState.baselineValuesFingerprint,
      savedAt: new Date().toISOString(),
      values,
      version: 1,
    });
  }, [acknowledgedCellIds, activeState, dirty, storageKey, values]);

  const restoreRecovery = useCallback(() => {
    const recovery = sessionState?.key === storageKey ? sessionState.recovery : null;
    if (!recovery) {
      return;
    }
    onRestore(recovery);
    setSessionState((current) =>
      current?.key === storageKey ? { ...current, recovery: null } : current,
    );
  }, [onRestore, sessionState, storageKey]);

  const discardRecovery = useCallback(() => {
    removeMatchWorkspaceSessionDraft(storageKey);
    setSessionState((current) =>
      current?.key === storageKey ? { ...current, recovery: null } : current,
    );
  }, [storageKey]);

  const allowNavigation = useCallback(() => {
    navigationAllowedRef.current = true;
  }, []);

  const markCommitted = useCallback(() => {
    navigationAllowedRef.current = true;
    removeMatchWorkspaceSessionDraft(storageKey);
    setCommittedKey(storageKey);
  }, [storageKey]);

  return {
    allowNavigation,
    dirty,
    discardRecovery,
    markCommitted,
    navigationAllowedRef,
    recovery: activeState?.recovery ?? null,
    restoreRecovery,
  };
}
