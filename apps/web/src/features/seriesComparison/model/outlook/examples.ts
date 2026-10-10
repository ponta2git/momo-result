import type { Rank } from "./distribution";
import { RANK_INDICES } from "./distribution";
import type { JointDistribution } from "./joint";
import { validateCumulative } from "./projection";
import type { CumulativePair } from "./projection";
import { ceilDivide, gcd } from "./rational";

export const OUTLOOK_MODEL_VERSION = "outlook-2";
export const EXAMPLE_CANDIDATE_COUNT = 201;
export const EXAMPLE_GAME_COUNT = 1000;

export type OutlookExamplePoint = Readonly<{
  games: number;
  focusAverage: number;
  rivalAverage: number;
  gap: number;
}>;
export type OutlookExample = Readonly<{
  /** Focus rank, rival rank, for each of the next 1000 games. */
  ranks: ReadonlyArray<readonly [Rank, Rank]>;
  points: readonly OutlookExamplePoint[];
}>;
export type OutlookExamples = Readonly<{
  examples: readonly [OutlookExample, OutlookExample, OutlookExample];
  distinctCandidateCount: number;
  constantPerGameDifference: boolean;
}>;

function randomWords(seed: string): () => number {
  let state = 2166136261;
  for (const byte of new TextEncoder().encode(seed))
    state = Math.imul(state ^ byte, 16777619) >>> 0;
  // Mulberry32 is part of this model version, not an unseeded runtime random source.
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return (value ^ (value >>> 14)) >>> 0;
  };
}

type Candidate = {
  ranks: Array<readonly [Rank, Rank]>;
  difference: number;
  signature: string;
  index: number;
};

/** Selection is canonical: reversing the displayed roles only reverses the resulting gaps. */
export function generateOutlookExamples(input: {
  gameTitleId: string;
  canonicalMemberIds: readonly [string, string];
  focusMemberId: string;
  cumulative: CumulativePair;
  joint: JointDistribution;
  selectionRange?: 50 | 100 | 200;
}): OutlookExamples {
  validateCumulative(input.cumulative);
  const { canonicalMemberIds, focusMemberId, joint } = input;
  const selectionRange = input.selectionRange ?? 100;
  if (![50, 100, 200].includes(selectionRange))
    throw new RangeError("Example selection requires 50, 100, or 200 games.");
  if (
    canonicalMemberIds[0] === canonicalMemberIds[1] ||
    !canonicalMemberIds.includes(focusMemberId)
  )
    throw new RangeError("Two distinct canonical members including the focus are required.");
  const divisor = joint.weights.flat().reduce(gcd, 0n);
  if (divisor <= 0n) throw new RangeError("A nonempty legal joint distribution is required.");
  const cumulativeCells: Array<{ ranks: readonly [Rank, Rank]; end: bigint }> = [];
  let total = 0n;
  const differences = new Set<number>();
  for (const i of RANK_INDICES) {
    for (const j of RANK_INDICES) {
      const weight = joint.weights[i][j];
      if (weight < 0n || (i === j && weight !== 0n))
        throw new RangeError("Joint ranks must be nonnegative and distinct.");
      if (weight === 0n) continue;
      total += weight / divisor;
      cumulativeCells.push({ ranks: [(i + 1) as Rank, (j + 1) as Rank], end: total });
      differences.add(j - i);
    }
  }
  if (total * divisor !== joint.denominator)
    throw new RangeError("Joint mass does not match its denominator.");
  // floor(word * total / 2^32) < end is exactly word < ceil(end * 2^32 / total).
  // These bounds fit exactly in Number; each draw can reuse them and the immutable rank pair.
  const cells = cumulativeCells.map(({ ranks, end }) => ({
    ranks,
    end: Number(ceilDivide(end * 0x100000000n, total)),
  }));
  // No artifact, horizon, selection range, distribution, or role enters this sequence.
  const next = randomWords(
    JSON.stringify([OUTLOOK_MODEL_VERSION, input.gameTitleId, ...canonicalMemberIds]),
  );
  const candidates: Candidate[] = [];
  for (let index = 0; index < EXAMPLE_CANDIDATE_COUNT; index++) {
    const ranks: Array<readonly [Rank, Rank]> = [];
    const trajectory = [0];
    let difference = 0;
    // Drawing every candidate in full keeps its prefix identical for every selection range.
    for (let game = 0; game < EXAMPLE_GAME_COUNT; game++) {
      // Integer boundaries cannot select zero-mass/diagonal cells, even at either endpoint.
      const word = next();
      const cell = cells.find((candidate) => word < candidate.end);
      if (!cell) throw new RangeError("Joint mass did not cover the integer sample.");
      ranks.push(cell.ranks);
      if (game < selectionRange) {
        difference += cell.ranks[1] - cell.ranks[0];
        trajectory.push(difference);
      }
    }
    candidates.push({ ranks, difference, signature: trajectory.join(","), index });
  }
  candidates.sort((left, right) => left.difference - right.difference || left.index - right.index);
  const distinctCandidateCount = new Set(candidates.map((candidate) => candidate.signature)).size;
  const selected: Candidate[] = [];
  const used = new Set<string>();
  // Use the 20th, 50th, and 80th percentiles to show modestly separated outcomes.
  for (const origin of [40, 100, 160]) {
    let chosen: Candidate | undefined;
    for (let distance = 0; distance < candidates.length && !chosen; distance++) {
      for (const index of distance === 0 ? [origin] : [origin - distance, origin + distance]) {
        const candidate = candidates[index];
        if (candidate && !used.has(candidate.signature)) {
          chosen = candidate;
          break;
        }
      }
    }
    chosen ??= candidates[origin];
    if (!chosen) throw new RangeError("Missing example candidate.");
    used.add(chosen.signature);
    selected.push(chosen);
  }
  const reversed = focusMemberId !== canonicalMemberIds[0];
  const examples = selected.map((candidate): OutlookExample => {
    const ranks = candidate.ranks.map(([first, second]): readonly [Rank, Rank] =>
      reversed ? [second, first] : [first, second],
    );
    let focusSum = BigInt(input.cumulative.focusRankSum);
    let rivalSum = BigInt(input.cumulative.rivalRankSum);
    const currentGames = BigInt(input.cumulative.games);
    const points: OutlookExamplePoint[] = [
      {
        games: 0,
        focusAverage: Number(focusSum) / Number(currentGames),
        rivalAverage: Number(rivalSum) / Number(currentGames),
        gap: Number(rivalSum - focusSum) / Number(currentGames),
      },
    ];
    for (const [index, [focusRank, rivalRank]] of ranks.entries()) {
      const games = index + 1;
      focusSum += BigInt(focusRank);
      rivalSum += BigInt(rivalRank);
      const denominator = Number(currentGames + BigInt(games));
      points.push({
        games,
        focusAverage: Number(focusSum) / denominator,
        rivalAverage: Number(rivalSum) / denominator,
        gap: Number(rivalSum - focusSum) / denominator,
      });
    }
    return { ranks, points };
  });
  const [first, second, third] = examples;
  if (!first || !second || !third) throw new RangeError("Three example selections are required.");
  return {
    examples: [first, second, third],
    distinctCandidateCount,
    constantPerGameDifference: differences.size === 1,
  };
}
