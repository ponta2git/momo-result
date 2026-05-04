import type { IncidentLookupEntry } from "@/features/draftReview/reviewViewModel";
import type { IncidentKey, MatchFormValues } from "@/features/matches/workspace/matchFormTypes";

type PlayerField = Exclude<keyof MatchFormValues["players"][number], "incidents">;

type MatchFormAction =
  | { patch: Partial<MatchFormValues>; type: "patch_root" }
  | { index: number; patch: Partial<MatchFormValues["players"][number]>; type: "patch_player" }
  | { index: number; key: IncidentKey; type: "patch_incident"; value: number }
  | {
      index: number;
      incidentByPlayOrder?: Map<number, IncidentLookupEntry>;
      playOrder: number;
      type: "set_play_order";
    }
  | { payload: MatchFormValues; type: "replace" };

export type MatchFormReducerState = {
  lastSyncedPlayerIndex: number | null;
  values: MatchFormValues;
};

function syncedIncidents(entry: IncidentLookupEntry | undefined) {
  if (!entry) {
    return {
      cardShop: 0,
      cardStation: 0,
      destination: 0,
      minusStation: 0,
      plusStation: 0,
      suriNoGinji: 0,
    };
  }
  return {
    cardShop: entry.counts["カード売り場"],
    cardStation: entry.counts["カード駅"],
    destination: entry.counts["目的地"],
    minusStation: entry.counts["マイナス駅"],
    plusStation: entry.counts["プラス駅"],
    suriNoGinji: entry.counts["スリの銀次"],
  };
}

export function createMatchFormReducerState(values: MatchFormValues): MatchFormReducerState {
  return {
    lastSyncedPlayerIndex: null,
    values,
  };
}

export function matchFormReducer(
  state: MatchFormReducerState,
  action: MatchFormAction,
): MatchFormReducerState {
  switch (action.type) {
    case "replace":
      return createMatchFormReducerState(action.payload);
    case "patch_root":
      return {
        ...state,
        values: {
          ...state.values,
          ...action.patch,
        },
      };
    case "patch_player":
      return {
        ...state,
        values: {
          ...state.values,
          players: state.values.players.map((player, index) =>
            index === action.index ? { ...player, ...action.patch } : player,
          ) as MatchFormValues["players"],
        },
      };
    case "patch_incident":
      return {
        lastSyncedPlayerIndex:
          state.lastSyncedPlayerIndex === action.index ? null : state.lastSyncedPlayerIndex,
        values: {
          ...state.values,
          players: state.values.players.map((player, index) =>
            index === action.index
              ? {
                  ...player,
                  incidents: {
                    ...player.incidents,
                    [action.key]: action.value,
                  },
                }
              : player,
          ) as MatchFormValues["players"],
        },
      };
    case "set_play_order": {
      const lookup = action.incidentByPlayOrder?.get(action.playOrder);
      return {
        lastSyncedPlayerIndex: action.index,
        values: {
          ...state.values,
          players: state.values.players.map((player, index) =>
            index === action.index
              ? {
                  ...player,
                  incidents: syncedIncidents(lookup),
                  playOrder: action.playOrder,
                }
              : player,
          ) as MatchFormValues["players"],
        },
      };
    }
  }
}

export function playerFieldPatch<K extends PlayerField>(
  key: K,
  value: MatchFormValues["players"][number][K],
): Partial<MatchFormValues["players"][number]> {
  return { [key]: value } as Partial<MatchFormValues["players"][number]>;
}
