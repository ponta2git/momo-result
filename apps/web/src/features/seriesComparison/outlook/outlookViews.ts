import {
  areDistributionsCompatible,
  compareRationals,
  distributionFromCounts,
  distributionMean,
  distributionsEqual,
  rational,
  requiredMean,
  projectOutlook,
  nextMatchOutcomes,
  subtractRationals,
} from "@/features/seriesComparison/model/outlook";
import type {
  CumulativePair,
  RankDistribution,
  RequiredMean,
  Rational,
} from "@/features/seriesComparison/model/outlook";
import { normalizeOutlookPair } from "@/features/seriesComparison/model/seriesAnalysisViewModel";
import type { SeriesAnalysisSelection } from "@/features/seriesComparison/model/seriesAnalysisViewModel";
import { outlookExampleMeetsCondition } from "@/features/seriesComparison/outlook/outlookApplication";
import type { OutlookCountProposal } from "@/features/seriesComparison/outlook/outlookApplication";
import { parseOutlookHorizon } from "@/features/seriesComparison/outlook/outlookEditing";
import { outlookOutcome } from "@/features/seriesComparison/outlook/outlookOutcome";
import {
  outlookAverage,
  outlookSourceLabel,
} from "@/features/seriesComparison/outlook/outlookPresentation";
import type {
  HistoricalOutlookExample,
  OutlookExamplesData,
} from "@/features/seriesComparison/outlook/outlookResourceModel";
import {
  canPinOutlook,
  otherRole,
  outlookPlayer,
} from "@/features/seriesComparison/outlook/outlookSession";
import type {
  OutlookRole,
  OutlookSession,
  OutlookRankIndex,
} from "@/features/seriesComparison/outlook/outlookSession";
import type { SeriesAnalysisOutlookSummary } from "@/shared/api/seriesAnalysis";
import { orderFixedMembers } from "@/shared/domain/members";

export type OutlookEditorView = Readonly<{
  distribution: RankDistribution;
  opponent: RankDistribution;
  meanDraft: string | undefined;
  error: string | undefined;
  transfer: readonly [OutlookRankIndex, OutlookRankIndex];
}>;
export function outlookEditorView(session: OutlookSession, role: OutlookRole): OutlookEditorView {
  const entry = session.entries[role];
  return {
    distribution: entry.distribution,
    opponent: session.entries[otherRole(role)].distribution,
    meanDraft: entry.meanDraft,
    error: entry.error,
    transfer: session.transfer,
  };
}

export type OutlookResultView = Readonly<{
  focus: RankDistribution;
  rival: RankDistribution;
  originFocus: RankDistribution;
  originRival: RankDistribution;
  pinnedFocus: RankDistribution | undefined;
  pinnedRival: RankDistribution | undefined;
  gesturing: boolean;
  task: "performance" | "goal";
  notice: string | undefined;
  horizon: number;
  horizonText: string;
  chartRange: 50 | 100 | 200;
}>;

export function outlookResultView(session: OutlookSession): OutlookResultView {
  return {
    focus: session.entries[0].distribution,
    rival: session.entries[1].distribution,
    originFocus: session.gesture?.before[0].distribution ?? session.entries[0].distribution,
    originRival: session.gesture?.before[1].distribution ?? session.entries[1].distribution,
    pinnedFocus: session.pinned?.[0].distribution,
    pinnedRival: session.pinned?.[1].distribution,
    gesturing: Boolean(session.gesture),
    task: session.task,
    notice: session.notice,
    horizon: session.horizon,
    horizonText: session.horizonText,
    chartRange: session.chartRange,
  };
}

export function outlookToolbarView(session: OutlookSession) {
  return {
    canUndo: session.history.length > 0 || Boolean(session.gesture),
    canPin: canPinOutlook(session),
    pinned: session.pinned !== undefined,
    pending: session.entries.some(
      (entry) => entry.meanDraft !== undefined || entry.error !== undefined,
    ),
  };
}

