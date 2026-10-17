// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  matchesSeriesAnalysisResource,
  prepareSeriesAnalysisDisplayBundle,
} from "@/features/seriesComparison/model/seriesAnalysisDisplayBundle";
import {
  makeSeriesAnalysisAggregate,
  makeSeriesAnalysisExcludedMatchContext,
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
      prepareSeriesAnalysisDisplayBundle({
        activeView: "review",
        aggregate: undefined,
        artifactId: nextArtifact.artifactId,
        matchContext,
        review,
        selection: state,
      }),
    ).toEqual({ candidate: undefined, resolution: { kind: "waiting" } });

    review.artifact = nextArtifact;
    const waiting = prepareSeriesAnalysisDisplayBundle({
      activeView: "review",
      aggregate: undefined,
      artifactId: nextArtifact.artifactId,
      matchContext,
      review,
      selection: state,
    });
    expect(waiting.resolution).toEqual({ kind: "waiting" });
    expect(waiting.candidate?.kind).toBe("review");
    if (waiting.candidate?.kind !== "review") throw new Error("review candidate expected");
    expect(waiting.candidate.review).toBe(review);
    expect(waiting.candidate.matchContext).toBeUndefined();

    matchContext.artifact = nextArtifact;
    const { resolution: resolved } = prepareSeriesAnalysisDisplayBundle({
      activeView: "review",
      aggregate: undefined,
      artifactId: nextArtifact.artifactId,
      matchContext,
      review,
      selection: state,
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

    const matchContext = makeSeriesAnalysisExcludedMatchContext("not_in_scope");
    expect(
      prepareSeriesAnalysisDisplayBundle({
        activeView: "overview",
        aggregate: makeSeriesAnalysisAggregate(),
        artifactId: aggregate.artifact.artifactId,
        matchContext,
        review: undefined,
        selection: { ...state, view: "overview" },
      }).resolution,
    ).toEqual({ kind: "excluded", status: "not_in_scope" });
  });

  it("resolves aggregate without requiring review outside the next-match purpose", () => {
    const aggregate = makeSeriesAnalysisAggregate();
    const { resolution: resolved } = prepareSeriesAnalysisDisplayBundle({
      activeView: "flow",
      aggregate,
      artifactId: aggregate.artifact.artifactId,
      matchContext: undefined,
      review: undefined,
      selection: { gameTitleId: state.gameTitleId, view: "flow" },
    });
    expect(resolved.kind).toBe("ready");
    if (resolved.kind !== "ready") throw new Error("ready bundle expected");
    expect(resolved.value.kind).toBe("analysis");
  });
});
