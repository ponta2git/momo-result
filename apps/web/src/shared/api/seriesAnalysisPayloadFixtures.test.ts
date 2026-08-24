import { describe, expect, it } from "vitest";

import aggregate from "../../../../../docs/schemas/fixtures/series-analysis/aggregate-payload-v3.json";
import drilldown from "../../../../../docs/schemas/fixtures/series-analysis/drilldown-payload-v3.json";
import review from "../../../../../docs/schemas/fixtures/series-analysis/review-payload-v3.json";

describe("shared series-analysis payload fixtures", () => {
  it("pins the single supported resource payload generation", () => {
    expect(aggregate.schemaVersion).toBe(3);
    expect(review.schemaVersion).toBe(3);
    expect(drilldown.schemaVersion).toBe(3);
    expect(review.playbookByPlayer[0]?.primaryCard?.evidence[1]).toMatchObject({
      confidenceHigh: 0.9,
      confidenceLow: 0.2,
      method: "event_cluster_bootstrap_v1",
      stability: 0.75,
    });
  });
});
