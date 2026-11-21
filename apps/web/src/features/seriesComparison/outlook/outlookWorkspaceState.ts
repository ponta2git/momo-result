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
type Period = NonNullable<SeriesAnalysisOutlookSummary["recent"]["period"]>;

/** Where a person's assumed distribution came from; values from results keep their artifact. */
export type OutlookSource =
  | { kind: "recent"; artifactId: string; matchCount: number; period?: Period | undefined }
  | { kind: "average" }
  | { kind: "example"; artifactId: string; period: Period };

export type OutlookEntry = {
  distribution: RankDistribution;
  source: OutlookSource;
  meanDraft?: string | undefined;
  error?: string | undefined;
};
type SavedEntry = Pick<OutlookEntry, "distribution" | "source">;
type SavedPair = readonly [SavedEntry, SavedEntry];

/** Shown once a newer artifact is adopted, until it is dismissed or the comparison changes. */
export type OutlookNotice = "followed-recent" | "kept-assumptions";
/** An application that was refused because the displayed condition no longer holds. */
export type OutlookRejection = "goal" | "example";

/**
 * The temporary assumptions of one comparison: two distributions with their drafts, one
 * continuous operation, and the goal. Everything else on the screen is derived.
 */
export type OutlookWorkspaceState = {
  key: string;
  scopeKey: string;
  artifactId: string;
  entries: [OutlookEntry, OutlookEntry];
  gesture?: { role: OutlookRole; before: SavedPair } | undefined;
  goalHorizon: number;
  goalHorizonText: string;
  notice?: OutlookNotice | undefined;
  rejection?: OutlookRejection | undefined;
};

export const otherRole = (role: OutlookRole): OutlookRole => (role === 0 ? 1 : 0);

const saved = (state: OutlookWorkspaceState): SavedPair => [
  { distribution: state.entries[0].distribution, source: state.entries[0].source },
  { distribution: state.entries[1].distribution, source: state.entries[1].source },
];

export function outlookPlayer<T extends { memberId: string }>(
  players: readonly T[],
  memberId: string,
): T {
  const player = players.find((value) => value.memberId === memberId);
  if (!player) throw new Error("The outlook resource is missing a selected player.");
  return player;
}

/** A person's recent results in the given artifact, as an exact distribution with its source. */
export function recentOutlookEntry(
  response: SeriesAnalysisOutlookSummary,
  memberId: string,
): SavedEntry {
  return {
    distribution: distributionFromCounts(
      outlookPlayer(response.recent.players, memberId).rankCounts,
    ),
    source: {
      kind: "recent",
      artifactId: response.artifact.artifactId,
      matchCount: response.recent.matchCount,
      period: response.recent.period ?? undefined,
    },
  };
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
  const recent: [OutlookEntry, OutlookEntry] = [
    recentOutlookEntry(response, memberIds[0]),
    recentOutlookEntry(response, memberIds[1]),
  ];
  if (!current || current.key !== key)
    return {
      key,
      scopeKey,
      artifactId,
      entries: recent,
      goalHorizon: 100,
      goalHorizonText: "100",
    };
  // Only values that still are this comparison's current recent results follow the update.
  const followRecent = current.entries.every(
    (entry) => entry.source.kind === "recent" && entry.source.artifactId === current.artifactId,
  );
  return {
    ...current,
    artifactId,
    gesture: undefined,
    rejection: undefined,
    entries: followRecent
      ? [
          { ...recent[0], meanDraft: current.entries[0].meanDraft },
          { ...recent[1], meanDraft: current.entries[1].meanDraft },
        ]
      : current.entries,
    notice: followRecent ? "followed-recent" : "kept-assumptions",
  };
}

export function updateOutlookEntry(
  state: OutlookWorkspaceState,
  role: OutlookRole,
  patch: Partial<OutlookEntry>,
): OutlookWorkspaceState {
  const entries: [OutlookEntry, OutlookEntry] = [state.entries[0], state.entries[1]];
  entries[role] = { ...entries[role], ...patch };
  return { ...state, entries };
}

/**
 * Sets one person's distribution if it can share games with the other person's distribution.
 * An incompatible value is refused with the ranks that overflow; neither person changes.
 */
export function applyOutlookDistribution(
  state: OutlookWorkspaceState,
  role: OutlookRole,
  distribution: RankDistribution,
  source: OutlookSource,
): OutlookWorkspaceState {
  const other = state.entries[otherRole(role)].distribution;
  if (!areDistributionsCompatible(distribution, other))
    return updateOutlookEntry(state, role, {
      error: `${incompatibleRanks(distribution, other)
        .map((rank) => `${rank}位`)
        .join(
          "・",
        )}は、相手と合わせると20戦あたり20回を超えます。相手の平均を変えてから試してください。`,
    });
  const prior = state.entries[role];
  const sameSource =
    prior.source.kind === source.kind &&
    (source.kind !== "recent" ||
      (prior.source.kind === "recent" && prior.source.artifactId === source.artifactId));
  if (distributionsEqual(prior.distribution, distribution) && sameSource)
    return updateOutlookEntry(state, role, { meanDraft: undefined, error: undefined });
  return {
    ...updateOutlookEntry(state, role, {
      distribution,
      source,
      meanDraft: undefined,
      error: undefined,
    }),
    rejection: undefined,
  };
}

export function beginOutlookGesture(
  state: OutlookWorkspaceState,
  role: OutlookRole,
): OutlookWorkspaceState {
  return state.gesture ? state : { ...state, gesture: { role, before: saved(state) } };
}

/** Ends one drag or key hold; cancelling, or ending where it began, restores the exact start. */
export function finishOutlookGesture(
  state: OutlookWorkspaceState,
  cancel = false,
): OutlookWorkspaceState {
  if (!state.gesture) return state;
  const { before } = state.gesture;
  const unchanged = state.entries.every((entry, i) =>
    distributionsEqual(entry.distribution, before[i as OutlookRole].distribution),
  );
  if (!cancel && !unchanged) return { ...state, gesture: undefined };
  return {
    ...state,
    gesture: undefined,
    entries: [
      { ...state.entries[0], ...before[0] },
      { ...state.entries[1], ...before[1] },
    ],
  };
}

/** True while the given person, or either person, has unapplied text or an error. */
export function outlookHasPendingInput(state: OutlookWorkspaceState, role?: OutlookRole): boolean {
  const roles: OutlookRole[] = role === undefined ? [0, 1] : [role];
  return roles.some(
    (value) =>
      state.entries[value].meanDraft !== undefined || state.entries[value].error !== undefined,
  );
}
