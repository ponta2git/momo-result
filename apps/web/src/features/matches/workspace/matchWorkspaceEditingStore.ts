import {
  createEmptyMatchForm,
  matchSetupValues,
} from "@/features/matches/workspace/matchFormTypes";
import type {
  IncidentKey,
  MatchFormValues,
  MatchSetupValues,
  MatchWorkspaceInitialData,
  OriginalPlayerSnapshot,
} from "@/features/matches/workspace/matchFormTypes";
import type { MatchNumericDrafts } from "@/features/matches/workspace/matchNumericDrafts";
import {
  createMatchWorkspaceEditingState,
  transitionMatchWorkspaceEditing,
} from "@/features/matches/workspace/matchWorkspaceEditing";
import type {
  EditablePlayerField,
  MatchWorkspaceEdit,
  MatchWorkspaceEditingState,
} from "@/features/matches/workspace/matchWorkspaceEditing";
import type { MatchWorkspaceSessionDraft } from "@/features/matches/workspace/matchWorkspaceSessionDraft";
import {
  buildReviewItems,
  countChangedReviewCells,
} from "@/features/matches/workspace/review/reviewProgress";
import type { ReviewItem } from "@/features/matches/workspace/review/reviewProgress";
import type { ReviewFieldKey } from "@/features/matches/workspace/review/reviewWarningModel";
import type { HeldEventResponse } from "@/shared/api/heldEvents";

export type WorkspaceSubscription<T> = {
  readonly getSnapshot: () => T;
  readonly subscribe: (listener: () => void) => () => void;
};

function sameFields<T extends object>(left: T, right: T): boolean {
  const keys = Object.keys(left) as Array<keyof T>;
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => Object.is(left[key], right[key]))
  );
}

export type MatchWorkspacePlayerView = Readonly<
  Omit<MatchFormValues["players"][number], "incidents">
> & {
  readonly incidents: Readonly<MatchFormValues["players"][number]["incidents"]>;
};
export type MatchWorkspaceOriginalPlayerView = Readonly<
  Pick<
    OriginalPlayerSnapshot,
    "memberId" | "playOrder" | "rank" | "revenueManYen" | "totalAssetsManYen"
  >
> & { readonly incidents: Readonly<OriginalPlayerSnapshot["incidents"]> };
export type MatchWorkspaceScoreRowView = {
  readonly player: MatchWorkspacePlayerView;
  readonly originalPlayer: MatchWorkspaceOriginalPlayerView | undefined;
  readonly originalByOrder: MatchWorkspaceOriginalPlayerView | undefined;
  readonly numericDrafts: Readonly<MatchNumericDrafts>;
  readonly acknowledgedCellIds: readonly string[];
  readonly items: ReadonlyArray<Readonly<ReviewItem>>;
  readonly synced: boolean;
};
export type MatchWorkspaceEditorBindings = {
  readonly setup: WorkspaceSubscription<Readonly<MatchSetupValues>>;
  readonly note: WorkspaceSubscription<string>;
  readonly scoreRows: ReadonlyArray<WorkspaceSubscription<MatchWorkspaceScoreRowView>>;
  readonly review: WorkspaceSubscription<{
    readonly acknowledgedCellIds: readonly string[];
    readonly activeCellId: string | null;
    readonly items: ReadonlyArray<Readonly<ReviewItem>>;
  }>;
  readonly actions: {
    readonly selectHeldEvent: (id: string, event: HeldEventResponse | undefined) => void;
    readonly changeSetup: <K extends Exclude<keyof MatchSetupValues, "heldEventId">>(
      field: K,
      value: MatchSetupValues[K],
    ) => void;
    readonly changeNote: (value: string) => void;
    readonly changePlayer: <K extends EditablePlayerField>(
      index: number,
      field: K,
      value: MatchFormValues["players"][number][K],
    ) => void;
    readonly changeIncident: (index: number, key: IncidentKey, value: number) => void;
    readonly changePlayOrder: (index: number, value: number) => void;
    readonly changeNumericDraft: (path: string, value: string | undefined) => void;
    readonly acknowledge: (cellId: string) => void;
    readonly focus: (row: number, field: ReviewFieldKey) => void;
  };
};

