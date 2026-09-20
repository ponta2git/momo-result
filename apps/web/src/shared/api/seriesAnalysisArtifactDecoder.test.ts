import { decodeSeriesAnalysisArtifact } from "@/shared/api/seriesAnalysisArtifactDecoder";
import {
  makeOwnerComparisonAggregate,
  makeFourPlayerSeriesAnalysisReview,
  makeSeriesAnalysisAggregate,
  makeSeriesAnalysisDrilldown,
  makeSeriesAnalysisExcludedMatchContext,
  makeSeriesAnalysisMatchContext,
  makeSeriesAnalysisReview,
} from "@/test/msw/seriesAnalysisFixtures";

import aggregateFixture from "../../../../../docs/schemas/fixtures/series-analysis/aggregate-payload-v5.json";
import drilldownFixture from "../../../../../docs/schemas/fixtures/series-analysis/drilldown-payload-v3.json";
import matchContextFixture from "../../../../../docs/schemas/fixtures/series-analysis/match-context-payload-v1.json";
import rankSignalsDrilldownFixture from "../../../../../docs/schemas/fixtures/series-analysis/rank-signals-drilldown-payload-v3.json";
import reviewFixture from "../../../../../docs/schemas/fixtures/series-analysis/review-payload-v4.json";

const artifact = {
  algorithmVersion: "series-analysis-v5",
  artifactId: "artifact-1",
  artifactSchemaVersion: 4,
  gameTitleId: "title-1",
  inputRevision: "1",
  publishedAt: "2026-08-29T00:00:00Z",
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hydrateMembers(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(hydrateMembers);
  if (!isObject(value)) return value;
  const hydrated = Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, hydrateMembers(child)]),
  );
  if (typeof hydrated["memberId"] === "string") hydrated["displayName"] = "プレーヤー";
  return hydrated;
}

function artifactResponse(fixture: unknown): Record<string, unknown> {
  const hydrated = hydrateMembers(structuredClone(fixture));
  if (!isObject(hydrated) || !isObject(hydrated["scope"])) {
    throw new Error("Invalid series analysis test fixture.");
  }
  hydrated["artifact"] = artifact;
  hydrated["scope"]["displayName"] = "総合";
  return hydrated;
}

function includedMatchContextResponse(): Record<string, unknown> {
  const response = artifactResponse(matchContextFixture);
  const sourceMatchRevision = response["sourceMatchRevision"];
  delete response["sourceMatchRevision"];
  response["inclusion"] = { sourceMatchRevision, status: "included" };
  return response;
}

