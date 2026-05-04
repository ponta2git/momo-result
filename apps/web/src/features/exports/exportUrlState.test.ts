// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  buildExportSearchParams,
  parseExportSearchParams,
  selectedIdForScope,
} from "./exportUrlState";

describe("exportUrlState", () => {
  it("defaults to csv/all", () => {
    const state = parseExportSearchParams(new URLSearchParams());

    expect(state.format).toBe("csv");
    expect(state.scope).toBe("all");
    expect(state.errors).toEqual([]);
  });

  it("parses tsv match deep links", () => {
    const state = parseExportSearchParams(new URLSearchParams("format=tsv&matchId=match-1"));

    expect(state.format).toBe("tsv");
    expect(state.scope).toBe("match");
    expect(selectedIdForScope(state, "match")).toBe("match-1");
  });

  it("reports multiple scope ids without dropping them", () => {
    const state = parseExportSearchParams(
      new URLSearchParams("seasonMasterId=season-1&matchId=match-1"),
    );

    expect(state.scope).toBe("match");
    expect(state.seasonMasterId).toBe("season-1");
    expect(state.matchId).toBe("match-1");
    expect(state.errors).toContain("出力範囲のIDは1つだけ指定してください。");
  });

  it("serializes only the selected scope id", () => {
    const params = buildExportSearchParams({
      format: "csv",
      scope: "heldEvent",
      selectedId: "held-1",
    });

    expect(params.toString()).toBe("format=csv&heldEventId=held-1");
  });
});
