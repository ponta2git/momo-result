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
  it.each([50, 100, 200] as const)(
    "selects reproducible legal examples over %i games and retains precise values through 1000",
    (selectionRange) => {
      const result = generateOutlookExamples({ ...input, selectionRange });
      expect(generateOutlookExamples({ ...input, selectionRange })).toEqual(result);
      if (selectionRange === 100) expect(generateOutlookExamples(input)).toEqual(result);
      expect(result.examples).toHaveLength(3);
      const selectedGaps = result.examples.map((example) => example.points[selectionRange]!.gap);
      expect(selectedGaps).toEqual(selectedGaps.toSorted((left, right) => left - right));
      expect(
        new Set(
          result.examples.map((example) =>
            example.points
              .slice(0, selectionRange + 1)
              .map((point) => point.gap)
              .join(","),
          ),
        ).size,
      ).toBe(3);
      for (const example of result.examples) {
        expect(example.ranks).toHaveLength(1000);
        expect(example.points).toHaveLength(1001);
        expect(
          example.ranks.every(([a, b]) => a !== b && input.joint.weights[a - 1]![b - 1]! > 0n),
        ).toBe(true);
        for (const horizon of [0, 50, 100, 200, 1000]) {
          const ranks = example.ranks.slice(0, horizon);
          const focusSum = 510 + ranks.reduce((sum, [rank]) => sum + rank, 0);
          const rivalSum = 500 + ranks.reduce((sum, [, rank]) => sum + rank, 0);
          expect(example.points[horizon]).toEqual({
            games: horizon,
            focusAverage: focusSum / (200 + horizon),
            rivalAverage: rivalSum / (200 + horizon),
            gap: (rivalSum - focusSum) / (200 + horizon),
          });
        }
      }
    },
  );

  it("reverses the same canonical examples when focus/rival roles reverse", () => {
    const original = generateOutlookExamples({ ...input, selectionRange: 200 });
    const reversed = generateOutlookExamples({
      ...input,
      selectionRange: 200,
      focusMemberId: "second",
      cumulative: { games: 200, focusRankSum: 500, rivalRankSum: 510 },
    });
    original.examples.forEach((example, index) => {
      expect(reversed.examples[index]!.ranks).toEqual(example.ranks.map(([a, b]) => [b, a]));
      expect(reversed.examples[index]!.points).toEqual(
        example.points.map((point) => ({
          games: point.games,
          focusAverage: point.rivalAverage,
          rivalAverage: point.focusAverage,
          gap: -point.gap || 0,
        })),
      );
    });
  });

  it("samples the same probabilities identically when their integer representation changes", () => {
    const scaled = jointFromCounts(
      input.joint.weights.map((row) => row.map((weight) => Number(weight * 17n))),
    );
    expect(generateOutlookExamples({ ...input, joint: scaled, selectionRange: 200 })).toEqual(
      generateOutlookExamples({ ...input, selectionRange: 200 }),
    );
  });

  it("counts distinct trajectories only inside the selection range without claiming there is no variability", () => {
    const rare = jointFromCounts([
      [0, 14999, 1, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]);
    // Rare outcomes enter the fixed candidates' 100- and 200-game prefixes, but not their first 50.
    for (const [selectionRange, distinct] of [
      [50, 1],
      [100, 2],
      [200, 5],
    ] as const) {
      const finite = generateOutlookExamples({ ...input, joint: rare, selectionRange });
      expect(finite.distinctCandidateCount).toBe(distinct);
      expect(finite.constantPerGameDifference).toBe(false);
      expect(
        new Set(
          finite.examples.map((example) =>
            example.points
              .slice(0, selectionRange + 1)
              .map((point) => point.gap)
              .join(","),
          ),
        ).size,
      ).toBe(Math.min(3, distinct));
    }
  });

  it("keeps the same full candidates across ranges when all rank-difference trajectories coincide", () => {
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
    // Equal differences retain generation order, making the same candidate identities observable.
    for (const selectionRange of [50, 100, 200] as const)
      expect(generateOutlookExamples({ ...input, joint: constant, selectionRange })).toEqual(fixed);
  });
});
