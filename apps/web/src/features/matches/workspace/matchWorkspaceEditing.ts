import type {
  IncidentKey,
  MatchFormValues,
  MatchSetupValues,
  MatchWorkspaceInitialData,
} from "@/features/matches/workspace/matchFormTypes";
import type { MatchNumericDrafts } from "@/features/matches/workspace/matchNumericDrafts";
import { buildReviewItems } from "@/features/matches/workspace/review/reviewProgress";
import { reviewCellId } from "@/features/matches/workspace/review/reviewWarningModel";
import type { ReviewFieldKey } from "@/features/matches/workspace/review/reviewWarningModel";
import type { HeldEventResponse } from "@/shared/api/heldEvents";
import {
  emptyIncidentCountsByKey,
  incidentCountsByLabelToKey,
  incidentDefinitions,
} from "@/shared/domain/incidents";

export type EditablePlayerField = "memberId" | "rank" | "revenueManYen" | "totalAssetsManYen";
export type MatchWorkspaceEditingState = {
  values: MatchFormValues;
  lastIncidentSyncPlayerIndex: number | null;
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
    values,
    lastIncidentSyncPlayerIndex: null,
    acknowledgedCellIds: [],
    activeCellId: null,
    initialData: null,
    initialized: false,
  };
}

function replaceNumericDrafts(values: MatchFormValues, numericDrafts: MatchNumericDrafts) {
  const { numericDrafts: _previous, ...committed } = values;
  return Object.keys(numericDrafts).length > 0 ? { ...committed, numericDrafts } : committed;
}

function setNumericDraft(values: MatchFormValues, path: string, value: string | undefined) {
  if (values.numericDrafts?.[path] === value) return values;
  const numericDrafts = { ...values.numericDrafts };
  if (value === undefined) delete numericDrafts[path];
  else numericDrafts[path] = value;
  return replaceNumericDrafts(values, numericDrafts);
}

/** Preserve every other row's identity so one edit only updates its own subscribers. */
function updatePlayer(
  values: MatchFormValues,
  index: number,
  update: (player: MatchFormValues["players"][number]) => MatchFormValues["players"][number],
): MatchFormValues {
  return {
    ...values,
    players: values.players.map((player, row) => (row === index ? update(player) : player)),
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
        values,
        lastIncidentSyncPlayerIndex: null,
        acknowledgedCellIds: [...new Set(edit.acknowledgedCellIds.filter((id) => known.has(id)))],
      };
    }
    case "select-held-event":
      return {
        ...state,
        values: {
          ...state.values,
          heldEventId: edit.id,
          matchNoInEvent: edit.event?.nextMatchNo ?? 1,
          playedAt: edit.event?.heldAt ?? state.values.playedAt,
        },
      };
    case "change-setup":
      return {
        ...state,
        values: {
          ...state.values,
          ...(edit.field === "gameTitleId"
            ? { gameTitleId: String(edit.value), mapMasterId: "", seasonMasterId: "" }
            : { [edit.field]: edit.value }),
        },
      };
    case "change-note":
      return {
        ...state,
        values: { ...state.values, noteBody: edit.value },
      };
    case "change-numeric-draft": {
      const values = setNumericDraft(state.values, edit.path, edit.value);
      return values === state.values ? state : { ...state, values };
    }
    case "change-player": {
      const changed = updatePlayer(state.values, edit.index, (player) => ({
        ...player,
        [edit.field]: edit.value,
      }));
      const values = setNumericDraft(changed, `players.${edit.index}.${edit.field}`, undefined);
      return acknowledge({ ...state, values }, reviewCellId(edit.index, edit.field));
    }
    case "change-incident": {
      const changed = updatePlayer(state.values, edit.index, (player) => ({
        ...player,
        incidents: { ...player.incidents, [edit.key]: edit.value },
      }));
      const values = setNumericDraft(
        changed,
        `players.${edit.index}.incidents.${edit.key}`,
        undefined,
      );
      return acknowledge(
        {
          ...state,
          values,
          lastIncidentSyncPlayerIndex:
            state.lastIncidentSyncPlayerIndex === edit.index
              ? null
              : state.lastIncidentSyncPlayerIndex,
        },
        reviewCellId(edit.index, `incident.${edit.key}`),
      );
    }
    case "change-play-order": {
      const incidentByPlayOrder = state.initialData?.incidentByPlayOrder;
      const source = incidentByPlayOrder?.get(edit.value);
      let values = updatePlayer(state.values, edit.index, (player) => ({
        ...player,
        playOrder: edit.value,
        ...(incidentByPlayOrder
          ? {
              incidents: source
                ? incidentCountsByLabelToKey(source.counts)
                : emptyIncidentCountsByKey(),
            }
          : {}),
      }));
      // OCR incidents replace the row's visible incident input, including unfinished text.
      if (incidentByPlayOrder) {
        values = replaceNumericDrafts(
          values,
          Object.fromEntries(
            Object.entries(values.numericDrafts ?? {}).filter(
              ([path]) => !path.startsWith(`players.${edit.index}.incidents.`),
            ),
          ),
        );
      }
      const invalidated = new Set(
        incidentDefinitions.map((definition) =>
          reviewCellId(edit.index, `incident.${definition.key}`),
        ),
      );
      return acknowledge(
        {
          ...state,
          values,
          lastIncidentSyncPlayerIndex: incidentByPlayOrder
            ? edit.index
            : state.lastIncidentSyncPlayerIndex,
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
