import {
  ceilDivide,
  compareRationals,
  floorDivide,
  parseDecimal,
  rational,
  safeInteger,
} from "./rational";
import type { Rational } from "./rational";

export type Four<T> = readonly [T, T, T, T];
export const RANK_INDICES = [0, 1, 2, 3] as const;
export type RankIndex = (typeof RANK_INDICES)[number];
export type Rank = 1 | 2 | 3 | 4;
export type RankDistribution = Readonly<{ weights: Four<bigint>; denominator: bigint }>;
export const COUNT_UNITS = 2000;
const TOTAL = BigInt(COUNT_UNITS);

export function mapFour<T, U>(values: Four<T>, map: (value: T, index: RankIndex) => U): Four<U> {
  return [map(values[0], 0), map(values[1], 1), map(values[2], 2), map(values[3], 3)];
}

export function distributionFromCounts(counts: readonly number[]): RankDistribution {
  if (counts.length !== 4) throw new RangeError("Exactly four rank counts are required.");
  const [first, second, third, fourth] = counts;
  if (first === undefined || second === undefined || third === undefined || fourth === undefined)
    throw new RangeError("Exactly four rank counts are required.");
  const weights = mapFour([first, second, third, fourth], safeInteger);
  const denominator = weights.reduce((sum, value) => sum + value, 0n);
  if (weights.some((value) => value < 0n) || denominator <= 0n)
    throw new RangeError("Rank counts must be nonnegative with a positive total.");
  return { weights, denominator };
}

export function distributionFromCountUnits(units: readonly number[]): RankDistribution {
  const distribution = distributionFromCounts(units);
  if (distribution.denominator !== TOTAL)
    throw new RangeError("Edited counts must total 2000 units.");
  return distribution;
}

export function distributionMean(distribution: RankDistribution): Rational {
  return rational(
    distribution.weights.reduce((sum, value, index) => sum + BigInt(index + 1) * value, 0n),
    distribution.denominator,
  );
}

export function distributionsEqual(left: RankDistribution, right: RankDistribution): boolean {
  return RANK_INDICES.every(
    (index) => left.weights[index] * right.denominator === right.weights[index] * left.denominator,
  );
}

export function incompatibleRanks(left: RankDistribution, right: RankDistribution): Rank[] {
  const total = left.denominator * right.denominator;
  return RANK_INDICES.flatMap((index) =>
    left.weights[index] * right.denominator + right.weights[index] * left.denominator > total
      ? [(index + 1) as Rank]
      : [],
  );
}

export function areDistributionsCompatible(
  left: RankDistribution,
  right: RankDistribution,
): boolean {
  return incompatibleRanks(left, right).length === 0;
}

export function distributionCountUnits(distribution: RankDistribution): Four<number> | null {
  if (distribution.weights.some((weight) => (weight * TOTAL) % distribution.denominator !== 0n))
    return null;
  return mapFour(distribution.weights, (weight) =>
    Number((weight * TOTAL) / distribution.denominator),
  );
}

/** The twenty-game equivalent is editable as whole counts only when no rounding is needed. */
export function exactWholeCounts(distribution: RankDistribution): Four<number> | null {
  if (distribution.weights.some((weight) => (weight * 20n) % distribution.denominator !== 0n))
    return null;
  return mapFour(distribution.weights, (weight) =>
    Number((weight * 20n) / distribution.denominator),
  );
}

export function countsPerTwenty(distribution: RankDistribution): Four<Rational> {
  return mapFour(distribution.weights, (weight) =>
    rational(20n * weight, distribution.denominator),
  );
}

export function countCapacities(opponent: RankDistribution): Four<number> {
  return mapFour(opponent.weights, (weight) =>
    Number((TOTAL * (opponent.denominator - weight)) / opponent.denominator),
  );
}

export function wholeCountCapacities(opponent: RankDistribution): Four<number> {
  return mapFour(opponent.weights, (weight) =>
    Number((20n * (opponent.denominator - weight)) / opponent.denominator),
  );
}

function endpoint(weights: Four<bigint>, total: bigint, descending: boolean): bigint {
  let remaining = total;
  let result = 0n;
  for (const index of descending ? ([3, 2, 1, 0] as const) : RANK_INDICES) {
    const take = weights[index] < remaining ? weights[index] : remaining;
    remaining -= take;
    result += BigInt(index + 1) * take;
  }
  if (remaining !== 0n) throw new RangeError("Insufficient rank capacity.");
  return result;
}

export function meanLimits(opponent: RankDistribution) {
  const continuousCaps = mapFour(opponent.weights, (weight) => opponent.denominator - weight);
  const caps = mapFour(countCapacities(opponent), BigInt);
  const minimumRankSum = endpoint(caps, TOTAL, false);
  const maximumRankSum = endpoint(caps, TOTAL, true);
  return {
    continuousMinimum: rational(
      endpoint(continuousCaps, opponent.denominator, false),
      opponent.denominator,
    ),
    continuousMaximum: rational(
      endpoint(continuousCaps, opponent.denominator, true),
      opponent.denominator,
    ),
    countMinimum: rational(minimumRankSum, TOTAL),
    countMaximum: rational(maximumRankSum, TOTAL),
    minimumHundredths: Number(ceilDivide(minimumRankSum, 20n)),
    maximumHundredths: Number(floorDivide(maximumRankSum, 20n)),
  };
}

/**
 * A not-yet-applied starting point: closest legal mean, then closest counts, then rank order.
 * At most 1771 twenty-game distributions are considered; native observations stay exact.
 */
