// @vitest-environment node

import { describe, expect, it } from "vitest";

import { distributionFromCounts } from "@/features/seriesComparison/outlook/calculation";
import {
  compareOutlookOutcomes,
  outlookOutcome,
} from "@/features/seriesComparison/outlook/outlookOutcome";

const names = ["いーゆー", "ぽんた"] as const;
const behind = { games: 100, focusRankSum: 260, rivalRankSum: 250 };
const ahead = { games: 100, focusRankSum: 250, rivalRankSum: 260 };
const tied = { games: 100, focusRankSum: 250, rivalRankSum: 250 };
const mean230 = distributionFromCounts([5, 7, 5, 3]);
const mean240 = distributionFromCounts([5, 5, 7, 3]);
const mean250 = distributionFromCounts([5, 5, 5, 5]);
const mean260 = distributionFromCounts([3, 7, 5, 5]);

describe("outlook outcome presentation", () => {
  it("names the strict lead after an integer tie and compares the two arrival times", () => {
    // A trails by 10 rank points. Gaining 0.2 per game ties at 50 and leads at 51.
    expect(outlookOutcome(behind, [mean230, mean250], names)).toMatchObject({
      headline: "51戦後にいーゆーが上回ります",
      detail: "50戦後は同率",
      eventHorizon: 51n,
      eventLabel: "いーゆーが上回る",
    });
    // A gain of 0.1 instead first leads at 101, exactly 50 games later.
    expect(compareOutlookOutcomes(behind, [mean240, mean250], [mean230, mean250], names)).toBe(
      "逆転が50戦早まります",
    );
    expect(compareOutlookOutcomes(behind, [mean230, mean250], [mean240, mean250], names)).toBe(
      "逆転が50戦遅くなります",
    );
  });

  it("does not invent an integer tie or a timing change when both first lead at game 21", () => {
    const mean200 = distributionFromCounts([5, 10, 5, 0]);
    const mean201 = distributionFromCounts([25, 49, 26, 0]);
    // 10 / 0.5 = 20 is a tie. 10 / 0.49 is between games 20 and 21.
    expect(outlookOutcome(behind, [mean201, mean250], names)).toMatchObject({
      headline: "21戦後にいーゆーが上回ります",
      detail: null,
      eventHorizon: 21n,
    });
    expect(compareOutlookOutcomes(behind, [mean200, mean250], [mean201, mean250], names)).toBe(
      "逆転する戦数は同じです",
    );
  });

  it("reports the rival's reversal when the focus already leads, including avoiding that loss", () => {
    expect(outlookOutcome(ahead, [mean250, mean230], names)).toMatchObject({
      headline: "51戦後にぽんたが上回ります",
      detail: "50戦後は同率",
      eventHorizon: 51n,
      eventLabel: "ぽんたが上回る",
    });
    expect(compareOutlookOutcomes(ahead, [mean250, mean230], [mean250, mean240], names)).toBe(
      "ぽんたに上回られる時点が50戦遅くなります",
    );
    expect(outlookOutcome(ahead, [mean250, mean250], names)).toMatchObject({
      headline: "いーゆーの先行が続きます",
      detail: null,
      eventHorizon: null,
      eventLabel: "",
    });
    expect(compareOutlookOutcomes(ahead, [mean250, mean230], [mean250, mean250], names)).toBe(
      "この条件ならいーゆーの先行が続きます",
    );
  });

  it("distinguishes an unreachable lead from a finite arrival without treating the current rival lead as an event", () => {
    // Equal future means cannot close the existing 10-point deficit.
    expect(outlookOutcome(behind, [mean250, mean250], names)).toMatchObject({
      headline: "ぽんたの先行が続きます",
      detail: null,
      eventHorizon: null,
      eventLabel: "",
    });
    expect(compareOutlookOutcomes(behind, [mean250, mean250], [mean230, mean250], names)).toBe(
      "この条件ならいーゆーが上回れます",
    );
    expect(compareOutlookOutcomes(behind, [mean230, mean250], [mean250, mean250], names)).toBe(
      "この条件ではいーゆーが上回れなくなります",
    );
    expect(compareOutlookOutcomes(behind, [mean250, mean250], [mean260, mean250], names)).toBe(
      "どちらの条件でもぽんたの先行が続きます",
    );
  });

  it("compares the future winner when the actual results are currently tied", () => {
    expect(outlookOutcome(tied, [mean250, mean230], names)).toMatchObject({
      headline: "1戦後にぽんたが上回ります",
      detail: "現在は同率",
      eventHorizon: 1n,
    });
    expect(outlookOutcome(tied, [mean250, mean250], names)).toMatchObject({
      headline: "同率が続きます",
      detail: null,
      eventHorizon: null,
    });
    expect(compareOutlookOutcomes(tied, [mean230, mean250], [mean250, mean230], names)).toBe(
      "上回る人がいーゆーからぽんたに変わります",
    );
    expect(compareOutlookOutcomes(tied, [mean230, mean250], [mean240, mean250], names)).toBe(
      "どちらの条件でもいーゆーが上回ります",
    );
    expect(compareOutlookOutcomes(tied, [mean250, mean250], [mean230, mean250], names)).toBe(
      "いーゆーが上回る条件に変わります",
    );
  });
});
