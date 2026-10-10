// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  areDistributionsCompatible,
  countCapacities,
  countsFromMean,
  distributionCountUnits,
  distributionFromCounts,
  distributionFromCountUnits,
  distributionMean,
  exactWholeCounts,
  formatRational,
  meanInput,
  meanLimits,
  nearestWholeCounts,
  nextMatchOutcomes,
  nextMeanHundredths,
  outlookCrossings,
  parseDecimal,
  projectOutlook,
  rational,
  requiredMean,
  wholeCountCapacities,
} from "./index";
import type { Four, RankDistribution } from "./index";

const counts = distributionFromCountUnits;

describe("exact outlook and input precision", () => {
  const pair = { games: 200, focusRankSum: 510, rivalRankSum: 500 };
  // Means are exactly 2.35 and 2.55.
  const focus = counts([700, 300, 600, 400]);
  const rival = counts([400, 600, 500, 500]);

  it("separates exact equality, the first strict lead, and arrivals outside the graph", () => {
    expect(outlookCrossings(pair, focus, rival)).toMatchObject({
      current: "behind",
      focusAtLeast: 50n,
      focusAhead: 51n,
      exactTie: 50n,
      rivalAtLeast: 0n,
      rivalAhead: 0n,
    });
    expect(projectOutlook(pair, focus, rival, 50)).toEqual({
      focusAverage: rational(251n, 100n),
      rivalAverage: rational(251n, 100n),
      gap: rational(0n),
      relation: "tied",
    });
    expect(projectOutlook(pair, focus, rival, 51).relation).toBe("ahead");
    expect(requiredMean(pair, rival, 50)).toMatchObject({
      kind: "mean",
      threshold: rational(235n, 100n),
      maximumHundredths: 234,
    });
    expect(outlookCrossings(pair, counts([400, 601, 499, 500]), rival).focusAhead).toBe(20001n);
    expect(outlookCrossings(pair, rival, rival).focusAtLeast).toBeNull();
  });

  it("handles a rival catching the focus and a tie that starts now", () => {
    const reversed = { games: 200, focusRankSum: 500, rivalRankSum: 510 };
    expect(outlookCrossings(reversed, rival, focus)).toMatchObject({
      current: "ahead",
      focusAtLeast: 0n,
      focusAhead: 0n,
      rivalAtLeast: 50n,
      rivalAhead: 51n,
    });
    expect(outlookCrossings({ ...pair, focusRankSum: 500 }, focus, rival)).toMatchObject({
      current: "tied",
      focusAtLeast: 0n,
      focusAhead: 1n,
      exactTie: 0n,
    });
    expect(
      nextMatchOutcomes({ games: 10, focusRankSum: 25, rivalRankSum: 23 }).filter(
        (outcome) => outcome.relation === "ahead",
      ),
    ).toEqual([{ focusRank: 1, rivalRank: 4, relation: "ahead" }]);
  });

  it("keeps a native 4/3 mean distinct from the editable count and mean grids", () => {
    const actual = distributionFromCounts([2, 1, 0, 0]);
    const opponent = distributionFromCounts([1, 2, 0, 0]);
    expect(distributionMean(actual)).toEqual(rational(4n, 3n));
    expect(distributionCountUnits(actual)).toBeNull();
    expect(exactWholeCounts(actual)).toBeNull();
    expect(wholeCountCapacities(opponent)).toEqual([13, 6, 20, 20]);
    expect(nearestWholeCounts(actual, opponent)).toEqual([13, 6, 1, 0]);
    expect(distributionMean(actual)).toEqual(rational(4n, 3n));
    expect(meanLimits(opponent)).toMatchObject({
      continuousMinimum: rational(4n, 3n),
      countMinimum: rational(667n, 500n),
      minimumHundredths: 134,
    });
    expect(nextMeanHundredths(distributionMean(actual), -1, opponent)).toBeNull();
    expect(nextMeanHundredths(distributionMean(actual), 1, opponent)).toBe(134);
    expect(countsFromMean(133, opponent, actual)).toBeNull();
    expect(
      requiredMean({ games: 300, focusRankSum: 833, rivalRankSum: 500 }, opponent, 1000).kind,
    ).toBe("precision-impossible");
    // The former 0.01-count editor could fit below 401/300; neither current input mode can.
    expect(
      requiredMean({ games: 100, focusRankSum: 283, rivalRankSum: 250 }, opponent, 100),
    ).toMatchObject({
      threshold: rational(401n, 300n),
      kind: "precision-impossible",
      maximumHundredths: null,
    });
    expect(
      requiredMean({ games: 100, focusRankSum: 284, rivalRankSum: 250 }, opponent, 100).kind,
    ).toBe("impossible");
  });

  it("does not replace an off-grid distribution when its exact mean is entered again", () => {
    const distribution = counts([554, 518, 481, 447]);
    const mean = distributionMean(distribution);
    expect(mean).toEqual(rational(4821n, 2000n));
    expect(meanInput("2.41050", mean)).toEqual({ kind: "unchanged" });
    expect(meanInput("2.4106", mean)).toEqual({ kind: "invalid" });
    expect(meanInput("2.42", mean)).toEqual({ kind: "mean", hundredths: 242 });
    expect(nextMeanHundredths(mean, -1, rival)).toBe(241);
    expect(nextMeanHundredths(mean, 1, rival)).toBe(242);
    expect(parseDecimal("0.01")).toEqual(rational(1n, 100n));
    for (const invalid of ["", "-", ".", "Infinity", "1e2", "2.4.1"])
      expect(parseDecimal(invalid)).toBeNull();
    expect(formatRational(mean, 4)).toBe("2.4105");
    expect(formatRational(rational(-1n, 3n))).toBe("-0.33");
  });

  it("never loses integer rank differences when the cumulative integers approach the number boundary", () => {
    const large = {
      games: 3000000000000000,
      focusRankSum: Number.MAX_SAFE_INTEGER,
      rivalRankSum: Number.MAX_SAFE_INTEGER - 1,
    };
    expect(projectOutlook(large, rival, rival, 100).gap).toEqual(rational(-1n, 3000000000000100n));
    expect(() =>
      projectOutlook({ ...pair, focusRankSum: Number.MAX_SAFE_INTEGER + 1 }, focus, rival, 1),
    ).toThrow(RangeError);
  });
});

