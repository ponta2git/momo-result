// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  describeHeldEventListConditions,
  heldEventListMetricError,
} from "@/features/heldEvents/list/heldEventListConditions";
import { defaultHeldEventListSearch } from "@/features/heldEvents/list/heldEventListSearchParams";
import type { HeldEventListFilterCandidates } from "@/features/heldEvents/list/heldEventListTypes";

const candidates: HeldEventListFilterCandidates = {
  gameTitles: [
    {
      createdAt: "2026-01-01T00:00:00.000Z",
      displayOrder: 1,
      id: "game-1",
      layoutFamily: "momotetsu_2",
      name: "桃太郎電鉄2",
    },
  ],
  maps: [],
  seasons: [],
};

describe("describeHeldEventListConditions", () => {
  const search = {
    ...defaultHeldEventListSearch,
    from: "2026-04-01",
    gameTitleId: "game-1",
    metric: {
      memberId: "member_ponta",
      metric: "average_rank" as const,
      range: "lte" as const,
      value: "2",
    },
    minMatchCount: 3,
    q: "キングボンビー",
    seasonMasterId: "season-unknown",
  };

  it("lists every applied condition in reading order for the search sheet", () => {
    expect(
      describeHeldEventListConditions(candidates, search, "all").map(({ label }) => label),
    ).toEqual([
      "作品 桃太郎電鉄2",
      "シーズン 選択中",
      "期間 2026/04/01以降",
      "確定試合数 3試合以上",
      "メモ「キングボンビー」",
      "ぽんた の開催平均順位 2.00以下",
    ]);
  });

  it("repeats only detail conditions next to the visible desktop controls", () => {
    expect(
      describeHeldEventListConditions(candidates, search, "details").map(({ key }) => key),
    ).toEqual(["period", "matchCount", "memo", "metric"]);
  });

  it("describes a count for any player", () => {
    expect(
      describeHeldEventListConditions(
        candidates,
        {
          ...defaultHeldEventListSearch,
          metric: { memberId: "", metric: "rank1_count", range: "gte", value: "2" },
        },
        "details",
      ),
    ).toEqual([{ key: "metric", label: "誰か の1位の回数 2回以上" }]);
  });
});

describe("heldEventListMetricError", () => {
  it.each([
    [{ metric: "", value: "2" }, "指標を選んでください。"],
    [
      { metric: "average_rank", value: "4.5" },
      "1.00〜4.00の数値（小数第2位まで）で入力してください。",
    ],
    [{ metric: "rank3_count", value: "1.5" }, "0以上の整数で入力してください。"],
    [{ metric: "average_rank", value: "1.25" }, undefined],
    [{ metric: "rank3_count", value: "" }, undefined],
  ] as const)("explains %o as %s", (condition, message) => {
    expect(heldEventListMetricError({ memberId: "", range: "gte", ...condition })).toBe(message);
  });
});