export function outlookPlayerInput(session: OutlookSession, role: OutlookRole) {
  return {
    key: session.key,
    artifactId: session.artifactId,
    entry: session.entries[role],
    opponent: session.entries[otherRole(role)].distribution,
    transfer: session.transfer,
    baseline: session.pinned?.[role].distribution,
  };
}
export type OutlookPlayerView = OutlookEditorView &
  Readonly<{
    hasBaseline: boolean;
    baselineMean: string;
    unchanged: boolean;
    outdated: boolean;
    differenceLabel: string;
  }>;

export function outlookPlayerView(
  input: ReturnType<typeof outlookPlayerInput>,
  response: SeriesAnalysisOutlookSummary,
  memberId: string,
  showComparison: boolean,
): OutlookPlayerView {
  const { entry } = input;
  const recent = distributionFromCounts(
    outlookPlayer(response.recent.players, memberId).rankCounts,
  );
  const difference = subtractRationals(
    distributionMean(recent),
    distributionMean(entry.distribution),
  );
  const baseline = showComparison ? input.baseline : undefined;
  return {
    distribution: entry.distribution,
    meanDraft: entry.meanDraft,
    error: entry.error,
    opponent: input.opponent,
    transfer: input.transfer,
    hasBaseline: baseline !== undefined,
    baselineMean: outlookAverage(distributionMean(baseline ?? recent)),
    unchanged:
      distributionsEqual(entry.distribution, recent) &&
      entry.meanDraft === undefined &&
      entry.source.kind === "recent" &&
      entry.source.artifactId === input.artifactId,
    outdated: entry.source.artifactId !== undefined && entry.source.artifactId !== input.artifactId,
    differenceLabel:
      difference.numerator === 0n
        ? "直近と同じ平均"
        : `直近より${outlookAverage(rational(difference.numerator < 0n ? -difference.numerator : difference.numerator, difference.denominator))}位${difference.numerator > 0n ? "上" : "下"}`,
  };
}

export function outlookCountProposalView(
  proposal: OutlookCountProposal,
  current: { key: string; artifactId: string },
) {
  const entry = proposal.draft.entries[proposal.role];
  const stale =
    current.key !== proposal.initial.key || current.artifactId !== proposal.initial.artifactId;
  return {
    role: proposal.role,
    name: proposal.names[proposal.role],
    editor: outlookEditorView(proposal.draft, proposal.role),
    sourceLabel: outlookSourceLabel(entry.source, current.artifactId),
    average: outlookAverage(distributionMean(entry.distribution)),
    outcome: outlookOutcome(
      proposal.cumulative,
      [proposal.draft.entries[0].distribution, proposal.draft.entries[1].distribution],
      proposal.names,
    ),
    stale,
    canApply: !stale && entry.error === undefined,
    canUndo: proposal.draft.history.length > 0 || Boolean(proposal.draft.gesture),
    editorVersion: proposal.editorVersion,
  };
}

export function outlookGoalInput(session: OutlookSession) {
  return {
    key: session.key,
    focus: session.entries[0].distribution,
    rival: session.entries[1].distribution,
    chosenCounts: ["counts", "example"].includes(session.entries[0].source.kind),
    opponentPending:
      session.entries[1].meanDraft !== undefined ||
      session.entries[1].error !== undefined ||
      Boolean(session.gesture),
    goalHorizon: session.goalHorizon,
    goalHorizonText: session.goalHorizonText,
  };
}
export type OutlookGoalView = Readonly<{
  goalHorizon: number;
  valid: boolean;
  required: RequiredMean;
  maximum: number | null;
  ahead: boolean;
  reaches: boolean;
  opponentPending: boolean;
  performanceMean: string | undefined;
  recentMean: Rational;
  recentWithinMean: boolean;
  improvement: Rational | null;
  rival: RankDistribution;
  reviewHeading: string;
}>;

