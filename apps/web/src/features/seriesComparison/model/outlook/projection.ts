import { countsFromMean, distributionMean, meanLimits } from "./distribution";
import type { Rank, RankDistribution } from "./distribution";
import {
  ceilDivide,
  compareRationals,
  floorDivide,
  lcm,
  rational,
  safeInteger,
  subtractRationals,
} from "./rational";
import type { Rational } from "./rational";

export type CumulativePair = Readonly<{
  games: number;
  focusRankSum: number;
  rivalRankSum: number;
}>;
export type OutlookRelation = "ahead" | "tied" | "behind";

export function validateCumulative(pair: CumulativePair): void {
  const games = safeInteger(pair.games);
  const focus = safeInteger(pair.focusRankSum);
  const rival = safeInteger(pair.rivalRankSum);
  if (games <= 0n || focus < games || focus > 4n * games || rival < games || rival > 4n * games)
    throw new RangeError("Cumulative ranks need a positive count and valid rank sums.");
}

function horizon(value: number, allowZero: boolean): bigint {
  const integer = safeInteger(value);
  if (integer < (allowZero ? 0n : 1n)) throw new RangeError("Invalid future match count.");
  return integer;
}

function relation(value: bigint): OutlookRelation {
  return value > 0n ? "ahead" : value < 0n ? "behind" : "tied";
}

export function projectOutlook(
  pair: CumulativePair,
  focus: RankDistribution,
  rival: RankDistribution,
  futureGames: number,
) {
  validateCumulative(pair);
  const h = horizon(futureGames, true);
  const games = BigInt(pair.games) + h;
  const a = distributionMean(focus);
  const b = distributionMean(rival);
  const focusAverage = rational(
    BigInt(pair.focusRankSum) * a.denominator + h * a.numerator,
    games * a.denominator,
  );
  const rivalAverage = rational(
    BigInt(pair.rivalRankSum) * b.denominator + h * b.numerator,
    games * b.denominator,
  );
  const gap = subtractRationals(rivalAverage, focusAverage);
  return { focusAverage, rivalAverage, gap, relation: relation(gap.numerator) };
}

function firstNonnegative(intercept: bigint, slope: bigint): bigint | null {
  if (intercept >= 0n) return 0n;
  return slope > 0n ? ceilDivide(-intercept, slope) : null;
}

function firstPositive(intercept: bigint, slope: bigint): bigint | null {
  if (intercept > 0n) return 0n;
  return slope > 0n ? floorDivide(-intercept, slope) + 1n : null;
}

export function outlookCrossings(
  pair: CumulativePair,
  focus: RankDistribution,
  rival: RankDistribution,
) {
  validateCumulative(pair);
  const a = distributionMean(focus);
  const b = distributionMean(rival);
  const denominator = lcm(a.denominator, b.denominator);
  const intercept = (BigInt(pair.rivalRankSum) - BigInt(pair.focusRankSum)) * denominator;
  const slope =
    b.numerator * (denominator / b.denominator) - a.numerator * (denominator / a.denominator);
  const exactTie =
    intercept === 0n
      ? 0n
      : slope !== 0n && -intercept % slope === 0n && -intercept / slope >= 0n
        ? -intercept / slope
        : null;
  return {
    current: relation(intercept),
    focusAtLeast: firstNonnegative(intercept, slope),
    focusAhead: firstPositive(intercept, slope),
    rivalAtLeast: firstNonnegative(-intercept, -slope),
    rivalAhead: firstPositive(-intercept, -slope),
    exactTie,
  };
}

export type RequiredMean = Readonly<{
  /** Focus must be strictly below this boundary. */
  threshold: Rational;
  kind: "mean" | "precision-impossible" | "impossible";
  maximumHundredths: number | null;
  continuousMinimum: Rational;
  countMinimum: Rational;
}>;

export function requiredMean(
  pair: CumulativePair,
  opponent: RankDistribution,
  futureGames: number,
): RequiredMean {
  validateCumulative(pair);
  const h = horizon(futureGames, false);
  const difference = BigInt(pair.focusRankSum) - BigInt(pair.rivalRankSum);
  const threshold = subtractRationals(distributionMean(opponent), rational(difference, h));
  const limits = meanLimits(opponent);
  const common = {
    threshold,
    continuousMinimum: limits.continuousMinimum,
    countMinimum: limits.countMinimum,
  };
  if (compareRationals(limits.continuousMinimum, threshold) >= 0)
    return { ...common, kind: "impossible", maximumHundredths: null };
  if (compareRationals(limits.countMinimum, threshold) >= 0)
    return { ...common, kind: "precision-impossible", maximumHundredths: null };
  const strictMaximum = ceilDivide(100n * threshold.numerator, threshold.denominator) - 1n;
  const maximum = Number(
    strictMaximum < BigInt(limits.maximumHundredths)
      ? strictMaximum
      : BigInt(limits.maximumHundredths),
  );
  // Check actual realizability, rather than treating a numeric interval as a distribution.
  for (let candidate = maximum; candidate >= limits.minimumHundredths; candidate--) {
    if (countsFromMean(candidate, opponent, opponent) !== null)
      return { ...common, kind: "mean", maximumHundredths: candidate };
  }
  // Whole-count moves have 0.05 average increments, already covered by the 0.01 mean input.
  // A finer internal allocation is not an additional user-editable route to the target.
  return { ...common, kind: "precision-impossible", maximumHundredths: null };
}

export function nextMatchOutcomes(
  pair: CumulativePair,
): Array<{ focusRank: Rank; rivalRank: Rank; relation: OutlookRelation }> {
  validateCumulative(pair);
  const current = BigInt(pair.rivalRankSum) - BigInt(pair.focusRankSum);
  const outcomes: Array<{ focusRank: Rank; rivalRank: Rank; relation: OutlookRelation }> = [];
  for (const focusRank of [1, 2, 3, 4] as const) {
    for (const rivalRank of [1, 2, 3, 4] as const) {
      if (focusRank !== rivalRank)
        outcomes.push({
          focusRank,
          rivalRank,
          relation: relation(current + BigInt(rivalRank - focusRank)),
        });
    }
  }
  return outcomes;
}
