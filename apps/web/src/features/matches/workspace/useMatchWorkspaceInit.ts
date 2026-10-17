import { useEffect, useLayoutEffect, useState } from "react";

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
  onSelectHeldEvent: (id: string, event: HeldEventResponse | undefined) => void;
  initialized: boolean;
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
  const { onSelectHeldEvent, onInitialize, nowIsoFactory, preferredHeldEventPending } = params;
  const [initial, setInitial] = useState<ReturnType<typeof buildWorkspaceInitialData> | null>(null);
  if (initial === null && isWorkspaceInitialDataReady(params)) {
    setInitial(buildWorkspaceInitialData(params, nowIsoFactory()));
  }
  useLayoutEffect(() => {
    if (initial && !params.initialized) onInitialize(initial.values, initial.workspaceData);
  }, [initial, onInitialize, params.initialized]);
  const initializedSnapshot = params.initialized ? (initial?.snapshot ?? null) : null;

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
    const id = initialHeldEventPatch.heldEventId;
    if (id)
      onSelectHeldEvent(
        id,
        params.heldEvents.find((event) => event.id === id),
      );
  }, [onSelectHeldEvent, initialHeldEventPatch, params.heldEvents]);

  if (!initializedSnapshot) return { status: "waiting-for-data", snapshot: null };
  return {
    status: preferredHeldEventPending || initialHeldEventPatch ? "waiting-for-held-event" : "ready",
    snapshot: initializedSnapshot,
  };
}
