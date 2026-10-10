import {
  areDistributionsCompatible,
  distributionFromCounts,
  distributionsEqual,
  incompatibleRanks,
} from "@/features/seriesComparison/model/outlook";
import type { RankDistribution } from "@/features/seriesComparison/model/outlook";
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

export type OutlookSession = {
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
function snapshot(session: OutlookSession): Pair {
  return session.entries.map(({ distribution, source }) => ({ distribution, source })) as Pair;
}

export function canPinOutlook(session: OutlookSession): boolean {
  if (
    session.gesture ||
    session.entries.some((entry) => entry.meanDraft !== undefined || entry.error !== undefined)
  )
    return false;
  const pinned = session.pinned;
  return (
    !pinned ||
    session.entries.some(
      (entry, role) =>
        !distributionsEqual(entry.distribution, pinned[role as OutlookRole].distribution),
    )
  );
}

export function pinOutlook(session: OutlookSession): OutlookSession {
  return canPinOutlook(session)
    ? { ...session, pinned: snapshot(session), notice: undefined }
    : session;
}

/** Dialogs edit their own proposal; closing them leaves the page's conditions untouched. */
export function draftOutlook(session: OutlookSession): OutlookSession {
  return {
    ...session,
    entries: snapshot(session),
    history: [],
    gesture: undefined,
    notice: undefined,
  };
}

function restore(session: OutlookSession, pair: Pair, clearDrafts = true): OutlookSession {
  return {
    ...session,
    entries: session.entries.map((entry, i) => ({
      ...entry,
      ...pair[i],
      ...(clearDrafts ? { meanDraft: undefined, error: undefined } : {}),
    })) as OutlookSession["entries"],
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
  current: OutlookSession | undefined,
  response: SeriesAnalysisOutlookSummary,
  scopeKey: string,
  memberIds: [string, string],
): OutlookSession | undefined {
  if (
    !response.players.length ||
    memberIds.some((id) => !response.recent.players.some((player) => player.memberId === id))
  )
    return undefined;
  const key = `${scopeKey}|${memberIds.join("|")}`;
  const artifactId = response.artifact.artifactId;
  if (current?.key === key && current.artifactId === artifactId) return current;
  const recent = memberIds.map((id) => recentEntry(response, id)) as OutlookSession["entries"];
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
        })) as OutlookSession["entries"])
      : current.entries,
    notice:
      (followRecent
        ? "直近の成績と総合成績を更新しました。"
        : "試している成績を残して実績を更新しました。") +
      (current.pinned ? "比較の基準に残した成績を解除しました。" : ""),
  };
}

export function updateOutlookEntry(
  session: OutlookSession,
  role: OutlookRole,
  patch: Partial<OutlookEntry>,
): OutlookSession {
  const entries = [...session.entries] as OutlookSession["entries"];
  entries[role] = { ...entries[role], ...patch };
  return { ...session, entries };
}

export function applyOutlookDistribution(
  session: OutlookSession,
  role: OutlookRole,
  distribution: RankDistribution,
  source: OutlookSource,
): OutlookSession {
  if (!areDistributionsCompatible(distribution, session.entries[otherRole(role)].distribution)) {
    return updateOutlookEntry(session, role, {
      error: `${incompatibleRanks(distribution, session.entries[otherRole(role)].distribution)
        .map((rank) => `${rank}位`)
        .join("・")}は、相手と合わせて20回を超えます。相手の回数と両立するように調整してください。`,
    });
  }
  const prior = session.entries[role];
  if (
    distributionsEqual(prior.distribution, distribution) &&
    !(
      source.kind === "recent" &&
      (prior.source.kind !== "recent" || source.artifactId !== prior.source.artifactId)
    )
  )
    return updateOutlookEntry(session, role, {
      meanDraft: undefined,
      error: undefined,
    });
  const next = updateOutlookEntry(session, role, {
    distribution,
    source,
    meanDraft: undefined,
    error: undefined,
  });
  // Fifty complete gestures bound this one ephemeral comparison's history.
  return {
    ...next,
    history: session.gesture ? session.history : [...session.history, snapshot(session)].slice(-50),
    notice: undefined,
  };
}

export function beginOutlookGesture(session: OutlookSession, role: OutlookRole): OutlookSession {
  return session.gesture ? session : { ...session, gesture: { role, before: snapshot(session) } };
}

export function finishOutlookGesture(session: OutlookSession, cancel = false): OutlookSession {
  if (!session.gesture) return session;
  const { before } = session.gesture;
  const unchanged = session.entries.every((entry, i) =>
    distributionsEqual(entry.distribution, before[i as OutlookRole].distribution),
  );
  const next =
    cancel || unchanged
      ? restore(session, before, false)
      : { ...session, history: [...session.history, before].slice(-50) };
  return { ...next, gesture: undefined };
}

export function undoOutlook(session: OutlookSession): OutlookSession {
  const last = session.history.at(-1);
  if (session.gesture || !last) return session;
  return {
    ...restore(session, last),
    history: session.history.slice(0, -1),
    notice: undefined,
  };
}