export function outlookGoalView(
  input: ReturnType<typeof outlookGoalInput>,
  cumulative: CumulativePair,
  recent: readonly [RankDistribution, RankDistribution],
): OutlookGoalView {
  const { focus, rival, goalHorizon, opponentPending, chosenCounts } = input;
  const valid = parseOutlookHorizon(input.goalHorizonText) === goalHorizon;
  const required = requiredMean(cumulative, rival, goalHorizon);
  const maximum = required.maximumHundredths;
  const ahead = cumulative.focusRankSum < cumulative.rivalRankSum;
  const reaches =
    compareRationals(distributionMean(focus), required.threshold) < 0 &&
    areDistributionsCompatible(focus, rival);
  const performanceMean = reaches
    ? outlookAverage(distributionMean(focus))
    : maximum === null
      ? undefined
      : (maximum / 100).toFixed(2);
  const recentMean = distributionMean(recent[0]);
  const recentWithinMean = compareRationals(recentMean, required.threshold) < 0;
  const improvement =
    maximum === null ? null : subtractRationals(recentMean, rational(BigInt(maximum), 100n));
  const fewerLowerRanks =
    (focus.weights[2] + focus.weights[3]) * recent[0].denominator <
    (recent[0].weights[2] + recent[0].weights[3]) * focus.denominator;
  const moreWins =
    focus.weights[0] * recent[0].denominator > recent[0].weights[0] * focus.denominator;
  const reviewHeading =
    chosenCounts && fewerLowerRanks
      ? "下位だった試合を振り返る"
      : chosenCounts && moreWins
        ? "勝ち切れなかった試合を振り返る"
        : recentWithinMean && areDistributionsCompatible(recent[0], rival)
          ? "今の成績を続ける手掛かりを探す"
          : "改善の手掛かりを探す";
  return {
    goalHorizon,
    valid,
    required,
    maximum,
    ahead,
    reaches,
    opponentPending,
    performanceMean,
    recentMean,
    recentWithinMean,
    improvement,
    rival,
    reviewHeading,
  };
}

export type OutlookReferenceCondition =
  | { kind: "mean"; role: OutlookRole }
  | { kind: "goal"; cumulative: CumulativePair; required: RequiredMean };
export function outlookReferenceInput(session: OutlookSession, role: OutlookRole) {
  const target = session.entries[role];
  const peer = session.entries[otherRole(role)];
  return {
    key: session.key,
    target: target.distribution,
    peer: peer.distribution,
    targetPending: target.meanDraft !== undefined || target.error !== undefined,
    peerPending: peer.meanDraft !== undefined || peer.error !== undefined,
    focusPending:
      session.entries[0].meanDraft !== undefined || session.entries[0].error !== undefined,
    gesturing: Boolean(session.gesture),
    task: session.task,
    goalHorizon: session.goalHorizon,
    goalHorizonText: session.goalHorizonText,
    open: role === 0 ? session.examplesOpen : session.rivalExamplesOpen,
  };
}
export type OutlookReferenceView = Readonly<{
  open: boolean;
  role: OutlookRole;
  targetMean: Rational;
  pending: boolean;
  invalidGoal: boolean;
  examples: readonly HistoricalOutlookExample[];
  hasQualifying: boolean;
  goalHorizon: number;
  pendingMessage: string;
  hasDraft: boolean;
}>;

