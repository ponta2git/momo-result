// @vitest-environment node
import { describe, expect, it } from "vitest";

import { buildExportMatchesPath } from "@/shared/api/exports";

describe("exports API facade", () => {
  it.each([
    ["all", "format=tsv"],
    ["season", "format=tsv&seasonMasterId=season-1"],
    ["heldEvent", "format=tsv&heldEventId=held-1"],
    ["match", "format=tsv&matchId=match-1"],
  ] as const)(
    "exports only the selected %s scope even when other IDs remain in input",
    (scope, query) => {
      expect(
        buildExportMatchesPath({
          format: "tsv",
          seasonMasterId: "season-1",
          heldEventId: "held-1",
          matchId: "match-1",
          scope,
        }),
      ).toBe(`/api/exports/matches?${query}`);
    },
  );
});