export function nearestWholeCounts(
  distribution: RankDistribution,
  opponent: RankDistribution,
): Four<number> | null {
  const caps = wholeCountCapacities(opponent);
  const referenceRankSum = distribution.weights.reduce(
    (sum, weight, index) => sum + BigInt(index + 1) * weight,
    0n,
  );
  let best: Four<number> | null = null;
  let bestMeanDifference: bigint | null = null;
  let bestCountDifference: bigint | null = null;
  // Descending lexicographic order favors more of the earlier rank only when both costs tie.
  for (let first = Math.min(caps[0], 20); first >= 0; first--) {
    for (let second = Math.min(caps[1], 20 - first); second >= 0; second--) {
      for (let third = Math.min(caps[2], 20 - first - second); third >= 0; third--) {
        const fourth = 20 - first - second - third;
        if (fourth > caps[3]) continue;
        const candidate: Four<number> = [first, second, third, fourth];
        const difference =
          BigInt(first + 2 * second + 3 * third + 4 * fourth) * distribution.denominator -
          20n * referenceRankSum;
        const meanDifference = difference < 0n ? -difference : difference;
        if (bestMeanDifference !== null && meanDifference > bestMeanDifference) continue;
        const countDifference = RANK_INDICES.reduce(
          (sum, index) =>
            sum +
            (BigInt(candidate[index]) * distribution.denominator -
              20n * distribution.weights[index]) **
              2n,
          0n,
        );
        if (
          bestMeanDifference === null ||
          meanDifference < bestMeanDifference ||
          bestCountDifference === null ||
          countDifference < bestCountDifference
        ) {
          best = candidate;
          bestMeanDifference = meanDifference;
          bestCountDifference = countDifference;
        }
      }
    }
  }
  return best;
}

function lexicallyBefore(left: Four<number>, right: Four<number>): boolean {
  for (const index of RANK_INDICES) {
    if (left[index] !== right[index]) return left[index] < right[index];
  }
  return false;
}

/** Exact finite minimization. At most two third-rank candidates per fourth-rank count. */
export function countsFromMean(
  meanHundredths: number,
  opponent: RankDistribution,
  reference: RankDistribution,
): RankDistribution | null {
  if (!Number.isInteger(meanHundredths) || meanHundredths < 100 || meanHundredths > 400)
    return null;
  const caps = countCapacities(opponent);
  const excess = 20 * meanHundredths - COUNT_UNITS;
  let best: Four<number> | null = null;
  let bestBalance = Infinity;
  let bestReference: bigint | null = null;
  for (let fourth = 0; fourth <= caps[3]; fourth++) {
    const firstOffset = COUNT_UNITS - excess + 2 * fourth;
    const secondOffset = excess - 3 * fourth;
    const lower = Math.max(0, -firstOffset, Math.ceil((secondOffset - caps[1]) / 2));
    const upper = Math.min(caps[2], caps[0] - firstOffset, Math.floor(secondOffset / 2));
    if (lower > upper) continue;
    const center = (3 * excess - COUNT_UNITS - 8 * fourth) / 6;
    const floor = Math.max(lower, Math.min(upper, Math.floor(center)));
    const ceil = Math.max(lower, Math.min(upper, Math.ceil(center)));
    for (let third = floor; third <= ceil; third++) {
      const candidate: Four<number> = [
        firstOffset + third,
        secondOffset - 2 * third,
        third,
        fourth,
      ];
      const balance = candidate.reduce((sum, value) => sum + (value - 500) ** 2, 0);
      if (balance > bestBalance) continue;
      const distance = RANK_INDICES.reduce(
        (sum, index) =>
          sum +
          (BigInt(candidate[index]) * reference.denominator - TOTAL * reference.weights[index]) **
            2n,
        0n,
      );
      if (
        balance < bestBalance ||
        bestReference === null ||
        distance < bestReference ||
        (distance === bestReference && best !== null && lexicallyBefore(candidate, best))
      ) {
        best = candidate;
        bestBalance = balance;
        bestReference = distance;
      }
    }
  }
  return best === null ? null : distributionFromCountUnits(best);
}

/** Next grid point in the requested direction; a display-only visit must not call this. */
export function nextMeanHundredths(
  current: Rational,
  direction: -1 | 1,
  opponent: RankDistribution,
): number | null {
  const limits = meanLimits(opponent);
  const scaled = current.numerator * 100n;
  const next =
    direction === 1
      ? floorDivide(scaled, current.denominator) + 1n
      : ceilDivide(scaled, current.denominator) - 1n;
  const candidate =
    direction === 1
      ? Math.max(Number(next), limits.minimumHundredths)
      : Math.min(Number(next), limits.maximumHundredths);
  return candidate < limits.minimumHundredths || candidate > limits.maximumHundredths
    ? null
    : candidate;
}

export function meanInput(
  text: string,
  current: Rational,
): { kind: "unchanged" } | { kind: "mean"; hundredths: number } | { kind: "invalid" } {
  const value = parseDecimal(text);
  if (value === null) return { kind: "invalid" };
  if (compareRationals(value, current) === 0) return { kind: "unchanged" };
  const scaled = value.numerator * 100n;
  if (scaled % value.denominator !== 0n) return { kind: "invalid" };
  const hundredths = Number(scaled / value.denominator);
  return hundredths >= 100 && hundredths <= 400
    ? { kind: "mean", hundredths }
    : { kind: "invalid" };
}