export function outlookReferenceView(
  input: ReturnType<typeof outlookReferenceInput>,
  condition: OutlookReferenceCondition,
  data: OutlookExamplesData | undefined,
): OutlookReferenceView {
  const role = condition.kind === "goal" ? 0 : condition.role;
  const targetMean = distributionMean(input.target);
  const threshold = condition.kind === "goal" ? condition.required.threshold : targetMean;
  const pending =
    input.gesturing || input.peerPending || (condition.kind === "mean" && input.targetPending);
  const invalidGoal =
    condition.kind === "goal" && parseOutlookHorizon(input.goalHorizonText) !== input.goalHorizon;
  const examples: HistoricalOutlookExample[] = [];
  let hasQualifying = false;
  if (input.open && data) {
    for (const example of data.examples.types) {
      const distribution = distributionFromCounts(example.rankCounts);
      if (!outlookExampleMeetsCondition(distribution, threshold, condition.kind, role)) continue;
      hasQualifying = true;
      if (areDistributionsCompatible(distribution, input.peer)) examples.push(example);
      if (examples.length === 3) break;
    }
  }
  const pendingMessage = input.gesturing
    ? "平均順位の操作を終えてから、成績例を試してください。"
    : input.task === "goal" && input.focusPending
      ? "「成績から試す」で、2人の入力を反映するか、取り消してください。"
      : "成績例を試す前に、2人の入力を反映するか、取り消してください。";
  return {
    open: input.open,
    role,
    targetMean,
    pending,
    invalidGoal,
    examples,
    hasQualifying,
    goalHorizon: input.goalHorizon,
    pendingMessage,
    hasDraft: input.targetPending,
  };
}

export function outlookGoalHorizonView(session: OutlookSession) {
  return { horizon: session.goalHorizon, horizonText: session.goalHorizonText };
}

export function outlookComparisonView(
  response: SeriesAnalysisOutlookSummary,
  focus?: string,
  rival?: string,
) {
  const { focusMemberId, rivalMemberId } = normalizeOutlookPair(focus, rival);
  const ids = [focusMemberId, rivalMemberId] as const;
  const players = [
    outlookPlayer(response.players, focusMemberId),
    outlookPlayer(response.players, rivalMemberId),
  ] as const;
  const names = [players[0].displayName, players[1].displayName] as const;
  const displayRoles = orderFixedMembers(
    ids.map((memberId, role) => ({ memberId, role: role as OutlookRole })),
  );
  const recent = [
    distributionFromCounts(outlookPlayer(response.recent.players, focusMemberId).rankCounts),
    distributionFromCounts(outlookPlayer(response.recent.players, rivalMemberId).rankCounts),
  ] as const;
  const cumulative: CumulativePair = {
    games: response.scope.matchCount,
    focusRankSum: players[0].rankSum,
    rivalRankSum: players[1].rankSum,
  };
  return { ids, names, displayRoles, recent, cumulative };
}
export function outlookResultPresentation(
  cumulative: CumulativePair,
  focus: RankDistribution,
  rival: RankDistribution,
  names: readonly [string, string],
  horizon: number,
) {
  const outcome = outlookOutcome(cumulative, [focus, rival], names);
  const eventHorizon =
    outcome.eventHorizon !== null && outcome.eventHorizon <= 1000n
      ? Number(outcome.eventHorizon)
      : null;
  const numericRows = [...new Set([0, 10, 20, 50, 100, horizon])]
    .toSorted((a, b) => a - b)
    .map((h) => ({ h, ...projectOutlook(cumulative, focus, rival, h) }));
  const nextOutcomes = nextMatchOutcomes(cumulative).filter((next) =>
    outcome.crossing.current === "ahead"
      ? next.relation !== "ahead"
      : outcome.crossing.current === "behind"
        ? next.relation !== "behind"
        : true,
  );
  return { outcome, eventHorizon, numericRows, nextOutcomes };
}
export function outlookWorkspaceLinks(
  location: { pathname: string; search: string },
  selection: SeriesAnalysisSelection,
  gameTitleId: string,
  focusMemberId: string,
) {
  const reviewSearch = new URLSearchParams(location.search);
  reviewSearch.set("view", "review");
  const matchParams = new URLSearchParams({ gameTitleId, status: "confirmed" });
  if (selection.seasonMasterId) matchParams.set("seasonMasterId", selection.seasonMasterId);
  return {
    reviewHref: `${location.pathname}?${reviewSearch}#review-member-${focusMemberId}`,
    matchHref: `/matches?${matchParams}`,
  };
}
