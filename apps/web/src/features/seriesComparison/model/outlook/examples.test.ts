// @vitest-environment node

import { describe, expect, it } from "vitest";

import { generateOutlookExamples, jointFromCounts } from "./index";

const input = {
  gameTitleId: "synthetic-title",
  canonicalMemberIds: ["first", "second"] as const,
  focusMemberId: "first",
  cumulative: { games: 200, focusRankSum: 510, rivalRankSum: 500 },
  joint: jointFromCounts([
    [0, 3, 2, 0],
    [1, 0, 2, 2],
    [1, 1, 0, 3],
    [3, 1, 1, 0],
  ]),
};

describe("three reproducible joint examples", () => {
  it("returns distinct legal paths, keeps both cumulative ranks, and repeats the same conditions", () => {
    const result = generateOutlookExamples(input);
    expect(generateOutlookExamples(input)).toEqual(result);
    expect(result.examples).toHaveLength(3);
    expect(
      new Set(result.examples.map((example) => example.points.map((point) => point.gap).join(",")))
        .size,
    ).toBe(3);
    for (const example of result.examples) {
      expect(example.ranks).toHaveLength(100);
      expect(example.points).toHaveLength(101);
      expect(
        example.ranks.every(([a, b]) => a !== b && input.joint.weights[a - 1]![b - 1]! > 0n),
      ).toBe(true);
      expect(example.points[100]!.focusAverage).toBe(
        (510 + example.ranks.reduce((sum, [rank]) => sum + rank, 0)) / 300,
      );
      expect(example.points[100]!.rivalAverage).toBe(
        (500 + example.ranks.reduce((sum, [, rank]) => sum + rank, 0)) / 300,
      );
    }
  });

  it("reverses the same canonical examples when focus/rival roles reverse", () => {
    const original = generateOutlookExamples(input);
    const reversed = generateOutlookExamples({
      ...input,
      focusMemberId: "second",
      cumulative: { games: 200, focusRankSum: 500, rivalRankSum: 510 },
    });
    original.examples.forEach((example, index) => {
      expect(reversed.examples[index]!.ranks).toEqual(example.ranks.map(([a, b]) => [b, a]));
      expect(reversed.examples[index]!.points.map((point) => point.gap || 0)).toEqual(
        example.points.map((point) => -point.gap || 0),
      );
    });
  });

  it("samples the same probabilities identically when their integer representation changes", () => {
    const scaled = jointFromCounts(
      input.joint.weights.map((row) => row.map((weight) => Number(weight * 17n))),
    );
    expect(generateOutlookExamples({ ...input, joint: scaled })).toEqual(
      generateOutlookExamples(input),
    );
  });

  it("distinguishes an exhausted finite sample from a mathematically constant rank difference", () => {
    const rare = jointFromCounts([
      [0, 8397999, 1, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]);
    const finite = generateOutlookExamples({ ...input, joint: rare });
    expect(finite.distinctCandidateCount).toBe(1);
    expect(finite.constantPerGameDifference).toBe(false);
    const constant = jointFromCounts([
      [0, 1, 0, 0],
      [0, 0, 1, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]);
    const fixed = generateOutlookExamples({ ...input, joint: constant });
    expect(fixed.distinctCandidateCount).toBe(1);
    expect(fixed.constantPerGameDifference).toBe(true);
    expect(
      new Set(fixed.examples.map((example) => example.points.map((point) => point.gap).join(",")))
        .size,
    ).toBe(1);
  });
});
