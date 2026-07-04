// @vitest-environment node
import { describe, expect, it } from "vitest";

import { buildExportMatchesPath } from "@/shared/api/exports";

describe("exports API facade", () => {
  it("builds all match export query", () => {
    expect(buildExportMatchesPath({ format: "csv", scope: "all" })).toBe(
      "/api/exports/matches?format=csv",
    );
  });

  it("passes only the active scope id", () => {
    expect(
      buildExportMatchesPath({
        format: "tsv",
        heldEventId: "held-1",
        matchId: "match-1",
        scope: "match",
      }),
    ).toBe("/api/exports/matches?format=tsv&matchId=match-1");
  });
});
