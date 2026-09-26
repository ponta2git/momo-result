import type { Page } from "@playwright/test";

import type { components } from "../../src/shared/api/generated";
import { makeSeriesAnalysisStatus } from "../../src/test/msw/seriesAnalysisFixtures";

const heldEvents = [
  { id: "held-layout-first", heldAt: "2024-11-30T03:00:00.000Z" },
  { id: "held-layout-middle", heldAt: "2024-12-01T03:00:00.000Z" },
  { id: "held-layout-last", heldAt: "2024-12-01T03:00:00.000Z" },
] as const;

const matches = [
  {
    matchId: "match-layout-first",
    heldEventId: "held-layout-first",
    heldAt: "2024-12-01T03:00:00.000Z",
    playedAt: "2024-12-01T03:00:00.000Z",
    matchNoInEvent: 1,
  },
  {
    matchId: "match-layout-middle",
    heldEventId: "held-layout-middle",
    heldAt: "2024-11-30T03:00:00.000Z",
    playedAt: "2024-12-01T03:00:00.100Z",
    matchNoInEvent: 2,
  },
  {
    matchId: "match-layout-last",
    heldEventId: "held-layout-middle",
    heldAt: "2024-11-30T03:00:00.000Z",
    playedAt: "2024-12-01T03:00:00.200Z",
    matchNoInEvent: 3,
  },
] as const satisfies ReadonlyArray<components["schemas"]["AdjacentMatchResponse"]>;

const gameTitleId = "gt_navigation_layout";

/** Browser layout/focus fixtures; real API ordering is covered by the wire and API suites. */
export async function installAdjacentNavigationResponses(page: Page) {
  const eventDetails = heldEvents.map(
    (event, index): components["schemas"]["HeldEventDetailResponse"] => ({
      id: event.id,
      heldAt: event.heldAt,
      draftCount: 0,
      drafts: [],
      matchCount: 0,
      matches: [],
      navigation: {
        ...(heldEvents[index - 1] ? { previous: heldEvents[index - 1] } : {}),
        ...(heldEvents[index + 1] ? { next: heldEvents[index + 1] } : {}),
      },
      nextMatchNo: 1,
    }),
  );
  const matchDetails = matches.map(
    (match, index): components["schemas"]["MatchDetailResponse"] => ({
      matchId: match.matchId,
      heldEventId: match.heldEventId,
      heldAt: match.heldAt,
      playedAt: match.playedAt,
      matchNoInEvent: match.matchNoInEvent,
      createdAt: match.playedAt,
      createdByAccountId: "account_ponta",
      gameTitleId,
      gameTitleName: "桃太郎電鉄の長い作品名を省略せずに表示する確認",
      layoutFamily: "momotetsu_2",
      mapMasterId: "map_navigation_layout",
      mapName: "開催の条件を見失わないためのマップ名",
      navigation: {
        ...(matches[index - 1] ? { previous: matches[index - 1] } : {}),
        ...(matches[index + 1] ? { next: matches[index + 1] } : {}),
      },
      note: { body: "", version: "0" },
      ownerMemberId: "member_ponta",
      players: ["member_ponta", "member_akane_mami", "member_otaka", "member_eu"].map(
        (memberId, playerIndex) => ({
          incidents: {
            cardShop: 0,
            cardStation: 0,
            destination: 0,
            minusStation: 0,
            plusStation: 0,
            suriNoGinji: 0,
          },
          memberId,
          playOrder: playerIndex + 1,
          rank: playerIndex + 1,
          revenueManYen: 100,
          totalAssetsManYen: 1_000,
        }),
      ),
      seasonMasterId: "season_navigation_layout",
      seasonName: "複数の開催をまたいで戦績を記録するシーズン",
    }),
  );

  await page.route(/\/api\/held-events\/held-layout-[^/?]+$/u, async (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-1);
    const detail = eventDetails.find((event) => event.id === id);
    if (!detail) throw new Error(`Unexpected held-event layout fixture: ${id}`);
    await route.fulfill({ json: detail });
  });
  await page.route(/\/api\/matches\/match-layout-[^/?]+$/u, async (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-1);
    const detail = matchDetails.find((match) => match.matchId === id);
    if (!detail) throw new Error(`Unexpected match layout fixture: ${id}`);
    await route.fulfill({ json: detail });
  });
  await page.route(/\/api\/analytics\/series-comparison\/v2\/status(?:\?.*)?$/u, async (route) => {
    if (new URL(route.request().url()).searchParams.get("gameTitleId") !== gameTitleId) {
      await route.fallback();
      return;
    }
    await route.fulfill({
      json: makeSeriesAnalysisStatus({
        artifactFreshness: "unavailable",
        calculation: null,
        currentArtifact: null,
        gameTitleId,
      }),
    });
  });
}
