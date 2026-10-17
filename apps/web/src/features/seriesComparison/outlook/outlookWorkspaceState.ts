import { outlookComparisonKey } from "@/features/seriesComparison/model/seriesAnalysisSelection";
import {
  areDistributionsCompatible,
  distributionFromCounts,
  distributionsEqual,
  incompatibleRanks,
} from "@/features/seriesComparison/outlook/calculation";
import type { RankDistribution } from "@/features/seriesComparison/outlook/calculation";
import type { SeriesAnalysisOutlookSummary } from "@/shared/api/seriesAnalysis";

export type OutlookRole = 0 | 1;
export type OutlookRankIndex = 0 | 1 | 2 | 3;
type Period = NonNullable<SeriesAnalysisOutlookSummary["recent"]["period"]>;
export type OutlookSource = {
  kind: "recent" | "average" | "counts" | "example";
  artifactId?: string;
  matchCount?: number;
  period?: Period;
};
export type OutlookEntry = {
  distribution: RankDistribution;
  source: OutlookSource;
  meanDraft?: string | undefined;
  error?: string | undefined;
};
type SavedEntry = Pick<OutlookEntry, "distribution" | "source">;
type Pair = [SavedEntry, SavedEntry];

export type OutlookWorkspaceState = {
  key: string;
  scopeKey: string;
  artifactId: string;
  entries: [OutlookEntry, OutlookEntry];
  history: Pair[];
  pinned?: Pair | undefined;
  gesture?: { role: OutlookRole; before: Pair } | undefined;
  task: "performance" | "goal";
  transfer: [OutlookRankIndex, OutlookRankIndex];
  horizon: number;
  horizonText: string;
  chartRange: 50 | 100 | 200;
  goalHorizon: number;
  goalHorizonText: string;
  examplesOpen: boolean;
  rivalExamplesOpen: boolean;
  notice?: string | undefined;
};

export const otherRole = (role: OutlookRole): OutlookRole => (role === 0 ? 1 : 0);
function snapshot(state: OutlookWorkspaceState): Pair {
  return state.entries.map(({ distribution, source }) => ({ distribution, source })) as Pair;
}

export function canPinOutlook(state: OutlookWorkspaceState): boolean {
  if (
    state.gesture ||
    state.entries.some((entry) => entry.meanDraft !== undefined || entry.error !== undefined)
  )
    return false;
  const pinned = state.pinned;
  return (
    !pinned ||
    state.entries.some(
      (entry, role) =>
        !distributionsEqual(entry.distribution, pinned[role as OutlookRole].distribution),
    )
  );
}

export function pinOutlook(state: OutlookWorkspaceState): OutlookWorkspaceState {
  return canPinOutlook(state) ? { ...state, pinned: snapshot(state), notice: undefined } : state;
}

/** Dialogs edit their own proposal; closing them leaves the page's conditions untouched. */
export function draftOutlook(state: OutlookWorkspaceState): OutlookWorkspaceState {
  return {
    ...state,
    entries: snapshot(state),
    history: [],
    gesture: undefined,
    notice: undefined,
  };
}

function restore(
  state: OutlookWorkspaceState,
  pair: Pair,
  clearDrafts = true,
): OutlookWorkspaceState {
  return {
    ...state,
    entries: state.entries.map((entry, i) => ({
      ...entry,
      ...pair[i],
      ...(clearDrafts ? { meanDraft: undefined, error: undefined } : {}),
    })) as OutlookWorkspaceState["entries"],
  };
}
function recentEntry(response: SeriesAnalysisOutlookSummary, memberId: string): OutlookEntry {
  const player = outlookPlayer(response.recent.players, memberId);
  return {
    distribution: distributionFromCounts(player.rankCounts as [number, number, number, number]),
    source: {
      kind: "recent",
      artifactId: response.artifact.artifactId,
      matchCount: response.recent.matchCount,
      ...(response.recent.period ? { period: response.recent.period } : {}),
    },
  };
}

export function outlookPlayer<T extends { memberId: string }>(
  players: readonly T[],
  memberId: string,
): T {
  const player = players.find((value) => value.memberId === memberId);
  if (!player) throw new Error("The outlook resource is missing a selected player.");
  return player;
}

