import { describe, expect, it } from "vitest";

import type { MatchFeatureBadge } from "@/features/matches/matchDetailViewModel";
import { buildMatchFeatureView } from "@/features/matches/matchFeatureViewModel";

const badge: MatchFeatureBadge = {
  description: "同じ条件の試合と比べた特徴",
  id: "close_finish",
  label: "接戦",
  tone: "neutral",
};

describe("buildMatchFeatureView", () => {
  const defaults = {
    failed: false,
    onRetry: () => undefined,
    retrying: false,
  };

  it("separates loading, ready-empty, with-items, failed, and unavailable states", () => {
    expect(
      buildMatchFeatureView({
        ...defaults,
        badges: [],
        included: false,
        loading: true,
        matchChanged: false,
      }),
    ).toEqual({ kind: "loading" });
    expect(
      buildMatchFeatureView({
        ...defaults,
        badges: [],
        included: true,
        loading: false,
        matchChanged: false,
      }),
    ).toMatchObject({ kind: "ready-empty" });
    expect(
      buildMatchFeatureView({
        ...defaults,
        badges: [badge],
        included: true,
        loading: false,
        matchChanged: false,
      }),
    ).toMatchObject({ badges: [badge], kind: "with-items" });
    expect(
      buildMatchFeatureView({
        ...defaults,
        badges: [],
        failed: true,
        included: false,
        loading: true,
        matchChanged: false,
        retrying: true,
      }),
    ).toMatchObject({ kind: "load-failed", retrying: true });
    expect(
      buildMatchFeatureView({
        ...defaults,
        badges: [],
        included: false,
        loading: false,
        matchChanged: true,
      }),
    ).toMatchObject({
      kind: "unavailable",
      message: expect.stringContaining("更新後"),
    });
  });
});