/** Enumerates all 1771 integer twenty-game distributions with an independent legality check. */
function wholeCountOracle(reference: RankDistribution, opponent: RankDistribution): Four<number> {
  let best: Four<number> | null = null;
  let bestCost: bigint | null = null;
  let bestMeanDifference: bigint | null = null;
  for (let first = 0; first <= 20; first++) {
    for (let second = 0; second <= 20 - first; second++) {
      for (let third = 0; third <= 20 - first - second; third++) {
        const candidate: Four<number> = [first, second, third, 20 - first - second - third];
        if (
          candidate.some(
            (count, index) =>
              BigInt(count) * opponent.denominator + 20n * opponent.weights[index]! >
              20n * opponent.denominator,
          )
        )
          continue;
        const cost = candidate.reduce(
          (sum, count, index) =>
            sum + (BigInt(count) * reference.denominator - 20n * reference.weights[index]!) ** 2n,
          0n,
        );
        const difference = candidate.reduce(
          (sum, count, index) =>
            sum +
            BigInt(index + 1) *
              (BigInt(count) * reference.denominator - 20n * reference.weights[index]!),
          0n,
        );
        const meanDifference = difference < 0n ? -difference : difference;
        // Enumeration is lexicographic; equally close mean and counts favor the earlier rank.
        if (
          bestMeanDifference === null ||
          meanDifference < bestMeanDifference ||
          (meanDifference === bestMeanDifference && (bestCost === null || cost <= bestCost))
        ) {
          best = candidate;
          bestCost = cost;
          bestMeanDifference = meanDifference;
        }
      }
    }
  }
  if (best === null)
    throw new Error("A valid opponent must admit an integer twenty-game distribution");
  return best;
}

describe("whole-count editing starting point", () => {
  it("finds the nearest legal integer allocation without changing exact observations or average input", () => {
    const cases = [
      {
        reference: distributionFromCounts([2, 1, 0, 0]),
        opponent: distributionFromCounts([1, 2, 0, 0]),
      },
      { reference: counts([554, 518, 481, 447]), opponent: distributionFromCounts([1, 1, 1, 1]) },
      {
        reference: distributionFromCounts([2, 8, 6, 3]),
        opponent: distributionFromCounts([7, 5, 3, 2]),
      },
      { reference: counts([1, 1999, 0, 0]), opponent: counts([1999, 1, 0, 0]) },
      {
        reference: distributionFromCounts([1, 1, 1, 0]),
        opponent: distributionFromCounts([0, 0, 0, 1]),
      },
    ];
    for (const { reference, opponent } of cases) {
      const originalMean = distributionMean(reference);
      const proposal = nearestWholeCounts(reference, opponent);
      expect(proposal).toEqual(wholeCountOracle(reference, opponent));
      expect(proposal?.reduce((sum, count) => sum + count, 0)).toBe(20);
      expect(proposal?.every(Number.isInteger)).toBe(true);
      expect(distributionMean(reference)).toEqual(originalMean);
      if (!proposal) throw new Error("A valid opponent must admit a starting point");
      expect(areDistributionsCompatible(distributionFromCounts(proposal), opponent)).toBe(true);
    }
    const quarter = distributionFromCounts([1, 1, 1, 1]);
    const preciseAverage = countsFromMean(241, quarter, quarter);
    if (!preciseAverage) throw new Error("The 0.01 average input must remain available");
    expect(distributionMean(preciseAverage)).toEqual(rational(241n, 100n));
    expect(exactWholeCounts(preciseAverage)).toBeNull();
    expect(exactWholeCounts(quarter)).toEqual([5, 5, 5, 5]);
    expect(nearestWholeCounts(quarter, quarter)).toEqual([5, 5, 5, 5]);
  });

  it("prioritizes exact mean distance, then count distance, then rank order within legal capacities", () => {
    const quarter = distributionFromCounts([1, 1, 1, 1]);
    expect(nearestWholeCounts(counts([554, 518, 481, 447]), quarter)).toEqual([6, 5, 4, 5]);
    // Both 2.40 and 2.45 are equally close to 2.425; count distance selects 2.45 here.
    expect(nearestWholeCounts(counts([625, 500, 275, 600]), quarter)).toEqual([6, 5, 3, 6]);
    // Both costs tie for [6,5,4,5] and [6,5,3,6], so the earlier rank receives the count.
    expect(nearestWholeCounts(counts([600, 500, 350, 550]), quarter)).toEqual([6, 5, 4, 5]);
    const nearlyAllFirst = counts([1999, 1, 0, 0]);
    expect(wholeCountCapacities(nearlyAllFirst)).toEqual([0, 19, 20, 20]);
    expect(nearestWholeCounts(counts([1, 1999, 0, 0]), nearlyAllFirst)).toEqual([0, 19, 1, 0]);
    expect(
      nearestWholeCounts(
        distributionFromCounts([1, 1, 1, 0]),
        distributionFromCounts([0, 0, 0, 1]),
      ),
    ).toEqual([7, 6, 7, 0]);
  });
});