/** Adoption happens atomically with the summary; editing never changes historical facts. */
export function adoptOutlookSummary(
  current: OutlookWorkspaceState | undefined,
  response: SeriesAnalysisOutlookSummary,
  scopeKey: string,
  memberIds: [string, string],
): OutlookWorkspaceState | undefined {
  if (
    !response.players.length ||
    memberIds.some((id) => !response.recent.players.some((player) => player.memberId === id))
  )
    return undefined;
  const key = outlookComparisonKey(scopeKey, memberIds);
  const artifactId = response.artifact.artifactId;
  if (current?.key === key && current.artifactId === artifactId) return current;
  const recent = memberIds.map((id) =>
    recentEntry(response, id),
  ) as OutlookWorkspaceState["entries"];
  if (!current || current.key !== key)
    return {
      key,
      scopeKey,
      artifactId,
      entries: recent,
      history: [],
      task: "performance",
      transfer: [2, 3],
      horizon: 20,
      horizonText: "20",
      chartRange: 100,
      goalHorizon: 100,
      goalHorizonText: "100",
      examplesOpen: false,
      rivalExamplesOpen: false,
    };
  const followRecent = current.entries.every(
    (entry) => entry.source.kind === "recent" && entry.source.artifactId === current.artifactId,
  );
  return {
    ...current,
    artifactId,
    history: [],
    pinned: undefined,
    gesture: undefined,
    entries: followRecent
      ? (recent.map((entry, i) => ({
          ...entry,
          meanDraft: current.entries[i as OutlookRole].meanDraft,
        })) as OutlookWorkspaceState["entries"])
      : current.entries,
    notice:
      (followRecent
        ? "直近の成績と総合成績を更新しました。"
        : "試している成績を残して実績を更新しました。") +
      (current.pinned ? "比較の基準に残した成績を解除しました。" : ""),
  };
}

export function updateOutlookEntry(
  state: OutlookWorkspaceState,
  role: OutlookRole,
  patch: Partial<OutlookEntry>,
): OutlookWorkspaceState {
  const entries = [...state.entries] as OutlookWorkspaceState["entries"];
  entries[role] = { ...entries[role], ...patch };
  return { ...state, entries };
}

export function applyOutlookDistribution(
  state: OutlookWorkspaceState,
  role: OutlookRole,
  distribution: RankDistribution,
  source: OutlookSource,
): OutlookWorkspaceState {
  if (!areDistributionsCompatible(distribution, state.entries[otherRole(role)].distribution)) {
    return updateOutlookEntry(state, role, {
      error: `${incompatibleRanks(distribution, state.entries[otherRole(role)].distribution)
        .map((rank) => `${rank}位`)
        .join("・")}は、相手と合わせて20回を超えます。相手の回数と両立するように調整してください。`,
    });
  }
  const prior = state.entries[role];
  if (
    distributionsEqual(prior.distribution, distribution) &&
    !(
      source.kind === "recent" &&
      (prior.source.kind !== "recent" || source.artifactId !== prior.source.artifactId)
    )
  )
    return updateOutlookEntry(state, role, {
      meanDraft: undefined,
      error: undefined,
    });
  const next = updateOutlookEntry(state, role, {
    distribution,
    source,
    meanDraft: undefined,
    error: undefined,
  });
  // Fifty complete gestures bound this one ephemeral comparison's history.
  return {
    ...next,
    history: state.gesture ? state.history : [...state.history, snapshot(state)].slice(-50),
    notice: undefined,
  };
}

export function beginOutlookGesture(
  state: OutlookWorkspaceState,
  role: OutlookRole,
): OutlookWorkspaceState {
  return state.gesture ? state : { ...state, gesture: { role, before: snapshot(state) } };
}

export function finishOutlookGesture(
  state: OutlookWorkspaceState,
  cancel = false,
): OutlookWorkspaceState {
  if (!state.gesture) return state;
  const { before } = state.gesture;
  const unchanged = state.entries.every((entry, i) =>
    distributionsEqual(entry.distribution, before[i as OutlookRole].distribution),
  );
  const next =
    cancel || unchanged
      ? restore(state, before, false)
      : { ...state, history: [...state.history, before].slice(-50) };
  return { ...next, gesture: undefined };
}

export function undoOutlook(state: OutlookWorkspaceState): OutlookWorkspaceState {
  const last = state.history.at(-1);
  if (state.gesture || !last) return state;
  return {
    ...restore(state, last),
    history: state.history.slice(0, -1),
    notice: undefined,
  };
}
