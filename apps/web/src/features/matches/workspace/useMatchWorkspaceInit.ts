import { useEffect, useState } from "react";
import type { Dispatch } from "react";

import type { MatchFormAction } from "@/features/matches/workspace/matchFormReducer";
import type {
  MatchFormValues,
  MatchWorkspaceInitialData,
} from "@/features/matches/workspace/matchFormTypes";
import {
  buildWorkspaceInitialData,
  initialWorkspaceHeldEventPatch,
  isWorkspaceInitialDataReady,
} from "@/features/matches/workspace/matchWorkspaceInitialization";
import type {
  InitializedWorkspaceSnapshot,
  MatchWorkspaceInitializationSource,
} from "@/features/matches/workspace/matchWorkspaceInitialization";
import type { HeldEventResponse } from "@/shared/api/heldEvents";

export type MatchWorkspaceInitialization =
  | { status: "waiting-for-data"; snapshot: null }
  | { status: "waiting-for-held-event"; snapshot: InitializedWorkspaceSnapshot }
  | { status: "ready"; snapshot: InitializedWorkspaceSnapshot };

export type MatchWorkspaceInitParams = MatchWorkspaceInitializationSource & {
  dispatch: Dispatch<MatchFormAction>;
  heldEventId: string;
  heldEvents: readonly HeldEventResponse[];
  onInitialize: (values: MatchFormValues, workspaceData: MatchWorkspaceInitialData | null) => void;
  preferredHeldEventId: string | undefined;
  preferredHeldEventPending: boolean;
  nowIsoFactory: () => string;
};

/** Captures one editable snapshot per keyed workspace; later reads never replace user input. */
export function useMatchWorkspaceInit(
  params: MatchWorkspaceInitParams,
): MatchWorkspaceInitialization {
  const { dispatch, onInitialize, nowIsoFactory, preferredHeldEventPending } = params;
  const [initializedSnapshot, setInitializedSnapshot] =
    useState<InitializedWorkspaceSnapshot | null>(null);

  // The command updates state owned by this component. React retries its render before
  // committing children, so initial values and readiness become visible together.
  if (initializedSnapshot === null && isWorkspaceInitialDataReady(params)) {
    const initial = buildWorkspaceInitialData(params, nowIsoFactory());
    onInitialize(initial.values, initial.workspaceData);
    setInitializedSnapshot(initial.snapshot);
  }

  const initialHeldEventPatch = initialWorkspaceHeldEventPatch({
    initialized: initializedSnapshot !== null,
    mode: params.mode,
    heldEventId: params.heldEventId,
    heldEvents: params.heldEvents,
    preferredHeldEventId: params.preferredHeldEventId,
    preferredHeldEventPending,
  });
  useEffect(() => {
    if (!initialHeldEventPatch) return;
    dispatch({ patch: initialHeldEventPatch, type: "patch_root" });
  }, [dispatch, initialHeldEventPatch]);

  if (!initializedSnapshot) return { status: "waiting-for-data", snapshot: null };
  return {
    status: preferredHeldEventPending || initialHeldEventPatch ? "waiting-for-held-event" : "ready",
    snapshot: initializedSnapshot,
  };
}
