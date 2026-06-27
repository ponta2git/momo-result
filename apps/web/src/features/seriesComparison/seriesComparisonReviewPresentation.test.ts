// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { SeriesComparisonReviewResponse } from "@/shared/api/seriesComparison";

import {
  evidenceStats,
  playbookCategoryLabel,
  playbookEvidenceStatusLabel,
  playbookEvidenceStrengthLabel,
  reviewPlaybookCardOrder,
  reviewPlaybookLane,
} from "./seriesComparisonReviewPresentation";

type ReviewCard = NonNullable<
  NonNullable<SeriesComparisonReviewResponse["playbookByPlayer"]>[number]["cards"]
>[number];

describe("seriesComparisonReviewPresentation", () => {
  it("maps backend playbook keys to player-facing Japanese labels", () => {
    expect(reviewPlaybookLane({ classification: "reproduce" })).toMatchObject({
      label: "再現する",
      order: 1,
    });
    expect(reviewPlaybookLane({ classification: "revise" })).toMatchObject({
      label: "見直す",
      order: 2,
    });
    expect(reviewPlaybookLane({ classification: "unexpected" })).toMatchObject({
      label: "検証する",
      order: 3,
    });
    expect(playbookCategoryLabel("revenue")).toBe("物件収益");
    expect(playbookCategoryLabel("playOrder")).toBe("番手");
    expect(playbookCategoryLabel("unknown_category")).toBe("その他");
    expect(playbookEvidenceStrengthLabel("strong")).toBe("強い");
    expect(playbookEvidenceStrengthLabel("unexpected")).toBe("検証向き");
    expect(playbookEvidenceStatusLabel("reference")).toBe("参考");
    expect(playbookEvidenceStatusLabel("unexpected")).toBe("根拠");
  });

  it("sorts cards by action lane before score", () => {
    const cards = [
      card({ actionAdviceScore: 0.99, classification: "verify" }),
      card({ actionAdviceScore: 0.2, classification: "reproduce" }),
      card({ actionAdviceScore: 0.8, classification: "revise" }),
      card({ actionAdviceScore: 0.6, classification: "reproduce" }),
    ].toSorted(reviewPlaybookCardOrder);

    expect(cards.map((item) => `${item.classification}:${item.actionAdviceScore}`)).toEqual([
      "reproduce:0.6",
      "reproduce:0.2",
      "revise:0.8",
      "verify:0.99",
    ]);
  });

  it("formats statistical detail only from finite values", () => {
    expect(
      evidenceStats({
        confidenceHigh: 0.84,
        confidenceLow: 0.31,
        effectEstimate: 0.625,
        label: "目的地差",
        metricId: "review.destination",
        stability: 0.82,
        status: "ok",
        targetCount: 7,
        value: "+0.62",
      }),
    ).toEqual(["差の大きさ +0.63", "ぶれ幅 +0.31〜+0.84", "ぶれにくさ 高"]);

    expect(
      evidenceStats({
        confidenceHigh: null as unknown as number,
        confidenceLow: Number.NaN,
        label: "本人平均との差",
        metricId: "review.baseline",
        stability: 0.49,
        status: "reference",
        targetCount: 3,
        value: "参考",
      }),
    ).toEqual(["ぶれにくさ 低"]);
  });
});

function card(overrides: Pick<ReviewCard, "actionAdviceScore" | "classification">): ReviewCard {
  return {
    actionAdviceScore: overrides.actionAdviceScore,
    actionHypothesis: "収益先行時は目的地0回で終えない。",
    anchorTarget: {
      label: "物件収益と勝ち",
      sectionId: "metric-revenue-outcome",
      view: "drivers",
    },
    avoidAction: "目的地0回のまま終盤へ入ること。",
    category: "revenue",
    classification: overrides.classification,
    dataReason: "物件収益トップ時の目的地差があります。",
    evidence: [],
    evidenceStrength: "verify",
    id: `card-${overrides.classification}-${overrides.actionAdviceScore}`,
    plainReason: "収益で先行した試合でも順位差が分かれています。",
    postMatchCheck: "次回、収益で上位だった試合を振り返る。",
    recommendedAction: "目的地周辺への位置取りを優先する。",
    status: "ok",
    targetCount: 7,
    triggerCondition: "中盤以降、物件収益で上位だが目的地到着がないとき。",
  };
}
