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
import {
  editOutlook,
  parseOutlookHorizon,
} from "@/features/seriesComparison/outlook/outlookEditing";
import type { HistoricalOutlookExample } from "@/features/seriesComparison/outlook/outlookReferenceTypes";
import {
  applyOutlookDistribution,
  draftOutlook,
  outlookPlayer,
  undoOutlook,
  finishOutlookGesture,
  otherRole,
  updateOutlookEntry,
} from "@/features/seriesComparison/outlook/outlookWorkspaceState";
import type {
  OutlookRole,
  OutlookWorkspaceState,
} from "@/features/seriesComparison/outlook/outlookWorkspaceState";
import type { SeriesAnalysisOutlookSummary } from "@/shared/api/seriesAnalysis";
type OutlookProposalResult = { state: OutlookWorkspaceState; applied: boolean };
function rejectOutlookProposal(state: OutlookWorkspaceState): OutlookProposalResult {
  return { state, applied: false };
}
type GoalExpectation = {
  key: string;
  artifactId: string;
  horizon: number;
  rival: RankDistribution;
  maximum: number | null;
  cumulative: CumulativePair;
};

/** Recheck the displayed proposal against the latest pair, then change task in the same commit. */
export function applyOutlookGoal(
  current: OutlookWorkspaceState,
  expected: GoalExpectation,
): OutlookProposalResult {
  if (
    current.artifactId !== expected.artifactId ||
    current.key !== expected.key ||
    current.entries[1].meanDraft !== undefined ||
    current.entries[1].error !== undefined ||
    current.gesture !== undefined ||
    parseOutlookHorizon(current.goalHorizonText) !== current.goalHorizon
  )
    return rejectOutlookProposal(current);
  const latest = requiredMean(
    expected.cumulative,
    current.entries[1].distribution,
    current.goalHorizon,
  );
  if (
    current.goalHorizon !== expected.horizon ||
    !distributionsEqual(current.entries[1].distribution, expected.rival) ||
    latest.maximumHundredths !== expected.maximum
  )
    return rejectOutlookProposal({
      ...current,
      notice: "条件が変わりました。必要な平均を確認して、もう一度試してください。",
    });
  const focus = current.entries[0].distribution;
  let next: OutlookWorkspaceState;
  if (
    compareRationals(distributionMean(focus), latest.threshold) < 0 &&
    areDistributionsCompatible(focus, current.entries[1].distribution)
  ) {
    next = updateOutlookEntry(current, 0, { meanDraft: undefined, error: undefined });
  } else {
    if (latest.maximumHundredths === null) return rejectOutlookProposal(current);
    const distribution = countsFromMean(
      latest.maximumHundredths,
      current.entries[1].distribution,
      focus,
    );
    if (!distribution) return rejectOutlookProposal(current);
    next = applyOutlookDistribution(finishOutlookGesture(current), 0, distribution, {
      kind: "average",
    });
  }
  return { state: editOutlook(next, { kind: "use-performance" }), applied: true };
}

export function outlookExampleMeetsCondition(
  distribution: RankDistribution,
  threshold: Rational,
  kind: "mean" | "goal",
  role: OutlookRole,
) {
  const comparison = compareRationals(distributionMean(distribution), threshold);
  return kind === "goal" ? comparison < 0 : role === 0 ? comparison <= 0 : comparison >= 0;
}

export function outlookExampleInputPending(
  state: Pick<OutlookWorkspaceState, "entries" | "gesture">,
  role: OutlookRole,
  kind: "mean" | "goal",
) {
  const peer = state.entries[otherRole(role)];
  const target = state.entries[role];
  return (
    Boolean(state.gesture) ||
    peer.meanDraft !== undefined ||
    peer.error !== undefined ||
    (kind === "mean" && (target.meanDraft !== undefined || target.error !== undefined))
  );
}

