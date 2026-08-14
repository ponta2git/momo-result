import { describe, expect, it } from "vitest";

import {
  matchesSeriesAnalysisResource,
  resolveSeriesAnalysisDisplayBundle,
} from "@/features/seriesComparison/model/seriesAnalysisDisplayBundle";
import {
  makeSeriesAnalysisAggregate,
  makeSeriesAnalysisMatchContext,
  makeSeriesAnalysisReview,
} from "@/test/msw/seriesAnalysisFixtures";

const state = {
  focusMatchId: "match-12",
  gameTitleId: "gt_momotetsu_2",
  view: "review",
} as const;

describe("series analysis display bundle", () => {
  it("resolves review and selected match without requiring aggregate", () => {
    const review = makeSeriesAnalysisReview();
    const matchContext = makeSeriesAnalysisMatchContext();
    const nextArtifact = { ...review.artifact, artifactId: "artifact-next" };

    expect(
      resolveSeriesAnalysisDisplayBundle({
        activeView: "review",
        aggregate: undefined,
        artifactId: nextArtifact.artifactId,
        matchContext,
        review,
        state,
      }),
    ).toEqual({ kind: "waiting" });

    review.artifact = nextArtifact;
    matchContext.artifact = nextArtifact;
    const resolved = resolveSeriesAnalysisDisplayBundle({
      activeView: "review",
      aggregate: undefined,
      artifactId: nextArtifact.artifactId,
      matchContext,
      review,
      state,
    });
    expect(resolved.kind).toBe("ready");
    if (resolved.kind !== "ready") throw new Error("ready bundle expected");
    expect(resolved.value.kind).toBe("review");
    if (resolved.value.kind !== "review") throw new Error("review bundle expected");
    expect(resolved.value.review.artifact.artifactId).toBe("artifact-next");
    expect(resolved.value.matchContext?.artifact.artifactId).toBe("artifact-next");
  });

  it("requires exact scope identity and reports deterministic focus exclusion", () => {
    const aggregate = makeSeriesAnalysisAggregate();
    aggregate.scope = {
      displayName: "今シーズン",
      kind: "season",
      matchCount: 12,
      seasonMasterId: "season_current",
    };
    expect(matchesSeriesAnalysisResource(aggregate, aggregate.artifact.artifactId, state)).toBe(
      false,
    );

    const matchContext = makeSeriesAnalysisMatchContext();
    matchContext.inclusion = { status: "not_in_scope" };
    matchContext.match = null;
    expect(
      resolveSeriesAnalysisDisplayBundle({
        activeView: "overview",
        aggregate: makeSeriesAnalysisAggregate(),
        artifactId: aggregate.artifact.artifactId,
        matchContext,
        review: undefined,
        state: { ...state, view: "overview" },
      }),
    ).toEqual({ kind: "excluded", status: "not_in_scope" });
  });

  it("resolves aggregate without requiring review outside the next-match purpose", () => {
    const aggregate = makeSeriesAnalysisAggregate();
    const resolved = resolveSeriesAnalysisDisplayBundle({
      activeView: "flow",
      aggregate,
      artifactId: aggregate.artifact.artifactId,
      matchContext: undefined,
      review: undefined,
      state: { gameTitleId: state.gameTitleId, view: "flow" },
    });
    expect(resolved.kind).toBe("ready");
    if (resolved.kind !== "ready") throw new Error("ready bundle expected");
    expect(resolved.value.kind).toBe("analysis");
  });
});
