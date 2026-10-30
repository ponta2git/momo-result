import { expect, test as base } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import type { components } from "../../src/shared/api/generated";
import {
  makeFourPlayerResults,
  makeHeldEventDetailResponse,
  makeHeldEventListItem,
  makeHeldEventResponse,
  makeMatchDetail,
} from "../../src/test/factories";
import {
  makeAchievementCatalog,
  makeAchievementResource,
} from "../../src/test/msw/achievementFixtures";
import { incidentMastersSeed, mswState } from "../../src/test/msw/fixtures";
import { makeSeriesAnalysisStatus } from "../../src/test/msw/seriesAnalysisFixtures";
import { confirmedContext, confirmedMatchIds } from "./fixtures/records";

export { expect };

// The automatic fixture is installed before scenario routes. Those routes may fall
// back to these explicit reads; an unknown API request can never reach a backend.
export const test = base.extend<{ mockedApi: void }>({
  mockedApi: [
    async ({ context }, use) => {
      const unexpected: string[] = [];
      const matches = confirmedMatchIds.map((matchId, index) =>
        makeMatchDetail({
          ...confirmedContext,
          matchId,
          matchNoInEvent: index + 1,
          layoutFamily: "momotetsu_2",
          players: makeFourPlayerResults(),
        }),
      );
      const summaries: Array<components["schemas"]["MatchSummaryResponse"]> = matches.map(
        (match) => ({
          createdAt: match.createdAt,
          updatedAt: match.createdAt,
          heldAt: match.heldAt ?? match.playedAt,
          gameTitleId: match.gameTitleId,
          gameTitleName: match.gameTitleName ?? confirmedContext.gameTitleName,
          seasonMasterId: match.seasonMasterId,
          seasonName: match.seasonName ?? confirmedContext.seasonName,
          mapMasterId: match.mapMasterId,
          mapName: match.mapName ?? confirmedContext.mapName,
          heldEventId: match.heldEventId ?? confirmedContext.heldEventId,
          id: match.matchId,
          kind: "match",
          matchId: match.matchId,
          matchNoInEvent: match.matchNoInEvent ?? 1,
          ownerMemberId: match.ownerMemberId,
          playedAt: match.playedAt,
          status: "confirmed",
          ...(match.matchNoInEvent === 1
            ? { hasNote: true, noteBody: "終盤にキングボンビーが付いた。" }
            : {}),
          ranks: (match.players ?? []).map(({ memberId, playOrder, rank }) => ({
            memberId,
            playOrder,
            rank,
          })),
        }),
      );
      const readResponses: Record<string, unknown> = {
        "/api/auth/me": {
          accountId: "account_ponta",
          csrfToken: "dev",
          displayName: "ぽんた",
          role: "admin",
          memberId: "member_ponta",
        } satisfies components["schemas"]["AuthMeResponse"],
        "/api/admin/login-accounts": { items: mswState.loginAccounts },
        "/api/game-titles": { items: mswState.gameTitles },
        "/api/map-masters": { items: mswState.mapMasters },
        "/api/season-masters": { items: mswState.seasonMasters },
        "/api/member-aliases": { items: mswState.memberAliases },
        "/api/incident-masters": { items: incidentMastersSeed },
        "/api/held-events/held-1": makeHeldEventDetailResponse({ matchCount: 2 }),
        "/api/held-events/held-1/summary": makeHeldEventResponse({ matchCount: 2 }),
        "/api/matches/summary": { incompleteCount: 0, needsReviewCount: 0 },
      };
      await context.route("**/api/**", async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        const path = url.pathname;
        if (request.method() === "GET") {
          if (path === "/api/achievements/catalog") {
            await route.fulfill({
              json: makeAchievementCatalog({
                gameTitleId: url.searchParams.get("gameTitleId") ?? confirmedContext.gameTitleId,
              }),
            });
            return;
          }
          if (path === "/api/achievements") {
            const resource = makeAchievementResource();
            resource.gameTitleId = url.searchParams.get("gameTitleId") ?? resource.gameTitleId;
            resource.artifact = {
              ...resource.artifact,
              gameTitleId: resource.gameTitleId,
              artifactId: url.searchParams.get("artifactId") ?? resource.artifact.artifactId,
            };
            await route.fulfill({ json: resource });
            return;
          }
          if (path === "/api/held-events") {
            // One held event holds the confirmed matches above. Scenarios using other search
            // contracts must supply their own responses before falling back.
            const unsupported = [
              "from",
              "to",
              "minMatchCount",
              "memberId",
              "metric",
              "metricValue",
              "metricRange",
            ].filter((key) => url.searchParams.has(key));
            if (unsupported.length > 0) {
              unexpected.push(`GET ${path}: unsupported conditions ${unsupported.join(", ")}`);
              await route.abort("blockedbyclient");
              return;
            }
            const q = url.searchParams.get("q");
            const noted = q ? summaries.filter((match) => match.noteBody?.includes(q)) : summaries;
            const scoped = (["gameTitleId", "seasonMasterId", "mapMasterId"] as const).every(
              (key) => {
                const requested = url.searchParams.get(key);
                return !requested || summaries.some((match) => match[key] === requested);
              },
            );
            const [firstNoted] = noted;
            const items =
              scoped && noted.length > 0
                ? [
                    makeHeldEventListItem({
                      averageRanks: [3, 1, 2, 4],
                      matchCount: summaries.length,
                      ...(q && firstNoted
                        ? {
                            noteMatch: {
                              matchId: firstNoted.matchId ?? firstNoted.id,
                              matchNoInEvent: firstNoted.matchNoInEvent ?? 1,
                              noteBody: firstNoted.noteBody ?? "",
                              otherMatchCount: noted.length - 1,
                            },
                          }
                        : {}),
                    }),
                  ]
                : [];
            const pageSize = Number(
              url.searchParams.get("pageSize") ?? url.searchParams.get("limit") ?? 10,
            );
            await route.fulfill({
              json: {
                items,
                latestHeldEventId: confirmedContext.heldEventId,
                pagination: pagination(1, pageSize, items.length),
                totalMatchCount: items.reduce((sum, item) => sum + item.matchCount, 0),
              } satisfies components["schemas"]["HeldEventListResponse"],
            });
            return;
          }
          if (path === "/api/matches") {
            // This shared fixture serves one page of confirmed matches. Scenarios using
            // other search contracts must supply their own responses before falling back.
            const unsupported = [
              "from",
              "to",
              "memberId",
              "record",
              "recordValue",
              "recordRange",
              "cursor",
            ].filter((key) => url.searchParams.has(key));
            if (unsupported.length > 0) {
              unexpected.push(`GET ${path}: unsupported conditions ${unsupported.join(", ")}`);
              await route.abort("blockedbyclient");
              return;
            }
            const items = summaries.filter((match) => {
              for (const key of [
                "heldEventId",
                "gameTitleId",
                "seasonMasterId",
                "mapMasterId",
              ] as const) {
                const requested = url.searchParams.get(key);
                if (requested && requested !== match[key]) return false;
              }
              const q = url.searchParams.get("q");
              if (q && !match.noteBody?.includes(q)) return false;
              const status = url.searchParams.get("status");
              return (
                url.searchParams.get("kind") !== "match_draft" &&
                (!status || status === "all" || status === "confirmed")
              );
            });
            const pageSize = Number(url.searchParams.get("pageSize") ?? 25);
            await route.fulfill({
              json: { items, pagination: pagination(1, pageSize, items.length) },
            });
            return;
          }
          const identity = matches.find((item) => path === `/api/matches/${item.matchId}/identity`);
          if (identity) {
            await route.fulfill({
              json: {
                matchId: identity.matchId,
                gameTitleId: identity.gameTitleId,
                mapMasterId: identity.mapMasterId,
                version: identity.version,
                matchNoInEvent: identity.matchNoInEvent,
                playedAt: identity.playedAt,
                gameTitleName: identity.gameTitleName ?? confirmedContext.gameTitleName,
                seasonName: identity.seasonName ?? confirmedContext.seasonName,
              } satisfies components["schemas"]["MatchIdentityResponse"],
            });
            return;
          }
          const match = matches.find((item) => path === `/api/matches/${item.matchId}`);
          if (match) {
            await route.fulfill({ json: match });
            return;
          }
          if (path === "/api/analytics/series-comparison/v2/status") {
            await route.fulfill({
              json: makeSeriesAnalysisStatus({
                artifactFreshness: "unavailable",
                calculation: null,
                currentArtifact: null,
                gameTitleId: url.searchParams.get("gameTitleId") ?? confirmedContext.gameTitleId,
              }),
            });
            return;
          }
          if (path in readResponses) {
            await route.fulfill({ json: readResponses[path] });
            return;
          }
        }
        unexpected.push(`${request.method()} ${path}`);
        await route.abort("blockedbyclient");
      });
      await use();
      expect(unexpected, "UI tests must explicitly mock every API request").toEqual([]);
    },
    { auto: true },
  ],
});

function pagination(page: number, pageSize: number, totalItems: number) {
  return {
    hasNextPage: false,
    hasPreviousPage: false,
    lastCursor: null,
    nextCursor: null,
    page,
    pageSize,
    previousCursor: null,
    totalItems,
    totalPages: totalItems ? 1 : 0,
  };
}

export async function installUiAuth(page: Page): Promise<void> {
  await page.addInitScript(() =>
    window.localStorage.setItem("momoresult.devUser", "account_ponta"),
  );
}

/** Exercise selection by its stable identity, preserving the native focus behavior. */
export async function selectControlOption(page: Page, trigger: Locator, value: string) {
  await trigger.click();
  const option = page
    .getByRole("option")
    .and(page.locator(`[data-value=${JSON.stringify(value)}]`));
  const label = await option.textContent();
  await option.click();
  await expect(trigger).toHaveText(label ?? "");
}