describe("series analysis artifact response decoder", () => {
  it.each([
    ["aggregateV4", aggregateFixture],
    ["reviewV3", reviewFixture],
    ["drilldown", drilldownFixture],
    ["drilldown", rankSignalsDrilldownFixture],
    ["matchContext", includedMatchContextResponse()],
    ["matchContext", makeSeriesAnalysisExcludedMatchContext("not_in_scope")],
  ] as const)(
    "%s accepts only the current artifact generation (case %#)",
    async (kind, fixture) => {
      const response = artifactResponse(fixture);
      await expect(decodeSeriesAnalysisArtifact(kind, response)).resolves.toBe(response);
      for (const artifactSchemaVersion of [1, 2, 3, 99]) {
        await expect(
          decodeSeriesAnalysisArtifact(kind, {
            ...response,
            artifact: { ...artifact, artifactSchemaVersion },
          }),
        ).rejects.toThrow(`Invalid series analysis ${kind} response.`);
      }
    },
  );

  it.each([
    ["aggregateV4", aggregateFixture, [3, 4]],
    ["reviewV3", reviewFixture, [3]],
  ] as const)("%s rejects obsolete payload generations", async (kind, fixture, versions) => {
    const response = artifactResponse(fixture);
    for (const schemaVersion of versions) {
      await expect(
        decodeSeriesAnalysisArtifact(kind, {
          ...response,
          schemaVersion,
        }),
      ).rejects.toThrow(`Invalid series analysis ${kind} response.`);
    }
  });

  it("requires owner comparison data in an aggregate", async () => {
    const response = artifactResponse(aggregateFixture);
    delete response["ownerComparison"];
    await expect(decodeSeriesAnalysisArtifact("aggregateV4", response)).rejects.toThrow(
      "Invalid series analysis aggregateV4 response.",
    );
  });

  it.each([
    ["aggregateV4", makeSeriesAnalysisAggregate()],
    ["aggregateV4", makeOwnerComparisonAggregate()],
    ["reviewV3", makeSeriesAnalysisReview()],
    ["reviewV3", makeFourPlayerSeriesAnalysisReview()],
    ["drilldown", makeSeriesAnalysisDrilldown("rank.averageHistory")],
    ["matchContext", makeSeriesAnalysisMatchContext()],
  ] as const)("keeps the %s MSW contract fixture valid", async (kind, response) => {
    await expect(decodeSeriesAnalysisArtifact(kind, response)).resolves.toBe(response);
  });

  it("accepts both valid match-context outcomes", async () => {
    const included = includedMatchContextResponse();
    const excluded = {
      artifact,
      inclusion: { status: "not_in_scope" },
      match: null,
      matchId: "match-1",
      schemaVersion: 1,
      scope: { displayName: "総合", kind: "overall" },
    };

    await expect(decodeSeriesAnalysisArtifact("matchContext", included)).resolves.toBe(included);
    await expect(decodeSeriesAnalysisArtifact("matchContext", excluded)).resolves.toBe(excluded);
  });

  it("accepts owner-nullable timestamps and revenue ranks", async () => {
    const drilldown = artifactResponse(drilldownFixture);
    const payload = drilldown["payload"];
    if (
      !isObject(payload) ||
      !Array.isArray(payload["eventRows"]) ||
      !isObject(payload["eventRows"][0])
    ) {
      throw new Error("Missing rank history fixture.");
    }
    payload["eventRows"][0]["firstPlayedAt"] = null;

    const matchContext = includedMatchContextResponse();
    const match = matchContext["match"];
    if (!isObject(match) || !Array.isArray(match["players"]) || !isObject(match["players"][0])) {
      throw new Error("Missing match context fixture.");
    }
    match["playedAt"] = null;
    match["players"][0]["revenueRank"] = null;

    await expect(decodeSeriesAnalysisArtifact("drilldown", drilldown)).resolves.toBe(drilldown);
    await expect(decodeSeriesAnalysisArtifact("matchContext", matchContext)).resolves.toBe(
      matchContext,
    );
  });

  it("rejects malformed nested owner data and impossible exclusion states", async () => {
    const malformedAggregate = artifactResponse(aggregateFixture);
    const summary = malformedAggregate["summary"];
    if (!isObject(summary)) throw new Error("Missing aggregate summary fixture.");
    summary["averageRankSpread"] = "unknown";

    const impossibleExclusion = includedMatchContextResponse();
    impossibleExclusion["inclusion"] = { status: "not_in_scope" };

    await expect(decodeSeriesAnalysisArtifact("aggregateV4", malformedAggregate)).rejects.toThrow(
      "Invalid series analysis aggregateV4 response.",
    );
    await expect(decodeSeriesAnalysisArtifact("matchContext", impossibleExclusion)).rejects.toThrow(
      "Invalid series analysis matchContext response.",
    );
  });

  it("enforces response hydration and the owner UTF-8 byte bound", async () => {
    const missingDisplayName = artifactResponse(reviewFixture);
    const playbooks = missingDisplayName["playbookByPlayer"];
    if (!Array.isArray(playbooks) || !isObject(playbooks[0])) {
      throw new Error("Missing playbook fixture.");
    }
    const player = playbooks[0]["player"];
    if (!isObject(player)) throw new Error("Missing playbook player fixture.");
    delete player["displayName"];

    const oversizedUtf8 = artifactResponse(aggregateFixture);
    oversizedUtf8["artifact"] = { ...artifact, artifactId: "あ".repeat(1_400) };

    await expect(decodeSeriesAnalysisArtifact("reviewV3", missingDisplayName)).rejects.toThrow(
      "Invalid series analysis reviewV3 response.",
    );
    await expect(decodeSeriesAnalysisArtifact("aggregateV4", oversizedUtf8)).rejects.toThrow(
      "Invalid series analysis aggregateV4 response.",
    );
  });

  it("does not apply the owner payload byte bound to API-hydrated display names", async () => {
    const response = artifactResponse(reviewFixture);
    const playbooks = response["playbookByPlayer"];
    if (!Array.isArray(playbooks) || !isObject(playbooks[0])) {
      throw new Error("Missing playbook fixture.");
    }
    const player = playbooks[0]["player"];
    const scope = response["scope"];
    if (!isObject(player) || !isObject(scope)) throw new Error("Missing hydrated fixture.");
    const longDisplayName = "あ".repeat(1_400);
    player["displayName"] = longDisplayName;
    scope["displayName"] = longDisplayName;

    await expect(decodeSeriesAnalysisArtifact("reviewV3", response)).resolves.toBe(response);
  });
});
