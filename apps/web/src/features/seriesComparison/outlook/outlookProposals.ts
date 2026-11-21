import {
  areDistributionsCompatible,
  compareRationals,
  countsFromMean,
  distributionFromCounts,
  distributionMean,
  distributionsEqual,
  requiredMean,
} from "@/features/seriesComparison/outlook/calculation";
import type {
  CumulativePair,
  RankDistribution,
  Rational,
} from "@/features/seriesComparison/outlook/calculation";
import type { HistoricalOutlookExample } from "@/features/seriesComparison/outlook/outlookReferenceTypes";
import {
  applyOutlookDistribution,
  outlookHasPendingInput,
} from "@/features/seriesComparison/outlook/outlookWorkspaceState";
import type { OutlookWorkspaceState } from "@/features/seriesComparison/outlook/outlookWorkspaceState";

export function parseOutlookHorizon(text: string) {
  const value = Number(text);
  return /^\d+$/u.test(text) && value >= 1 && value <= 1000 ? value : undefined;
}

/** Why an application waits; the reason is shown next to the action it blocks. */
export type OutlookApplyBlock = "gesture" | "rival-pending" | "pending" | "invalid-goal";

/**
 * The goal's required mean replaces the focus person's unapplied text, but never the rival's:
 * the requirement is computed from the rival's applied value.
 */
export function outlookGoalBlock(state: OutlookWorkspaceState): OutlookApplyBlock | null {
  if (state.gesture) return "gesture";
  if (outlookHasPendingInput(state, 1)) return "rival-pending";
  if (parseOutlookHorizon(state.goalHorizonText) !== state.goalHorizon) return "invalid-goal";
  return null;
}

/** A past example neither applies nor discards either person's unapplied text. */
export function outlookExampleBlock(state: OutlookWorkspaceState): OutlookApplyBlock | null {
  if (state.gesture) return "gesture";
  if (outlookHasPendingInput(state)) return "pending";
  if (parseOutlookHorizon(state.goalHorizonText) !== state.goalHorizon) return "invalid-goal";
  return null;
}

/** The condition an application was shown for; it is checked again against the latest state. */
export type OutlookGoalExpectation = Readonly<{
  key: string;
  artifactId: string;
  horizon: number;
  rival: RankDistribution;
  cumulative: CumulativePair;
}>;

function goalChanged(state: OutlookWorkspaceState, expected: OutlookGoalExpectation) {
  return (
    state.goalHorizon !== expected.horizon ||
    !distributionsEqual(state.entries[1].distribution, expected.rival)
  );
}
function foreign(state: OutlookWorkspaceState, expected: OutlookGoalExpectation) {
  return state.key !== expected.key || state.artifactId !== expected.artifactId;
}

export function outlookMeetsGoal(distribution: RankDistribution, threshold: Rational) {
  return compareRationals(distributionMean(distribution), threshold) < 0;
}

/**
 * Applies the strict goal's best 0.01 mean to the focus person. A focus that already meets the
 * goal is never weakened.
 */
export function applyOutlookGoal(
  state: OutlookWorkspaceState,
  expected: OutlookGoalExpectation,
  maximumHundredths: number,
): OutlookWorkspaceState {
  if (foreign(state, expected) || outlookGoalBlock(state)) return state;
  const rival = state.entries[1].distribution;
  const latest = requiredMean(expected.cumulative, rival, state.goalHorizon);
  if (goalChanged(state, expected) || latest.maximumHundredths !== maximumHundredths)
    return { ...state, rejection: "goal" };
  const focus = state.entries[0].distribution;
  if (outlookMeetsGoal(focus, latest.threshold) && areDistributionsCompatible(focus, rival))
    return state;
  const distribution = countsFromMean(maximumHundredths, rival, focus);
  if (!distribution) return { ...state, rejection: "goal" };
  return applyOutlookDistribution(state, 0, distribution, { kind: "average" });
}

/** Applies one past 20-game example to the focus person if it still strictly meets the goal. */
export function applyOutlookExample(
  state: OutlookWorkspaceState,
  expected: OutlookGoalExpectation,
  example: HistoricalOutlookExample,
): OutlookWorkspaceState {
  if (foreign(state, expected) || outlookExampleBlock(state)) return state;
  if (goalChanged(state, expected)) return { ...state, rejection: "example" };
  const rival = state.entries[1].distribution;
  const distribution = distributionFromCounts(example.rankCounts);
  const { threshold } = requiredMean(expected.cumulative, rival, state.goalHorizon);
  if (
    !outlookMeetsGoal(distribution, threshold) ||
    !areDistributionsCompatible(distribution, rival)
  )
    return { ...state, rejection: "example" };
  return applyOutlookDistribution(state, 0, distribution, {
    kind: "example",
    artifactId: state.artifactId,
    period: example.window.period,
  });
}
