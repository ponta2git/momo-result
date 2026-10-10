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
