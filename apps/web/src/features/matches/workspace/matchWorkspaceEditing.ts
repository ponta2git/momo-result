import {
  createMatchFormReducerState,
  matchFormReducer,
} from "@/features/matches/workspace/matchFormReducer";
import type { MatchFormReducerState } from "@/features/matches/workspace/matchFormReducer";
import type {
  IncidentKey,
  MatchFormValues,
  MatchSetupValues,
  MatchWorkspaceInitialData,
} from "@/features/matches/workspace/matchFormTypes";
import { buildReviewItems } from "@/features/matches/workspace/review/reviewProgress";
import { reviewCellId } from "@/features/matches/workspace/review/reviewWarningModel";
import type { ReviewFieldKey } from "@/features/matches/workspace/review/reviewWarningModel";
import type { HeldEventResponse } from "@/shared/api/heldEvents";
import { incidentDefinitions } from "@/shared/domain/incidents";

export type EditablePlayerField = "memberId" | "rank" | "revenueManYen" | "totalAssetsManYen";
export type MatchWorkspaceEditingState = MatchFormReducerState & {
  acknowledgedCellIds: string[];
  activeCellId: string | null;
  initialData: MatchWorkspaceInitialData | null;
  initialized: boolean;
};
export type MatchWorkspaceEdit =
  | { type: "initialize"; values: MatchFormValues; initialData: MatchWorkspaceInitialData | null }
  | { type: "restore"; values: MatchFormValues; acknowledgedCellIds: readonly string[] }
  | { type: "select-held-event"; id: string; event: HeldEventResponse | undefined }
  | {
      type: "change-setup";
      field: Exclude<keyof MatchSetupValues, "heldEventId">;
      value: string | number;
    }
  | { type: "change-note"; value: string }
  | { type: "change-player"; index: number; field: EditablePlayerField; value: string | number }
  | { type: "change-incident"; index: number; key: IncidentKey; value: number }
  | { type: "change-play-order"; index: number; value: number }
  | { type: "change-numeric-draft"; path: string; value: string | undefined }
  | { type: "acknowledge"; cellId: string }
  | { type: "focus"; row: number; field: ReviewFieldKey };

export function createMatchWorkspaceEditingState(
  values: MatchFormValues,
): MatchWorkspaceEditingState {
  return {
    ...createMatchFormReducerState(values),
    acknowledgedCellIds: [],
    activeCellId: null,
    initialData: null,
    initialized: false,
  };
}

function acknowledge(state: MatchWorkspaceEditingState, cellId: string) {
  return {
    ...state,
    activeCellId: cellId,
    acknowledgedCellIds: state.acknowledgedCellIds.includes(cellId)
      ? state.acknowledgedCellIds
      : [...state.acknowledgedCellIds, cellId],
  };
}

/** Values, unfinished numeric text and review acknowledgement commit as one edit. */
export function transitionMatchWorkspaceEditing(
  state: MatchWorkspaceEditingState,
  edit: MatchWorkspaceEdit,
): MatchWorkspaceEditingState {
  switch (edit.type) {
    case "initialize":
      return {
        ...createMatchWorkspaceEditingState(edit.values),
        initialData: edit.initialData,
        initialized: true,
      };
    case "restore": {
      const values = {
        ...edit.values,
        ...(state.values.matchDraftId ? { matchDraftId: state.values.matchDraftId } : {}),
      };
      const known = new Set(
        buildReviewItems({
          players: values.players,
          originalPlayers: state.initialData?.originalPlayers,
          incidentByPlayOrder: state.initialData?.incidentByPlayOrder,
        }).map((item) => item.cellId),
      );
      return {
        ...state,
        ...createMatchFormReducerState(values),
        acknowledgedCellIds: [...new Set(edit.acknowledgedCellIds.filter((id) => known.has(id)))],
      };
    }
    case "select-held-event":
      return {
        ...state,
        ...matchFormReducer(state, {
          type: "patch_root",
          patch: {
            heldEventId: edit.id,
            matchNoInEvent: edit.event?.nextMatchNo ?? 1,
            playedAt: edit.event?.heldAt ?? state.values.playedAt,
          },
        }),
      };
    case "change-setup":
      return {
        ...state,
        ...matchFormReducer(
          state,
          edit.field === "gameTitleId"
            ? { type: "change_game_title", gameTitleId: String(edit.value) }
            : { type: "patch_root", patch: { [edit.field]: edit.value } },
        ),
      };
    case "change-note":
      return {
        ...state,
        ...matchFormReducer(state, { type: "patch_root", patch: { noteBody: edit.value } }),
      };
    case "change-numeric-draft": {
      const next = matchFormReducer(state, {
        type: "set_numeric_draft",
        path: edit.path,
        value: edit.value,
      });
      return next === state ? state : { ...state, ...next };
    }
    case "change-player": {
      const changed = matchFormReducer(state, {
        type: "patch_player",
        index: edit.index,
        patch: { [edit.field]: edit.value },
      });
      const committed = matchFormReducer(changed, {
        type: "set_numeric_draft",
        path: `players.${edit.index}.${edit.field}`,
        value: undefined,
      });
      return acknowledge({ ...state, ...committed }, reviewCellId(edit.index, edit.field));
    }
    case "change-incident": {
      const changed = matchFormReducer(state, {
        type: "patch_incident",
        index: edit.index,
        key: edit.key,
        value: edit.value,
      });
      const committed = matchFormReducer(changed, {
        type: "set_numeric_draft",
        path: `players.${edit.index}.incidents.${edit.key}`,
        value: undefined,
      });
      return acknowledge(
        { ...state, ...committed },
        reviewCellId(edit.index, `incident.${edit.key}`),
      );
    }
    case "change-play-order": {
      const incidentByPlayOrder = state.initialData?.incidentByPlayOrder;
      const form = matchFormReducer(
        state,
        incidentByPlayOrder
          ? {
              type: "sync_incidents_from_play_order",
              index: edit.index,
              playOrder: edit.value,
              incidentByPlayOrder,
            }
          : { type: "set_play_order", index: edit.index, playOrder: edit.value },
      );
      const invalidated = new Set(
        incidentDefinitions.map((definition) =>
          reviewCellId(edit.index, `incident.${definition.key}`),
        ),
      );
      return acknowledge(
        {
          ...state,
          ...form,
          acknowledgedCellIds: state.acknowledgedCellIds.filter((id) => !invalidated.has(id)),
        },
        reviewCellId(edit.index, "playOrder"),
      );
    }
    case "acknowledge":
      return state.acknowledgedCellIds.includes(edit.cellId)
        ? state
        : { ...state, acknowledgedCellIds: [...state.acknowledgedCellIds, edit.cellId] };
    case "focus": {
      const activeCellId = reviewCellId(edit.row, edit.field);
      return state.activeCellId === activeCellId ? state : { ...state, activeCellId };
    }
  }
}