type ExampleExpectation = {
  key: string;
  artifactId: string;
  role: OutlookRole;
  target: RankDistribution;
  peer: RankDistribution;
  condition: { kind: "mean" } | { kind: "goal"; cumulative: CumulativePair; horizon: number };
};
export function applyOutlookExample(
  current: OutlookWorkspaceState,
  expected: ExampleExpectation,
  example: HistoricalOutlookExample,
): OutlookProposalResult {
  const { role, condition } = expected;
  const peerRole = otherRole(role);
  if (
    current.artifactId !== expected.artifactId ||
    current.key !== expected.key ||
    outlookExampleInputPending(current, role, condition.kind) ||
    (condition.kind === "goal" &&
      parseOutlookHorizon(current.goalHorizonText) !== current.goalHorizon)
  )
    return rejectOutlookProposal(current);
  if (
    !distributionsEqual(current.entries[peerRole].distribution, expected.peer) ||
    (condition.kind === "goal"
      ? current.goalHorizon !== condition.horizon
      : !distributionsEqual(current.entries[role].distribution, expected.target))
  )
    return rejectOutlookProposal({
      ...current,
      notice: "条件が変わりました。成績例を確認して、もう一度試してください。",
    });
  const distribution = distributionFromCounts(example.rankCounts);
  const threshold =
    condition.kind === "goal"
      ? requiredMean(condition.cumulative, current.entries[1].distribution, current.goalHorizon)
          .threshold
      : distributionMean(current.entries[role].distribution);
  if (
    !outlookExampleMeetsCondition(distribution, threshold, condition.kind, role) ||
    !areDistributionsCompatible(distribution, current.entries[peerRole].distribution)
  )
    return rejectOutlookProposal({
      ...current,
      notice: "条件が変わったため、この実績例を適用できません。",
    });
  const next = applyOutlookDistribution(finishOutlookGesture(current), role, distribution, {
    kind: "example",
    artifactId: current.artifactId,
    matchCount: 20,
    period: example.window.period,
  });
  return {
    state: condition.kind === "goal" ? editOutlook(next, { kind: "use-performance" }) : next,
    applied: true,
  };
}

export type OutlookCountProposal = {
  initial: { key: string; artifactId: string };
  draft: OutlookWorkspaceState;
  cumulative: CumulativePair;
  names: readonly [string, string];
  role: OutlookRole;
  editorVersion: number;
};
export function beginOutlookCountProposal(
  state: OutlookWorkspaceState,
  role: OutlookRole,
  cumulative: CumulativePair,
  names: readonly [string, string],
): OutlookCountProposal {
  return {
    initial: { key: state.key, artifactId: state.artifactId },
    draft: draftOutlook(state),
    cumulative,
    names,
    role,
    editorVersion: 0,
  };
}
export function undoOutlookCountProposal(proposal: OutlookCountProposal): OutlookCountProposal {
  return {
    ...proposal,
    draft: undoOutlook(finishOutlookGesture(proposal.draft)),
    editorVersion: proposal.editorVersion + 1,
  };
}
export function applyOutlookCountProposal(
  current: OutlookWorkspaceState,
  proposal: OutlookCountProposal,
): OutlookProposalResult {
  const entry = proposal.draft.entries[proposal.role];
  if (
    entry.error !== undefined ||
    current.key !== proposal.initial.key ||
    current.artifactId !== proposal.initial.artifactId ||
    !areDistributionsCompatible(
      entry.distribution,
      current.entries[otherRole(proposal.role)].distribution,
    )
  )
    return { state: current, applied: false };
  return {
    state: applyOutlookDistribution(
      finishOutlookGesture(current),
      proposal.role,
      entry.distribution,
      entry.source,
    ),
    applied: true,
  };
}
export function restoreOutlookRecent(
  current: OutlookWorkspaceState,
  response: SeriesAnalysisOutlookSummary,
  memberId: string,
  role: OutlookRole,
) {
  return applyOutlookDistribution(
    finishOutlookGesture(current),
    role,
    distributionFromCounts(outlookPlayer(response.recent.players, memberId).rankCounts),
    {
      kind: "recent",
      artifactId: response.artifact.artifactId,
      matchCount: response.recent.matchCount,
      ...(response.recent.period ? { period: response.recent.period } : {}),
    },
  );
}
