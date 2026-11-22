import type {
  SeriesAnalysisOutlookSummary,
  SeriesAnalysisOutlookWindow,
  SeriesAnalysisOutlookExamples,
} from "@/shared/api/seriesAnalysis";
import { decodeSeriesAnalysisArtifact } from "@/shared/api/seriesAnalysisArtifactDecoder";
import { canonicalResultMemberIds, memberDisplayName } from "@/shared/domain/members";
import { analysisArtifact } from "@/test/msw/seriesAnalysisFixtures";

import referenceFixture from "../../../../../docs/schemas/fixtures/series-analysis/outlook-reference-payload-v1.json" with { type: "json" };
import emptyFixture from "../../../../../docs/schemas/fixtures/series-analysis/outlook-summary-empty-payload-v1.json" with { type: "json" };
import summaryFixture from "../../../../../docs/schemas/fixtures/series-analysis/outlook-summary-payload-v1.json" with { type: "json" };

const memberIds = new Map(
  summaryFixture.players.map((player, index) => [
    player.memberId,
    canonicalResultMemberIds[index] ?? player.memberId,
  ]),
);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hydrate(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(hydrate);
  if (!isObject(value)) return value;
  const result = Object.fromEntries(
    Object.entries(value).map(([key, child]) => {
      if (["memberId", "memberAId", "memberBId"].includes(key) && typeof child === "string")
        return [key, memberIds.get(child) ?? child];
      return [key, hydrate(child)];
    }),
  );
  if (typeof result["memberId"] === "string")
    result["displayName"] = memberDisplayName(result["memberId"]);
  return result;
}

function envelope(value: unknown): Record<string, unknown> {
  const result = hydrate(value);
  if (!isObject(result) || !isObject(result["scope"]) || !isObject(result["source"]))
    throw new Error("Invalid owner outlook fixture");
  return {
    ...result,
    artifact: analysisArtifact,
    scope: { ...result["scope"], displayName: "総合" },
    source: { ...result["source"], gameTitleId: analysisArtifact.gameTitleId },
  };
}

/** Tests consume the owner fixture through the production generated decoder. */
export function makeSeriesAnalysisOutlookSummary(
  overrides: Partial<SeriesAnalysisOutlookSummary> = {},
  empty = false,
): Promise<SeriesAnalysisOutlookSummary> {
  return decodeSeriesAnalysisArtifact("outlookSummary", {
    ...envelope(empty ? emptyFixture : summaryFixture),
    ...overrides,
  });
}

export function makeSeriesAnalysisOutlookWindow(
  windowSize: number,
  overrides: Partial<SeriesAnalysisOutlookWindow> = {},
): Promise<SeriesAnalysisOutlookWindow> {
  const { schemaVersion, scope, source, memberId, displayName, artifact } =
    envelope(referenceFixture);
  const window =
    referenceFixture.bestWindows.find((entry) => entry.windowSize === windowSize) ?? null;
  if (!window && windowSize <= referenceFixture.source.titleMatchCount)
    throw new Error("Owner fixture is missing the requested outlook window");
  return decodeSeriesAnalysisArtifact("outlookWindow", {
    schemaVersion,
    scope,
    source,
    memberId,
    artifact,
    status: window ? "available" : "insufficient",
    windowSize,
    window,
    ...overrides,
    displayName:
      overrides.displayName ??
      (overrides.memberId ? memberDisplayName(overrides.memberId) : displayName),
  });
}

export function makeSeriesAnalysisOutlookExamples(
  overrides: Partial<SeriesAnalysisOutlookExamples> = {},
): Promise<SeriesAnalysisOutlookExamples> {
  const { schemaVersion, scope, source, memberId, displayName, artifact, examples } =
    envelope(referenceFixture);
  return decodeSeriesAnalysisArtifact("outlookExamples", {
    schemaVersion,
    scope,
    source,
    memberId,
    artifact,
    examples,
    ...overrides,
    displayName:
      overrides.displayName ??
      (overrides.memberId ? memberDisplayName(overrides.memberId) : displayName),
  });
}

