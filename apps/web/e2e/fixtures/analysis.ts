import type { Page } from "@playwright/test";

import {
  analysisArtifact,
  makeFourPlayerSeriesAnalysisReview,
  makeSeriesAnalysisAggregate,
  makeSeriesAnalysisMatchContext,
  makeSeriesAnalysisOptions,
  makeSeriesAnalysisStatus,
} from "../../src/test/msw/seriesAnalysisFixtures";
import type { seedConfirmedContext } from "./records";

export async function installAnalysisResponses(
  page: Page,
  context: Awaited<ReturnType<typeof seedConfirmedContext>>,
) {
  const { gameTitleId, gameTitleName, mapMasterId, matchId, seasonMasterId } = context;
  const masterIdSuffix = gameTitleId;
  const artifact = {
    ...analysisArtifact,
    artifactId: `artifact-e2e-${masterIdSuffix}`,
    gameTitleId,
    inputRevision: "1",
  };
  const analysisScope = {
    displayName: "E2Eシーズン / E2Eマップ",
    kind: "season_map" as const,
    mapMasterId,
    matchCount: 1,
    seasonMasterId,
  };
  const optionsFixture = makeSeriesAnalysisOptions();
  optionsFixture.defaultGameTitleId = gameTitleId;
  optionsFixture.titles = [
    {
      confirmedMatchCount: 1,
      displayName: gameTitleName,
      gameTitleId,
      maps: [{ displayName: "E2Eマップ", mapMasterId }],
      seasonMapPairs: [{ mapMasterId, seasonMasterId }],
      seasons: [{ displayName: "E2Eシーズン", seasonMasterId }],
    },
  ];
  const aggregateFixture = makeSeriesAnalysisAggregate(artifact);
  aggregateFixture.scope = analysisScope;
  const recentMatch = aggregateFixture.matchDigest.recent[0];
  if (!recentMatch) throw new Error("analysis aggregate fixture requires a recent match");
  Object.assign(recentMatch, {
    itemId: `match:${matchId}`,
    matchId,
    matchIndex: 1,
    matchNoInEvent: 1,
  });
  const recentRankEntry = aggregateFixture.recentRanks[0];
  if (recentRankEntry) {
    recentRankEntry.rows = Array.from({ length: 20 }, (_, index) => {
      const isLatest = index === 19;
      const recentMatchId = isLatest ? matchId : `e2e-recent-${String(index + 1).padStart(2, "0")}`;
      return {
        itemId: `recent-rank:member_ponta:${recentMatchId}`,
        matchId: recentMatchId,
        playedAt: `2026-07-${String(index + 1).padStart(2, "0")}T12:00:00.000Z`,
        rank: isLatest ? 1 : (([1, 2, 3, 4] as const)[index % 4] ?? 1),
      };
    });
    recentRankEntry.targetCount = 20;
  }
  const reviewFixture = makeFourPlayerSeriesAnalysisReview();
  reviewFixture.artifact = artifact;
  reviewFixture.scope = analysisScope;
  const expandedReviewHypothesis = reviewFixture.playbookByPlayer[0]?.secondaryCards[0];
  if (!expandedReviewHypothesis)
    throw new Error("review navigation fixture requires a secondary card");
  const matchContextFixture = makeSeriesAnalysisMatchContext();
  matchContextFixture.artifact = artifact;
  matchContextFixture.matchId = matchId;
  matchContextFixture.scope = analysisScope;
  if (matchContextFixture.match) {
    matchContextFixture.match.matchIndex = 1;
    matchContextFixture.match.focusedItemIds = [
      `recent-rank:member_ponta:${matchId}`,
      `match:${matchId}`,
    ];
  }

  let statusPhase: "failed" | "running" = "running";
  const statusPattern = /\/api\/analytics\/series-comparison\/v2\/status(?:\?.*)?$/u;
  await page.route(/\/api\/analytics\/series-comparison\/v2\/options(?:\?.*)?$/u, async (route) =>
    route.fulfill({ json: optionsFixture }),
  );
  await page.route(statusPattern, async (route) => {
    const calculation =
      statusPhase === "running"
        ? {
            finishedAt: null,
            requestedAt: "2026-08-09T01:05:00.000Z",
            startedAt: "2026-08-09T01:05:01.000Z",
            status: "running" as const,
            trigger: "match_mutation" as const,
          }
        : {
            finishedAt: "2026-08-09T01:06:00.000Z",
            requestedAt: "2026-08-09T01:05:00.000Z",
            startedAt: "2026-08-09T01:05:01.000Z",
            status: "failed" as const,
            trigger: "match_mutation" as const,
          };
    await route.fulfill({
      json: makeSeriesAnalysisStatus({
        artifactFreshness: "stale",
        calculation,
        currentArtifact: artifact,
        desired: {
          algorithmVersion: artifact.algorithmVersion,
          artifactSchemaVersion: artifact.artifactSchemaVersion,
          inputRevision: "2",
        },
        gameTitleId,
      }),
    });
  });
  await page.route(/\/api\/analytics\/series-comparison\/v4\/aggregate(?:\?.*)?$/u, async (route) =>
    route.fulfill({ json: aggregateFixture }),
  );
  await page.route(/\/api\/analytics\/series-comparison\/v3\/review(?:\?.*)?$/u, async (route) =>
    route.fulfill({ json: reviewFixture }),
  );
  await page.route(
    /\/api\/analytics\/series-comparison\/v3\/match-context(?:\?.*)?$/u,
    async (route) => route.fulfill({ json: matchContextFixture }),
  );

  return {
    analysisScope,
    expandedReviewHypothesis,
    failCalculation: () => {
      statusPhase = "failed";
    },
  };
}
