import { normalizeOutlookPair } from "@/features/seriesComparison/model/seriesAnalysisSelection";
import type { SeriesAnalysisSelection } from "@/features/seriesComparison/model/seriesAnalysisSelection";
import { distributionFromCounts } from "@/features/seriesComparison/outlook/calculation";
import type {
  CumulativePair,
  RankDistribution,
} from "@/features/seriesComparison/outlook/calculation";
import {
  outlookExampleBlock,
  outlookGoalBlock,
} from "@/features/seriesComparison/outlook/outlookProposals";
import type { OutlookApplyBlock } from "@/features/seriesComparison/outlook/outlookProposals";
import {
  otherRole,
  outlookPlayer,
} from "@/features/seriesComparison/outlook/outlookWorkspaceState";
import type {
  OutlookNotice,
  OutlookRejection,
  OutlookRole,
  OutlookSource,
  OutlookWorkspaceState,
} from "@/features/seriesComparison/outlook/outlookWorkspaceState";
import type { SeriesAnalysisOutlookSummary } from "@/shared/api/seriesAnalysis";
import { orderFixedMembers } from "@/shared/domain/members";

/**
 * What the answers and graphs read from the assumptions. Draft text is excluded, so typing in an
 * input does not change this snapshot.
 */
export type OutlookResultView = Readonly<{
  key: string;
  artifactId: string;
  focus: RankDistribution;
  rival: RankDistribution;
  /** The assumptions at the start of the current gesture, which the examples keep. */
  originFocus: RankDistribution;
  originRival: RankDistribution;
  focusSource: OutlookSource;
  gesturing: boolean;
  goalHorizon: number;
  goalHorizonText: string;
  notice: OutlookNotice | undefined;
}>;

export function outlookResultView(state: OutlookWorkspaceState): OutlookResultView {
  return {
    key: state.key,
    artifactId: state.artifactId,
    focus: state.entries[0].distribution,
    rival: state.entries[1].distribution,
    originFocus: state.gesture?.before[0].distribution ?? state.entries[0].distribution,
    originRival: state.gesture?.before[1].distribution ?? state.entries[1].distribution,
    focusSource: state.entries[0].source,
    gesturing: Boolean(state.gesture),
    goalHorizon: state.goalHorizon,
    goalHorizonText: state.goalHorizonText,
    notice: state.notice,
  };
}

/** Whether each application can run now, which unapplied text does change. */
export type OutlookApplyView = Readonly<{
  goalBlock: OutlookApplyBlock | null;
  exampleBlock: OutlookApplyBlock | null;
  rejection: OutlookRejection | undefined;
}>;

export function outlookApplyView(state: OutlookWorkspaceState): OutlookApplyView {
  return {
    goalBlock: outlookGoalBlock(state),
    exampleBlock: outlookExampleBlock(state),
    rejection: state.rejection,
  };
}

/** One person's input: their exact assumption, its origin, and their unapplied text. */
export type OutlookPlayerView = Readonly<{
  artifactId: string;
  distribution: RankDistribution;
  opponent: RankDistribution;
  source: OutlookSource;
  meanDraft: string | undefined;
  error: string | undefined;
}>;

export function outlookPlayerView(state: OutlookWorkspaceState, role: OutlookRole) {
  const entry = state.entries[role];
  return {
    artifactId: state.artifactId,
    distribution: entry.distribution,
    opponent: state.entries[otherRole(role)].distribution,
    source: entry.source,
    meanDraft: entry.meanDraft,
    error: entry.error,
  } satisfies OutlookPlayerView;
}

export function buildOutlookComparisonView(
  summary: SeriesAnalysisOutlookSummary,
  requestedFocusMemberId?: string,
  requestedRivalMemberId?: string,
) {
  const { focusMemberId, rivalMemberId } = normalizeOutlookPair(
    requestedFocusMemberId,
    requestedRivalMemberId,
  );
  const memberIds = [focusMemberId, rivalMemberId] as const;
  const players = [
    outlookPlayer(summary.players, focusMemberId),
    outlookPlayer(summary.players, rivalMemberId),
  ] as const;
  const names = [players[0].displayName, players[1].displayName] as const;
  const displayRoles = orderFixedMembers(
    memberIds.map((memberId, role) => ({ memberId, role: role as OutlookRole })),
  );
  const recent = [
    distributionFromCounts(outlookPlayer(summary.recent.players, focusMemberId).rankCounts),
    distributionFromCounts(outlookPlayer(summary.recent.players, rivalMemberId).rankCounts),
  ] as const;
  const cumulative: CumulativePair = {
    games: summary.scope.matchCount,
    focusRankSum: players[0].rankSum,
    rivalRankSum: players[1].rankSum,
  };
  return { memberIds, names, displayRoles, recent, cumulative };
}

export function buildOutlookWorkspaceLinks(
  location: { pathname: string; search: string },
  selection: SeriesAnalysisSelection,
  gameTitleId: string,
  focusMemberId: string,
) {
  const reviewSearch = new URLSearchParams(location.search);
  reviewSearch.set("view", "review");
  const matchParams = new URLSearchParams({ gameTitleId });
  if (selection.seasonMasterId) matchParams.set("seasonMasterId", selection.seasonMasterId);
  return {
    reviewHref: `${location.pathname}?${reviewSearch}#review-member-${focusMemberId}`,
    matchHref: `/matches?${matchParams}`,
  };
}
