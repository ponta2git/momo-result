// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  distributionFromCounts,
  rational,
  requiredMean,
} from "@/features/seriesComparison/outlook/calculation";
import {
  outlookDetailRows,
  outlookGoalAnswer,
  outlookGoalExampleList,
  outlookReviewPerspectives,
  outlookTrendAnswer,
} from "@/features/seriesComparison/outlook/outlookAnswers";
import {
  outlookSourceLabel,
  signedOutlookGap,
} from "@/features/seriesComparison/outlook/outlookPresentation";
import { orderOutlookExamples } from "@/features/seriesComparison/outlook/useOutlookPatterns";

const names = ["いーゆー", "ぽんた"] as const;
// A trails by 10 rank points after 100 games.
const behind = { games: 100, focusRankSum: 260, rivalRankSum: 250 };
const ahead = { games: 100, focusRankSum: 250, rivalRankSum: 260 };
const mean230 = distributionFromCounts([5, 7, 5, 3]);
const mean250 = distributionFromCounts([5, 5, 5, 5]);
const mean240 = distributionFromCounts([5, 5, 7, 3]);
const recent = [mean250, mean250] as const;
const source = { kind: "recent", artifactId: "a", matchCount: 20 } as const;

describe("trend answer", () => {
  it("marks the integer tie inside the graph and keeps the strict lead in the headline", () => {
    const answer = outlookTrendAnswer({
      cumulative: behind,
      pair: [mean230, mean250],
      recent,
      names,
      range: 100,
      recentGames: 20,
    });
    expect(answer).toMatchObject({
      headline: "51戦後にいーゆーが上回ります",
      tie: "50戦後は同率",
      marker: { h: 50, label: "50戦後に同率" },
      beyondRange: null,
      recentComparison: "直近20戦のままなら：ぽんたの先行が続きます",
    });
  });

  it("states a lead after the graph instead of drawing it, and omits the recent line when unchanged", () => {
    const answer = outlookTrendAnswer({
      cumulative: behind,
      pair: [mean240, mean250],
      recent: [mean240, mean250],
      names,
      range: 50,
      recentGames: 12,
    });
    expect(answer.marker).toBeNull();
    expect(answer.beyondRange).toBe("順番が入れ替わるのは101戦後で、図の範囲より先です。");
    expect(answer.recentComparison).toBeNull();
  });
});

describe("goal answer", () => {
  it("offers the best 0.01 mean when the assumption does not reach, with its premise and gap", () => {
    const answer = outlookGoalAnswer({
      cumulative: behind,
      pair: [mean250, mean250],
      recent,
      focusSource: source,
      goalHorizon: 50,
      names,
      recentGames: 20,
    });
    expect(answer).toMatchObject({
      ahead: false,
      reaches: false,
      answer: "平均 2.29位以下",
      apply: { hundredths: 229, label: "いーゆーを 2.29位で試す" },
      premise: "ぽんたが2.50位を続ける前提",
      margin: "直近20戦から0.21の改善",
      perspectives: ["改善の手掛かりを探す"],
    });
  });

  it("states that a leading assumption keeps the lead and offers nothing weaker", () => {
    const answer = outlookGoalAnswer({
      cumulative: ahead,
      pair: [mean230, mean250],
      recent: [mean230, mean250],
      focusSource: source,
      goalHorizon: 100,
      names,
      recentGames: 20,
    });
    expect(answer).toMatchObject({
      ahead: true,
      reaches: true,
      answer: "今の平均 2.30位で先行を保てます",
      apply: null,
      perspectives: ["成績を保てた試合を振り返る"],
    });
  });

  it("separates an unreachable goal from one limited by the 0.01 input", () => {
    const fast = distributionFromCounts([20, 0, 0, 0]);
    expect(
      outlookGoalAnswer({
        cumulative: behind,
        pair: [distributionFromCounts([0, 20, 0, 0]), fast],
        recent,
        focusSource: source,
        goalHorizon: 50,
        names,
        recentGames: 20,
      }).answer,
    ).toBe("ぽんたがこの平均なら届きません");
    // The rival's 1.499 needs below 1.503; the compatible minimum is 1.501, so no 0.01 value fits.
    const rival = distributionFromCounts([501, 499, 0, 0]);
    expect(
      outlookGoalAnswer({
        cumulative: { games: 100, focusRankSum: 146, rivalRankSum: 150 },
        pair: [distributionFromCounts([0, 0, 20, 0]), rival],
        recent,
        focusSource: source,
        goalHorizon: 1000,
        names,
        recentGames: 20,
      }).answer,
    ).toBe("入力できる細かさでは指定できません");
  });

  it("names the concrete review only for a tried example, lower finishes first", () => {
    const recentFocus = distributionFromCounts([4, 5, 6, 5]);
    expect(
      outlookReviewPerspectives({
        focus: distributionFromCounts([6, 6, 5, 3]),
        recentFocus,
        focusSource: {
          kind: "example",
          artifactId: "a",
          period: { startedAt: "", endedAt: "" } as never,
        },
        recentWithin: false,
        recentCompatible: true,
      }),
    ).toEqual([
      "下位だった試合で、共通する展開を確かめる",
      "勝ち切れなかった試合で、見直せる点を探す",
    ]);
    expect(
      outlookReviewPerspectives({
        focus: distributionFromCounts([6, 6, 5, 3]),
        recentFocus,
        focusSource: { kind: "average" },
        recentWithin: true,
        recentCompatible: false,
      }),
    ).toEqual(["内訳を見直す手掛かりを探す"]);
  });
});

