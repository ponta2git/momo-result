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
import type {
  MatchWorkspaceSessionDraft,
  MatchWorkspaceSessionDraftScope,
} from "@/features/matches/workspace/matchWorkspaceSessionDraft";

type SessionState = {
  baselineDraftFingerprint: string;
  baselineValuesFingerprint: string;
  key: string;
  recovery: MatchWorkspaceSessionDraft | null;
};

export function useMatchWorkspaceSessionDraft({
  accountId,
  acknowledgedCellIds,
  enabled,
  mode,
  onRestore,
  values,
  workspaceKey,
}: {
  accountId: string | undefined;
  acknowledgedCellIds: readonly string[];
  enabled: boolean;
  mode: WorkspaceMode;
  onRestore: (draft: MatchWorkspaceSessionDraft) => void;
  values: MatchFormValues;
  workspaceKey: string;
}) {
  const storageScope = useMemo<MatchWorkspaceSessionDraftScope | null>(
    () => (accountId ? { accountId, mode, workspaceKey } : null),
    [accountId, mode, workspaceKey],
  );
  const storageKey = storageScope ? matchWorkspaceSessionDraftKey(storageScope) : null;
  const navigationAllowedRef = useRef(false);
  const restoredDraftRef = useRef<MatchWorkspaceSessionDraft | null>(null);
  const [committedKey, setCommittedKey] = useState<string | null>(null);
  const [sessionState, setSessionState] = useState<SessionState | null>(null);

  if (enabled && storageKey && storageScope && sessionState?.key !== storageKey) {
    const baselineValuesFingerprint = matchWorkspaceValuesFingerprint(values, mode);
    const baselineDraftFingerprint = matchWorkspaceDraftFingerprint({
      acknowledgedCellIds: [],
      mode,
      values,
    });
    const stored = loadMatchWorkspaceSessionDraft(storageScope);
    const recovery =
      stored && stored.baselineFingerprint === baselineValuesFingerprint ? stored : null;
    setSessionState({
      baselineDraftFingerprint,
      baselineValuesFingerprint,
      key: storageKey,
      recovery,
    });
  }

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

  const saveCurrentDraft = useCallback(
    (resumeAutomatically = false) => {
      if (!enabled || !activeState || !storageScope) return false;
      return saveMatchWorkspaceSessionDraft(storageScope, {
        accountId: storageScope.accountId,
        acknowledgedCellIds: [...acknowledgedCellIds],
        baselineFingerprint: activeState.baselineValuesFingerprint,
        resumeAutomatically,
        savedAt: new Date().toISOString(),
        values,
        version: 2,
      });
    },
    [acknowledgedCellIds, activeState, enabled, storageScope, values],
  );

  useEffect(() => {
    if (!activeState || activeState.recovery || !storageScope) {
      return;
    }
    if (!dirty) {
      removeMatchWorkspaceSessionDraft(storageScope);
      return;
    }
    saveCurrentDraft();
  }, [activeState, dirty, saveCurrentDraft, storageScope]);

  const restoreRecovery = useCallback(() => {
    const recovery = sessionState?.key === storageKey ? sessionState.recovery : null;
    if (!recovery || recovery === restoredDraftRef.current) {
      return;
    }
    restoredDraftRef.current = recovery;
    if (storageScope && recovery.resumeAutomatically) {
      saveMatchWorkspaceSessionDraft(storageScope, { ...recovery, resumeAutomatically: false });
    }
    onRestore(recovery);
    setSessionState((current) =>
      current?.key === storageKey ? { ...current, recovery: null } : current,
    );
  }, [onRestore, sessionState, storageKey, storageScope]);

  useEffect(() => {
    if (activeState?.recovery?.resumeAutomatically) restoreRecovery();
  }, [activeState, restoreRecovery]);

  const discardRecovery = useCallback(() => {
    if (storageScope) {
      removeMatchWorkspaceSessionDraft(storageScope);
    }
    setSessionState((current) =>
      current?.key === storageKey ? { ...current, recovery: null } : current,
    );
  }, [storageKey, storageScope]);

  const saveBeforeNavigate = useCallback(() => {
    if (!saveCurrentDraft(true)) return false;
    navigationAllowedRef.current = true;
    return true;
  }, [saveCurrentDraft]);

  const markCommitted = useCallback(() => {
    navigationAllowedRef.current = true;
    if (!storageKey || !storageScope) {
      return;
    }
    removeMatchWorkspaceSessionDraft(storageScope);
    setCommittedKey(storageKey);
  }, [storageKey, storageScope]);

  return {
    dirty,
    discardRecovery,
    markCommitted,
    navigationAllowedRef,
    recovery: activeState?.recovery?.resumeAutomatically ? null : (activeState?.recovery ?? null),
    restoreRecovery,
    saveBeforeLeave: saveCurrentDraft,
    saveBeforeNavigate,
  };
}
