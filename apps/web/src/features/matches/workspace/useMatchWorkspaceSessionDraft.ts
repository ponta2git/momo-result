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

  useEffect(() => {
    if (!activeState || activeState.recovery || !storageScope) {
      return;
    }
    if (!dirty) {
      removeMatchWorkspaceSessionDraft(storageScope);
      return;
    }
    saveMatchWorkspaceSessionDraft(storageScope, {
      accountId: storageScope.accountId,
      acknowledgedCellIds: [...acknowledgedCellIds],
      baselineFingerprint: activeState.baselineValuesFingerprint,
      savedAt: new Date().toISOString(),
      values,
      version: 2,
    });
  }, [acknowledgedCellIds, activeState, dirty, storageScope, values]);

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
    if (storageScope) {
      removeMatchWorkspaceSessionDraft(storageScope);
    }
    setSessionState((current) =>
      current?.key === storageKey ? { ...current, recovery: null } : current,
    );
  }, [storageKey, storageScope]);

  const allowNavigation = useCallback(() => {
    navigationAllowedRef.current = true;
  }, []);

  const markCommitted = useCallback(() => {
    navigationAllowedRef.current = true;
    if (!storageKey || !storageScope) {
      return;
    }
    removeMatchWorkspaceSessionDraft(storageScope);
    setCommittedKey(storageKey);
  }, [storageKey, storageScope]);

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