describe("exact presentation", () => {
  it("signs a difference from its exact value, so a tiny lead is not shown as a tie", () => {
    expect(signedOutlookGap(rational(1n, 1000n))).toBe("+0.00");
    expect(signedOutlookGap(rational(-1n, 1000n))).toBe("−0.00");
    expect(signedOutlookGap(rational(0n, 1n))).toBe("±0.00");
    expect(signedOutlookGap(rational(-27n, 100n))).toBe("−0.27");
  });

  it("keeps an earlier artifact's origin in the source label", () => {
    expect(outlookSourceLabel({ kind: "recent", artifactId: "a", matchCount: 20 }, "a")).toBeNull();
    expect(outlookSourceLabel({ kind: "recent", artifactId: "a", matchCount: 20 }, "b")).toBe(
      "更新前の直近20戦",
    );
    expect(outlookSourceLabel({ kind: "average" }, "b")).toBe("平均に合わせた内訳");
    const period = {
      startMatchId: "m1",
      endMatchId: "m2",
      startSequence: 1,
      endSequence: 20,
      startedAt: "2025-03-01T00:00:00Z",
      endedAt: "2025-05-01T00:00:00Z",
    };
    expect(outlookSourceLabel({ kind: "example", artifactId: "a", period }, "a")).toBe(
      "2025/03〜05の実績例",
    );
    expect(outlookSourceLabel({ kind: "example", artifactId: "a", period }, "b")).toBe(
      "更新前の実績例を使っています",
    );
  });

  it("lists now, the usual horizons, and a goal after the graph, with the goal's requirement", () => {
    const rows = outlookDetailRows({
      cumulative: behind,
      pair: [mean230, mean250],
      goalHorizon: 300,
      exampleGapsAt: () => [rational(1n, 10n)],
    });
    expect(rows.map((row) => row.h)).toEqual([0, 10, 20, 50, 100, 300]);
    expect(rows[0]).toMatchObject({ required: null, exampleGaps: [] });
    expect(rows.at(-1)).toMatchObject({ goal: true, exampleGaps: [rational(1n, 10n)] });
    expect(rows.at(-1)?.required?.maximumHundredths).toBe(246);
  });
});

function record(counts: [number, number, number, number]) {
  return {
    rankCounts: counts,
    window: { averageRank: 0, period: {} as never, rankSum: 0, windowSize: 20 },
  };
}
function data(types: Array<ReturnType<typeof record>>) {
  return { examples: { status: "available" as const, types } };
}

describe("examples that meet the goal", () => {
  it("keeps the stored order, excludes the boundary itself, and stops at three", () => {
    // 50 games behind by 10: the strict boundary is 2.30, so exactly 2.30 does not qualify.
    const required = requiredMean(behind, mean250, 50);
    const list = outlookGoalExampleList(
      data([
        record([5, 7, 5, 3]),
        record([6, 7, 4, 3]),
        record([7, 6, 4, 3]),
        record([8, 6, 3, 3]),
        record([9, 6, 2, 3]),
      ]),
      required,
      mean250,
    );
    expect(list.kind === "examples" && list.examples.map((item) => item.rankCounts)).toEqual([
      [6, 7, 4, 3],
      [7, 6, 4, 3],
      [8, 6, 3, 3],
    ]);
  });

  it("distinguishes no record, records that conflict with the rival, and an unreachable goal", () => {
    const required = requiredMean(behind, mean250, 50);
    expect(outlookGoalExampleList(data([record([0, 0, 0, 20])]), required, mean250)).toEqual({
      kind: "none",
    });
    // Leading by 10, the 50-game boundary is 2.70; all first places cannot share games with 2.50.
    expect(
      outlookGoalExampleList(
        data([record([20, 0, 0, 0])]),
        requiredMean(ahead, mean250, 50),
        mean250,
      ).kind,
    ).toBe("incompatible");
    expect(
      outlookGoalExampleList(
        data([]),
        requiredMean(behind, distributionFromCounts([20, 0, 0, 0]), 50),
        distributionFromCounts([20, 0, 0, 0]),
      ),
    ).toEqual({ kind: "unreachable" });
  });
});

function drawn(ranks: ReadonlyArray<readonly [1 | 2 | 3 | 4, 1 | 2 | 3 | 4]>) {
  return { ranks, points: [] };
}

describe("example order", () => {
  const cumulative = { games: 10, focusRankSum: 25, rivalRankSum: 25 };

  it("orders by the exact end difference and keeps the canonical favourable order", () => {
    const lines = orderOutlookExamples(
      [drawn([[2, 1]]), drawn([[1, 2]]), drawn([[1, 3]])],
      cumulative,
      1,
    );
    expect(lines.map((line) => [line.label, signedOutlookGap(line.gapAt(1))])).toEqual([
      ["有利な例", "+0.18"],
      ["中間の例", "+0.09"],
      ["不利な例", "−0.09"],
    ]);
  });

  it("uses neutral names when two examples end equal", () => {
    const lines = orderOutlookExamples(
      [drawn([[1, 2]]), drawn([[3, 4]]), drawn([[2, 1]])],
      cumulative,
      1,
    );
    expect(lines.map((line) => line.label)).toEqual(["展開例1", "展開例2", "展開例3"]);
  });
});
