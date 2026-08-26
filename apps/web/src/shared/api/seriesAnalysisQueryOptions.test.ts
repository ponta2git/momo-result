import { describe, expect, it } from "vitest";

import {
  seriesAnalysisAdminOverviewQueryOptions,
  seriesAnalysisStatusQueryOptions,
} from "@/shared/api/seriesAnalysisQueryOptions";

describe("series analysis live query options", () => {
  it.each([
    ["status", seriesAnalysisStatusQueryOptions("game-title-1")],
    ["admin overview", seriesAnalysisAdminOverviewQueryOptions("game-title-1")],
  ])("does not poll %s", (_, options) => {
    expect(options).not.toHaveProperty("refetchInterval");
    expect(options).not.toHaveProperty("refetchIntervalInBackground");
  });
});
