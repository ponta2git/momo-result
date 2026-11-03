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
import type {
  GameTitleResponse,
  MapMasterResponse,
  SeasonMasterResponse,
} from "@/shared/api/masters";
import { fillRecordSetup } from "@/shared/heldEvents/recordContext";
import type { RecordSetupChoice } from "@/shared/heldEvents/recordContext";

export type MatchWorkspaceInitializationState =
  | { status: "waiting-for-data"; snapshot: null }
  | { status: "waiting-for-held-event"; snapshot: InitializedWorkspaceSnapshot }
  | { status: "ready"; snapshot: InitializedWorkspaceSnapshot };

export type MatchWorkspaceInitializationOptions = MatchWorkspaceInitializationSource & {
  onSelectHeldEvent: (id: string, event: HeldEventResponse | undefined) => void;
  onFillSetup: (patch: Partial<RecordSetupChoice>) => void;
  initialized: boolean;
  heldEventId: string;
  heldEvents: readonly HeldEventResponse[];
  onInitialize: (values: MatchFormValues, workspaceData: MatchWorkspaceInitialData | null) => void;
  preferredHeldEventId: string | undefined;
  recordContextPending: boolean;
  readNowIso: () => string;
  setup: RecordSetupChoice;
  previousMatchSetup: RecordSetupChoice | undefined;
  gameTitleItems: readonly GameTitleResponse[] | undefined;
  seasonItems: readonly SeasonMasterResponse[] | undefined;
  mapItems: readonly MapMasterResponse[] | undefined;
  mastersPending: boolean;
};

/** Captures one editable snapshot per keyed workspace; later reads never replace user input. */
export function useMatchWorkspaceInitialization(
  params: MatchWorkspaceInitializationOptions,
): MatchWorkspaceInitializationState {
  const { onFillSetup, onSelectHeldEvent, onInitialize, readNowIso, recordContextPending } = params;
  const [initial, setInitial] = useState<ReturnType<typeof buildWorkspaceInitialData> | null>(null);
  if (initial === null && isWorkspaceInitialDataReady(params)) {
    setInitial(buildWorkspaceInitialData(params, readNowIso()));
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
    preferredHeldEventPending: recordContextPending,
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

  // Once the held event is chosen, its previous match or a lone candidate fills the conditions
  // still empty; this also applies after a change of 作品 clears シーズン and マップ.
  const settingUp =
    initializedSnapshot !== null &&
    params.mode !== "edit" &&
    !initialHeldEventPatch &&
    !recordContextPending;
  const setupFill = settingUp
    ? fillRecordSetup({
        value: params.setup,
        previous: params.previousMatchSetup,
        gameTitles: params.gameTitleItems,
        seasons: params.seasonItems,
        maps: params.mapItems,
      })
    : undefined;
  const fillKey = setupFill && Object.keys(setupFill).length > 0 ? JSON.stringify(setupFill) : "";
  useEffect(() => {
    if (fillKey) onFillSetup(JSON.parse(fillKey) as Partial<RecordSetupChoice>);
  }, [fillKey, onFillSetup]);
  // The lists of a just-filled 作品 can still name its only シーズン or マップ; a new match also
  // opens with the names of the conditions it carried over rather than placeholders.
  const awaitingCandidates =
    params.mastersPending &&
    (params.mode === "create" || !params.setup.seasonMasterId || !params.setup.mapMasterId);

  // Ready is reached once: defaults filled after the user's own changes do not reopen setup,
  // which would reset the baseline that tells the user's input apart.
  const settled = !(recordContextPending || initialHeldEventPatch || fillKey || awaitingCandidates);
  const [readySnapshot, setReadySnapshot] = useState<InitializedWorkspaceSnapshot | null>(null);
  if (initializedSnapshot && settled && readySnapshot !== initializedSnapshot) {
    setReadySnapshot(initializedSnapshot);
  }

  if (!initializedSnapshot) return { status: "waiting-for-data", snapshot: null };
  return {
    status: readySnapshot === initializedSnapshot ? "ready" : "waiting-for-held-event",
    snapshot: initializedSnapshot,
  };
}
