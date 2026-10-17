import {
  areDistributionsCompatible,
  compareRationals,
  countsFromMean,
  distributionFromCounts,
  distributionMean,
  distributionsEqual,
  requiredMean,
} from "@/features/seriesComparison/model/outlook";
import type {
  CumulativePair,
  RankDistribution,
  Rational,
} from "@/features/seriesComparison/model/outlook";
import {
  editOutlook,
  parseOutlookHorizon,
} from "@/features/seriesComparison/outlook/outlookEditing";
import type { HistoricalOutlookExample } from "@/features/seriesComparison/outlook/outlookResourceModel";
import {
  applyOutlookDistribution,
  draftOutlook,
  outlookPlayer,
  undoOutlook,
  finishOutlookGesture,
  otherRole,
  updateOutlookEntry,
} from "@/features/seriesComparison/outlook/outlookSession";
import type {
  OutlookRole,
  OutlookSession,
} from "@/features/seriesComparison/outlook/outlookSession";
import type { SeriesAnalysisOutlookSummary } from "@/shared/api/seriesAnalysis";
type Application = { session: OutlookSession; applied: boolean };
function rejectOutlookApplication(session: OutlookSession): Application {
  return { session, applied: false };
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
export function applyOutlookGoal(current: OutlookSession, expected: GoalExpectation): Application {
  if (
    current.artifactId !== expected.artifactId ||
    current.key !== expected.key ||
    current.entries[1].meanDraft !== undefined ||
    current.entries[1].error !== undefined ||
    current.gesture !== undefined ||
    parseOutlookHorizon(current.goalHorizonText) !== current.goalHorizon
  )
    return rejectOutlookApplication(current);
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
    return rejectOutlookApplication({
      ...current,
      notice: "条件が変わりました。必要な平均を確認して、もう一度試してください。",
    });
  const focus = current.entries[0].distribution;
  let next: OutlookSession;
  if (
    compareRationals(distributionMean(focus), latest.threshold) < 0 &&
    areDistributionsCompatible(focus, current.entries[1].distribution)
  ) {
    next = updateOutlookEntry(current, 0, { meanDraft: undefined, error: undefined });
  } else {
    if (latest.maximumHundredths === null) return rejectOutlookApplication(current);
    const distribution = countsFromMean(
      latest.maximumHundredths,
      current.entries[1].distribution,
      focus,
    );
    if (!distribution) return rejectOutlookApplication(current);
    next = applyOutlookDistribution(finishOutlookGesture(current), 0, distribution, {
      kind: "average",
    });
  }
  return { session: editOutlook(next, { kind: "use-performance" }), applied: true };
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
  session: Pick<OutlookSession, "entries" | "gesture">,
  role: OutlookRole,
  kind: "mean" | "goal",
) {
  const peer = session.entries[otherRole(role)];
  const target = session.entries[role];
  return (
    Boolean(session.gesture) ||
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
  current: OutlookSession,
  expected: ExampleExpectation,
  example: HistoricalOutlookExample,
): Application {
  const { role, condition } = expected;
  const peerRole = otherRole(role);
  if (
    current.artifactId !== expected.artifactId ||
    current.key !== expected.key ||
    outlookExampleInputPending(current, role, condition.kind) ||
    (condition.kind === "goal" &&
      parseOutlookHorizon(current.goalHorizonText) !== current.goalHorizon)
  )
    return rejectOutlookApplication(current);
  if (
    !distributionsEqual(current.entries[peerRole].distribution, expected.peer) ||
    (condition.kind === "goal"
      ? current.goalHorizon !== condition.horizon
      : !distributionsEqual(current.entries[role].distribution, expected.target))
  )
    return rejectOutlookApplication({
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
    return rejectOutlookApplication({
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
    session: condition.kind === "goal" ? editOutlook(next, { kind: "use-performance" }) : next,
    applied: true,
  };
}

export type OutlookCountProposal = {
  initial: { key: string; artifactId: string };
  draft: OutlookSession;
  cumulative: CumulativePair;
  names: readonly [string, string];
  role: OutlookRole;
  editorVersion: number;
};
export function beginOutlookCountProposal(
  session: OutlookSession,
  role: OutlookRole,
  cumulative: CumulativePair,
  names: readonly [string, string],
): OutlookCountProposal {
  return {
    initial: { key: session.key, artifactId: session.artifactId },
    draft: draftOutlook(session),
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
  current: OutlookSession,
  proposal: OutlookCountProposal,
): Application {
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
    return { session: current, applied: false };
  return {
    session: applyOutlookDistribution(
      finishOutlookGesture(current),
      proposal.role,
      entry.distribution,
      entry.source,
    ),
    applied: true,
  };
}
export function restoreOutlookRecent(
  current: OutlookSession,
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