function sameList<T>(
  left: readonly T[],
  right: readonly T[],
  equal: (left: T, right: T) => boolean = Object.is,
): boolean {
  return (
    left.length === right.length && left.every((item, index) => equal(item, right[index] as T))
  );
}

/** One store per keyed workspace. Only editing state lives here; Query and IO stay in hooks. */
export function createMatchWorkspaceEditingStore(nowIso: string) {
  let state = createMatchWorkspaceEditingState(createEmptyMatchForm(nowIso));
  const projections: Array<{ refresh: () => void; notify: () => void }> = [];
  function createSubscription<T>(
    select: (current: MatchWorkspaceEditingState) => T,
    equal: (left: T, right: T) => boolean = Object.is,
  ): WorkspaceSubscription<T> {
    let snapshot = select(state);
    let changed = false;
    const listeners = new Set<() => void>();
    projections.push({
      refresh() {
        const next = select(state);
        changed = !equal(snapshot, next);
        if (changed) snapshot = next;
      },
      notify() {
        if (changed) {
          changed = false;
          for (const listener of listeners) listener();
        }
      },
    });
    return {
      getSnapshot: () => snapshot,
      subscribe(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    };
  }
  function commit(edit: MatchWorkspaceEdit) {
    const next = transitionMatchWorkspaceEditing(state, edit);
    if (next === state) return;
    state = next;
    // Refresh every view before publishing any of them: subscribers cannot see half an edit.
    for (const projection of projections) projection.refresh();
    for (const projection of projections) projection.notify();
  }
  let previousPlayers = state.values.players;
  let previousInitialData = state.initialData;
  let items = buildReviewItems({
    players: previousPlayers,
    originalPlayers: undefined,
    incidentByPlayOrder: undefined,
  });
  let changedCount = 0;
  function readReviewItems(current: MatchWorkspaceEditingState) {
    if (current.values.players !== previousPlayers || current.initialData !== previousInitialData) {
      previousPlayers = current.values.players;
      previousInitialData = current.initialData;
      const input = {
        players: previousPlayers,
        originalPlayers: previousInitialData?.originalPlayers,
        incidentByPlayOrder: previousInitialData?.incidentByPlayOrder,
      };
      const nextItems = buildReviewItems(input);
      if (!sameList(items, nextItems, sameFields)) items = nextItems;
      changedCount = countChangedReviewCells(input);
    }
    return items;
  }
  const setup = createSubscription((current) => matchSetupValues(current.values), sameFields);
  const resourceSelection = createSubscription(
    (current) => ({
      gameTitleId: current.values.gameTitleId,
      heldEventId: current.values.heldEventId,
      ...(current.values.matchDraftId ? { matchDraftId: current.values.matchDraftId } : {}),
      mapMasterId: current.values.mapMasterId,
      seasonMasterId: current.values.seasonMasterId,
    }),
    sameFields,
  );
  const note = createSubscription((current) => current.values.noteBody);
  const initialized = createSubscription((current) => current.initialized);
  const initialData = createSubscription((current) => current.initialData);
  const review = createSubscription(
    (current) => ({
      items: readReviewItems(current),
      acknowledgedCellIds: current.acknowledgedCellIds,
      activeCellId: current.activeCellId,
    }),
    sameFields,
  );
  let sourceOriginals: MatchWorkspaceInitialData | null = null;
  let originalViews: MatchWorkspaceOriginalPlayerView[] = [];
  function originalPlayerViews(data: MatchWorkspaceInitialData | null) {
    if (sourceOriginals !== data) {
      sourceOriginals = data;
      originalViews = (data?.originalPlayers ?? []).map(
        ({ memberId, playOrder, rank, revenueManYen, totalAssetsManYen, incidents }) => ({
          memberId,
          playOrder,
          rank,
          revenueManYen,
          totalAssetsManYen,
          incidents,
        }),
      );
    }
    return originalViews;
  }
  const scoreRows = state.values.players.map((_, index) =>
    createSubscription(
      (current) => {
        const player = current.values.players[index];
        if (!player) throw new Error("Workspace score row is unavailable");
        const prefix = `players.${index}.`;
        const originals = originalPlayerViews(current.initialData);
        return {
          player,
          originalPlayer: originals[index],
          originalByOrder: originals.find((original) => original.playOrder === player.playOrder),
          numericDrafts: Object.fromEntries(
            Object.entries(current.values.numericDrafts ?? {}).filter(([path]) =>
              path.startsWith(prefix),
            ),
          ),
          acknowledgedCellIds: current.acknowledgedCellIds.filter((id) =>
            id.startsWith(`player-${index}-`),
          ),
          items: readReviewItems(current).filter((item) => item.row === index),
          synced: current.lastIncidentSyncPlayerIndex === index,
        };
      },
      (left, right) =>
        left.player === right.player &&
        left.originalPlayer === right.originalPlayer &&
        left.originalByOrder === right.originalByOrder &&
        left.synced === right.synced &&
        sameFields(left.numericDrafts, right.numericDrafts) &&
        sameList(left.acknowledgedCellIds, right.acknowledgedCellIds) &&
        sameList(left.items, right.items, sameFields),
    ),
  );

  const persistence = createSubscription(
    (current) => ({ values: current.values, acknowledgedCellIds: current.acknowledgedCellIds }),
    sameFields,
  );
  const confirmation = createSubscription((current) => {
    const reviewList = readReviewItems(current);
    return {
      matchNoInEvent: current.values.matchNoInEvent,
      noteBody: current.values.noteBody,
      players: current.values.players,
      changedCount,
      totalCount: reviewList.length,
      unresolvedCount: reviewList.filter(
        (item) => !current.acknowledgedCellIds.includes(item.cellId),
      ).length,
    };
  }, sameFields);
  const actions = {
    selectHeldEvent: (id: string, event: HeldEventResponse | undefined) =>
      commit({ type: "select-held-event", id, event }),
    changeSetup: <K extends Exclude<keyof MatchSetupValues, "heldEventId">>(
      field: K,
      value: MatchSetupValues[K],
    ) => commit({ type: "change-setup", field, value }),
    changeNote: (value: string) => commit({ type: "change-note", value }),
    changePlayer: <K extends EditablePlayerField>(
      index: number,
      field: K,
      value: MatchFormValues["players"][number][K],
    ) => commit({ type: "change-player", index, field, value }),
    changeIncident: (index: number, key: IncidentKey, value: number) =>
      commit({ type: "change-incident", index, key, value }),
    changePlayOrder: (index: number, value: number) =>
      commit({ type: "change-play-order", index, value }),
    changeNumericDraft: (path: string, value: string | undefined) =>
      commit({ type: "change-numeric-draft", path, value }),
    acknowledge: (cellId: string) => commit({ type: "acknowledge", cellId }),
    focus: (row: number, field: ReviewFieldKey) => commit({ type: "focus", row, field }),
  };
  return {
    actions,
    setup,
    resourceSelection,
    note,
    initialData,
    initialized,
    review,
    scoreRows,
    confirmation,
    persistence,
    initialize: (values: MatchFormValues, data: MatchWorkspaceInitialData | null) =>
      commit({ type: "initialize", values, initialData: data }),
    restore: (draft: MatchWorkspaceSessionDraft) =>
      commit({
        type: "restore",
        values: draft.values,
        acknowledgedCellIds: draft.acknowledgedCellIds,
      }),
    readLatestValues: () => state.values,
  };
}

export type MatchWorkspaceEditingStore = ReturnType<typeof createMatchWorkspaceEditingStore>;
