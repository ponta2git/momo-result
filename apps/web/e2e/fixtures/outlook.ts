import type { Page } from "@playwright/test";

import {
  analysisArtifact,
  makeFourPlayerSeriesAnalysisReview,
  makeSeriesAnalysisOptions,
  makeSeriesAnalysisScopeStatus,
  makeSeriesAnalysisStatus,
} from "../../src/test/msw/seriesAnalysisFixtures";
import {
  makeSeriesAnalysisOutlookExamples,
  makeSeriesAnalysisOutlookSummary,
  makeSeriesAnalysisOutlookWindow,
} from "../../src/test/msw/seriesAnalysisOutlookFixtures";
import type { seedConfirmedContext } from "./records";

type Records = Awaited<ReturnType<typeof seedConfirmedContext>>;

/** Only analysis is controlled. Authentication and the seeded match remain on the real API. */
export async function installOutlookResponses(page: Page, records: Records) {
  const { gameTitleId, gameTitleName, mapMasterId, mapName, seasonMasterId, seasonName } = records;
  const artifact = {
    ...analysisArtifact,
    artifactId: `artifact-outlook-e2e-${gameTitleId}`,
    gameTitleId,
    inputRevision: "1",
  };
  const ownerSummary = await makeSeriesAnalysisOutlookSummary();
  const source = { ...ownerSummary.source, gameTitleId };
  const summary = await makeSeriesAnalysisOutlookSummary({ artifact, source });
  const options = makeSeriesAnalysisOptions();
  options.defaultGameTitleId = gameTitleId;
  options.titles = [
    {
      confirmedMatchCount: source.titleMatchCount,
      displayName: gameTitleName,
      gameTitleId,
      maps: [{ displayName: mapName, mapMasterId }],
      seasonMapPairs: [{ mapMasterId, seasonMasterId }],
      seasons: [{ displayName: seasonName, seasonMasterId }],
    },
  ];

  function allMapScope(params: URLSearchParams) {
    if (params.has("mapMasterId")) throw new Error("Outlook requested a map-specific resource");
    if (params.has("seasonMasterId")) {
      if (params.get("seasonMasterId") !== seasonMasterId)
        throw new Error("Outlook requested another season");
      return {
        kind: "season" as const,
        seasonMasterId,
        displayName: seasonName,
        matchCount: summary.scope.matchCount,
      };
    }
    return summary.scope;
  }

  await page.route(
    /\/api\/analytics\/series-comparison\/(?:v2\/(?:options|status|scope-status)|v3\/review|v1\/outlook-(?:summary|window|examples))(?:\?.*)?$/u,
    async (route) => {
      const url = new URL(route.request().url());
      const endpoint = url.pathname.split("/").at(-1);
      const params = url.searchParams;
      if (route.request().method() !== "GET")
        throw new Error("Analysis fixture supports reads only");
      if (endpoint === "options") return route.fulfill({ json: options });
      if (params.get("gameTitleId") !== gameTitleId)
        throw new Error("Analysis requested another title");
      if (endpoint === "status")
        return route.fulfill({
          json: makeSeriesAnalysisStatus({
            currentArtifact: artifact,
            desired: {
              algorithmVersion: artifact.algorithmVersion,
              artifactSchemaVersion: artifact.artifactSchemaVersion,
              inputRevision: artifact.inputRevision,
            },
            gameTitleId,
          }),
        });
      if (endpoint === "scope-status")
        return route.fulfill({
          json: makeSeriesAnalysisScopeStatus({
            artifactId: params.get("artifactId"),
            gameTitleId,
            seasonMasterId: params.get("seasonMasterId"),
            mapMasterId: params.get("mapMasterId"),
            seasonName: params.has("seasonMasterId") ? seasonName : null,
            mapName: params.has("mapMasterId") ? mapName : null,
          }),
        });
      if (params.get("artifactId") !== artifact.artifactId)
        throw new Error("Analysis requested an unpinned artifact");
      if (endpoint === "outlook-summary")
        return route.fulfill({
          json: await makeSeriesAnalysisOutlookSummary({
            artifact,
            source,
            scope: allMapScope(params),
          }),
        });
      if (endpoint === "review") {
        const review = makeFourPlayerSeriesAnalysisReview();
        review.artifact = artifact;
        review.scope = allMapScope(params);
        return route.fulfill({ json: review });
      }
      if (params.has("mapMasterId") || params.has("seasonMasterId"))
        throw new Error("Outlook references must use the whole title");
      const memberId = params.get("memberId");
      if (!memberId || !summary.players.some((player) => player.memberId === memberId))
        throw new Error("Outlook requested another member");
      const identity = { artifact, source, memberId };
      if (endpoint === "outlook-window")
        return route.fulfill({
          json: await makeSeriesAnalysisOutlookWindow(Number(params.get("windowSize")), identity),
        });
      return route.fulfill({ json: await makeSeriesAnalysisOutlookExamples(identity) });
    },
  );
  return { artifact, summary };
}