/** Brute-force both free counts, without the production quadratic minimizer. */
function allocationOracle(
  mean: number,
  opponent: RankDistribution,
  reference: RankDistribution,
): Four<number> | null {
  const caps = opponent.weights.map((weight) =>
    Number((2000n * (opponent.denominator - weight)) / opponent.denominator),
  );
  let best: Four<number> | null = null;
  let balance = Infinity;
  let distance: bigint | null = null;
  for (let fourth = 0; fourth <= caps[3]!; fourth++) {
    for (let third = 0; third <= caps[2]!; third++) {
      const second = 20 * mean - 2000 - 2 * third - 3 * fourth;
      const first = 2000 - second - third - fourth;
      if (first < 0 || first > caps[0]! || second < 0 || second > caps[1]!) continue;
      const candidate: Four<number> = [first, second, third, fourth];
      const cost = candidate.reduce((sum, value) => sum + (value - 500) ** 2, 0);
      if (cost > balance) continue;
      const near = candidate.reduce(
        (sum, value, index) =>
          sum + (BigInt(value) * reference.denominator - 2000n * reference.weights[index]!) ** 2n,
        0n,
      );
      const previousBest = best;
      const lexical =
        previousBest === null ||
        candidate.some(
          (value, index) =>
            value < previousBest[index]! &&
            candidate.slice(0, index).every((prior, earlier) => prior === previousBest[earlier]),
        );
      if (
        cost < balance ||
        distance === null ||
        near < distance ||
        (near === distance && lexical)
      ) {
        best = candidate;
        balance = cost;
        distance = near;
      }
    }
  }
  return best;
}

describe("average allocation", () => {
  it("minimizes balance, exact reference distance, then lexicographic order against exhaustive candidates", () => {
    const cases = [
      {
        mean: 241,
        opponent: distributionFromCounts([1, 1, 1, 1]),
        reference: counts([554, 518, 481, 447]),
      },
      {
        mean: 235,
        opponent: distributionFromCounts([7, 5, 3, 2]),
        reference: distributionFromCounts([2, 8, 6, 3]),
      },
      {
        mean: 134,
        opponent: distributionFromCounts([1, 2, 0, 0]),
        reference: distributionFromCounts([2, 1, 0, 0]),
      },
      {
        mean: 399,
        opponent: distributionFromCounts([0, 0, 1, 0]),
        reference: distributionFromCounts([0, 0, 0, 1]),
      },
    ];
    for (const { mean, opponent, reference } of cases) {
      const actual = countsFromMean(mean, opponent, reference);
      expect(actual && distributionCountUnits(actual)).toEqual(
        allocationOracle(mean, opponent, reference),
      );
      expect(actual && distributionMean(actual)).toEqual(rational(BigInt(mean), 100n));
      expect(actual && areDistributionsCompatible(actual, opponent)).toBe(true);
    }
  });

  it("rejects illegal totals and reports the exact capacity when the rival uses a native distribution", () => {
    expect(() => counts([500, 500, 500, 501])).toThrow(RangeError);
    expect(countCapacities(distributionFromCounts([1, 2, 0, 0]))).toEqual([1333, 666, 2000, 2000]);
    expect(areDistributionsCompatible(counts([1500, 500, 0, 0]), counts([501, 0, 1000, 499]))).toBe(
      false,
    );
  });
});
