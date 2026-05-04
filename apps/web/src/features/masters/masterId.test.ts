// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  createGameTitleId,
  createMapMasterId,
  createSeasonMasterId,
} from "@/features/masters/masterId";

describe("masterId", () => {
  it("creates stable prefixed ids", () => {
    expect(createGameTitleId("桃太郎電鉄2", 1700000000000)).toBe("gt_2_1700000000000");
    expect(createMapMasterId("東日本編", 1700000000001)).toBe("map_master_map_1700000000001");
    expect(createSeasonMasterId("2026 春", 1700000000002)).toBe("season_master_2026_1700000000002");
  });
});
