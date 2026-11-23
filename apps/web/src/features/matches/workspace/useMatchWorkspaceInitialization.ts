import { useEffect, useLayoutEffect, useState } from "react";

import type {
  MatchFormValues,
  MatchWorkspaceInitialData,
} from "@/features/matches/workspace/matchFormTypes";
import {
  buildWorkspaceInitialData,
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
  initialHeldEvent: HeldEventResponse | undefined;
  initializationFailed: boolean;
  onFillSetup: (patch: Partial<RecordSetupChoice>) => void;
  initialized: boolean;
  onInitialize: (values: MatchFormValues, workspaceData: MatchWorkspaceInitialData | null) => void;
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
  const { onFillSetup, onInitialize, readNowIso, recordContextPending } = params;
  const [initial, setInitial] = useState<ReturnType<typeof buildWorkspaceInitialData> | null>(null);
  if (
    initial === null &&
    !recordContextPending &&
    !params.initializationFailed &&
    isWorkspaceInitialDataReady(params)
  ) {
    const data = buildWorkspaceInitialData(params, readNowIso());
    const event = params.initialHeldEvent;
    if (event && !data.values.heldEventId) {
      data.values = {
        ...data.values,
        heldEventId: event.id,
        matchNoInEvent: params.draftDetail?.matchNoInEvent ?? event.nextMatchNo,
        playedAt: params.draftDetail?.playedAt ?? event.heldAt,
      };
    }
    setInitial(data);
  }
  useLayoutEffect(() => {
    if (initial && !params.initialized) onInitialize(initial.values, initial.workspaceData);
  }, [initial, onInitialize, params.initialized]);
  const initializedSnapshot = params.initialized ? (initial?.snapshot ?? null) : null;

  // Once the held event is chosen, its previous match or a lone candidate fills the conditions
  // still empty; this also applies after a change of 作品 clears シーズン and マップ.
  const settingUp = initializedSnapshot !== null && params.mode !== "edit" && !recordContextPending;
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
  const settled = !(recordContextPending || fillKey || awaitingCandidates);
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
