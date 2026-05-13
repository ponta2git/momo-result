import type {
  IncidentKey,
  IncidentLookupEntry,
  MatchFormValues,
} from "@/features/matches/workspace/matchFormTypes";
import { emptyIncidentCountsByKey, incidentCountsByLabelToKey } from "@/shared/domain/incidents";

type PlayerField = Exclude<keyof MatchFormValues["players"][number], "incidents">;

type MatchFormAction =
  | { patch: Partial<MatchFormValues>; type: "patch_root" }
  | { index: number; patch: Partial<MatchFormValues["players"][number]>; type: "patch_player" }
  | { index: number; key: IncidentKey; type: "patch_incident"; value: number }
  | { index: number; playOrder: number; type: "set_play_order" }
  | {
      index: number;
      incidentByPlayOrder: Map<number, IncidentLookupEntry>;
      playOrder: number;
      type: "sync_incidents_from_play_order";
    }
  | { payload: MatchFormValues; type: "replace" };

export type MatchFormReducerState = {
  lastSyncedPlayerIndex: number | null;
  values: MatchFormValues;
};

function syncedIncidents(entry: IncidentLookupEntry | undefined) {
  if (!entry) {
    return emptyIncidentCountsByKey();
  }
  return incidentCountsByLabelToKey(entry.counts);
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
    case "set_play_order":
      return {
        ...state,
        values: {
          ...state.values,
          players: state.values.players.map((player, index) =>
            index === action.index ? { ...player, playOrder: action.playOrder } : player,
          ) as MatchFormValues["players"],
        },
      };
    case "sync_incidents_from_play_order": {
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