type OutlookRankCounts = SeriesAnalysisOutlookSummary["recent"]["players"][number]["rankCounts"];
type OutlookJointRanks = SeriesAnalysisOutlookSummary["recent"]["jointRanks"][number]["rankCounts"];

/**
 * A summary whose only games are `matches` (each row lists the canonical members' ranks), for
 * exact short-window rationals such as 4/3.
 */
export async function makeShortWindowOutlookSummary(
  matches: ReadonlyArray<readonly [number, number, number, number]> = [
    [1, 2, 3, 4],
    [1, 2, 4, 3],
    [2, 1, 3, 4],
  ],
): Promise<SeriesAnalysisOutlookSummary> {
  const base = await makeSeriesAnalysisOutlookSummary();
  const matchCount = matches.length;
  const players = base.recent.players.map((player, memberIndex) => {
    const rankCounts = [1, 2, 3, 4].map(
      (rank) => matches.filter((match) => match[memberIndex] === rank).length,
    ) as OutlookRankCounts;
    const rankSum = rankCounts.reduce((sum, count, index) => sum + count * (index + 1), 0);
    return { ...player, rankCounts, rankSum, averageRank: rankSum / matchCount };
  });
  const period = {
    startMatchId: "synthetic-1",
    endMatchId: `synthetic-${matchCount}`,
    startSequence: 1,
    endSequence: matchCount,
    startedAt: "2026-01-01T00:00:00.000000Z",
    endedAt: `2026-01-01T00:00:00.${String(matchCount - 1).padStart(6, "0")}Z`,
  };
  const jointRanks = base.recent.jointRanks.map((pair) => {
    const first = players.findIndex((player) => player.memberId === pair.memberAId);
    const second = players.findIndex((player) => player.memberId === pair.memberBId);
    return {
      ...pair,
      rankCounts: [1, 2, 3, 4].map((a) =>
        [1, 2, 3, 4].map(
          (b) => matches.filter((match) => match[first] === a && match[second] === b).length,
        ),
      ) as OutlookJointRanks,
    };
  });
  return makeSeriesAnalysisOutlookSummary({
    ...base,
    period,
    scope: { ...base.scope, matchCount },
    source: { ...base.source, titleMatchCount: matchCount },
    recent: { ...base.recent, period, matchCount, players, jointRanks },
    players: players.map(({ rankCounts: _counts, ...player }) => player),
  });
}

/** A newer artifact after a legal correction of the recent games; older games are unchanged. */
export async function makeCorrectedOutlookSummary(
  base: SeriesAnalysisOutlookSummary,
): Promise<SeriesAnalysisOutlookSummary> {
  const players = base.recent.players.map((player) => {
    const rankCounts: OutlookRankCounts = [
      player.rankCounts[3],
      player.rankCounts[0],
      player.rankCounts[1],
      player.rankCounts[2],
    ];
    const rankSum = rankCounts.reduce((sum, count, index) => sum + count * (index + 1), 0);
    return { ...player, rankCounts, rankSum, averageRank: rankSum / base.recent.matchCount };
  });
  return makeSeriesAnalysisOutlookSummary({
    ...base,
    artifact: { ...base.artifact, artifactId: "artifact-corrected", inputRevision: "13" },
    recent: {
      ...base.recent,
      players,
      jointRanks: base.recent.jointRanks.map((pair) => ({
        ...pair,
        rankCounts: Array.from({ length: 4 }, (_row, i) =>
          Array.from({ length: 4 }, (_column, j) => pair.rankCounts[(i + 3) % 4]![(j + 3) % 4]!),
        ) as OutlookJointRanks,
      })),
    },
    players: base.players.map((player) => {
      const previous = base.recent.players.find((recent) => recent.memberId === player.memberId)!;
      const next = players.find((recent) => recent.memberId === player.memberId)!;
      const rankSum = player.rankSum + next.rankSum - previous.rankSum;
      return { ...player, rankSum, averageRank: rankSum / base.scope.matchCount };
    }),
  });
}
