import {
  areDistributionsCompatible,
  compareRationals,
  distributionFromCounts,
  distributionMean,
  distributionsEqual,
  formatRational,
  nextMatchOutcomes,
  projectOutlook,
  rational,
  requiredMean,
  subtractRationals,
} from "@/features/seriesComparison/outlook/calculation";
import type {
  CumulativePair,
  RankDistribution,
  Rational,
  RequiredMean,
} from "@/features/seriesComparison/outlook/calculation";
import { outlookOutcome } from "@/features/seriesComparison/outlook/outlookOutcome";
import {
  outlookAverage,
  outlookMonthRange,
} from "@/features/seriesComparison/outlook/outlookPresentation";
import { outlookMeetsGoal } from "@/features/seriesComparison/outlook/outlookProposals";
import type {
  HistoricalOutlookExample,
  OutlookExamplesData,
  OutlookHistoricalWindow,
} from "@/features/seriesComparison/outlook/outlookReferenceTypes";
import type { OutlookSource } from "@/features/seriesComparison/outlook/outlookWorkspaceState";

type Pair = readonly [RankDistribution, RankDistribution];
type Names = readonly [string, string];

export type OutlookTrendAnswer = Readonly<{
  headline: string;
  /** An integer tie before the first strict lead, or a tie that starts now. */
  tie: string | null;
  /** The recent results' answer, only while either assumption differs from them. */
  recentComparison: string | null;
  /** Rank pairs that would move the order in the actual next game. */
  nextGame: string | null;
  /** The integer game where the order first meets or changes, if it is inside the graph. */
  marker: Readonly<{ h: number; label: string }> | null;
  /** The first strict lead when it lies after the graph. */
  beyondRange: string | null;
}>;

/** 「この平均が続くと」: one answer from exact values, shared by the question and the strip. */
export function outlookTrendAnswer({
  cumulative,
  pair,
  recent,
  names,
  range,
  recentGames,
}: {
  cumulative: CumulativePair;
  pair: Pair;
  recent: Pair;
  names: Names;
  range: number;
  recentGames: number;
}): OutlookTrendAnswer {
  const outcome = outlookOutcome(cumulative, pair, names);
  const sameAsRecent =
    distributionsEqual(pair[0], recent[0]) && distributionsEqual(pair[1], recent[1]);
  const tie = outcome.crossing.exactTie;
  const event = outcome.eventHorizon;
  const limit = BigInt(range);
  const marker =
    tie !== null && tie > 0n && tie <= limit
      ? { h: Number(tie), label: `${tie}戦後に同率` }
      : event !== null && event <= limit
        ? { h: Number(event), label: `${event}戦後` }
        : null;
  const nextOutcomes = nextMatchOutcomes(cumulative).filter((next) =>
    outcome.crossing.current === "ahead"
      ? next.relation !== "ahead"
      : outcome.crossing.current === "behind"
        ? next.relation !== "behind"
        : true,
  );
  return {
    headline: outcome.headline,
    tie: outcome.detail,
    recentComparison: sameAsRecent
      ? null
      : `直近${recentGames}戦のままなら：${outlookOutcome(cumulative, recent, names).headline}`,
    nextGame:
      nextOutcomes.length === 0
        ? null
        : `次戦で動く組み合わせ：${nextOutcomes
            .map(
              (next) =>
                `${names[0]}${next.focusRank}位・${names[1]}${next.rivalRank}位なら${
                  next.relation === "tied"
                    ? "同率"
                    : `${next.relation === "ahead" ? names[0] : names[1]}が上`
                }`,
            )
            .join("、")}`,
    marker,
    beyondRange:
      event !== null && event > limit
        ? `順番が入れ替わるのは${event}戦後で、図の範囲より先です。`
        : null,
  };
}

const hundredths = (value: number) => (value / 100).toFixed(2);

/** The strict requirement as the 0.01 value a person can set, or why there is none. */
export function outlookRequirementText(required: RequiredMean, rivalName: string) {
  if (required.maximumHundredths !== null) return `${hundredths(required.maximumHundredths)}位以下`;
  return required.kind === "precision-impossible"
    ? "入力できる細かさでは指定できません"
    : `${rivalName}がこの平均なら届きません`;
}

export type OutlookGoalAnswer = Readonly<{
  /** The focus person leads now, so the goal is to stay ahead. */
  ahead: boolean;
  required: RequiredMean;
  /** The current assumption already strictly meets the goal. */
  reaches: boolean;
  answer: string;
  /** The answer in a few words, for the narrow-screen strip. */
  short: string;
  /** The best 0.01 mean to try, offered only when the current assumption does not reach. */
  apply: Readonly<{ hundredths: number; label: string }> | null;
  premise: string;
  margin: string | null;
  /** What to review before the next game, at most two, most specific first. */
  perspectives: readonly string[];
}>;

/** 「目標の戦数で上回るには」: the strict requirement and what it means for the focus person. */
export function outlookGoalAnswer({
  cumulative,
  pair,
  recent,
  focusSource,
  goalHorizon,
  names,
  recentGames,
}: {
  cumulative: CumulativePair;
  pair: Pair;
  recent: Pair;
  focusSource: OutlookSource;
  goalHorizon: number;
  names: Names;
  recentGames: number;
}): OutlookGoalAnswer {
  const [focus, rival] = pair;
  const ahead = cumulative.focusRankSum < cumulative.rivalRankSum;
  const required = requiredMean(cumulative, rival, goalHorizon);
  const maximum = required.maximumHundredths;
  const reaches =
    outlookMeetsGoal(focus, required.threshold) && areDistributionsCompatible(focus, rival);
  const recentMean = distributionMean(recent[0]);
  const recentWithin = compareRationals(recentMean, required.threshold) < 0;
  const recentCompatible = areDistributionsCompatible(recent[0], rival);
  const improvement: Rational | null =
    maximum === null ? null : subtractRationals(recentMean, rational(BigInt(maximum), 100n));
  const answer = reaches
    ? `今の平均 ${outlookAverage(distributionMean(focus))}位で${ahead ? "先行を保てます" : "上回れます"}`
    : maximum === null
      ? required.kind === "precision-impossible"
        ? "入力できる細かさでは指定できません"
        : `${names[1]}がこの平均なら届きません`
      : `平均 ${hundredths(maximum)}位以下`;
  return {
    ahead,
    required,
    reaches,
    answer,
    short: reaches
      ? "今の平均で届く"
      : maximum === null
        ? "届かない条件"
        : `平均${hundredths(maximum)}位以下`,
    apply:
      !reaches && maximum !== null
        ? { hundredths: maximum, label: `${names[0]}を ${hundredths(maximum)}位で試す` }
        : null,
    premise: `${names[1]}が${outlookAverage(distributionMean(rival))}位を続ける前提`,
    margin:
      reaches && maximum !== null
        ? `必要なのは ${hundredths(maximum)}位以下`
        : recentWithin && !recentCompatible
          ? "平均は届くが内訳の見直しが必要"
          : improvement !== null && improvement.numerator > 0n
            ? `直近${recentGames}戦から${formatRational(improvement, 2)}の改善`
            : null,
    perspectives: outlookReviewPerspectives({
      focus,
      recentFocus: recent[0],
      focusSource,
      recentWithin,
      recentCompatible,
    }),
  };
}

/**
 * Review perspectives from the requirement's decision table. A tried past example names the
 * concrete change (fewer low finishes first, then more wins); otherwise the recent results decide
 * whether to keep them, rebalance them, or improve.
 */
export function outlookReviewPerspectives({
  focus,
  recentFocus,
  focusSource,
  recentWithin,
  recentCompatible,
}: {
  focus: RankDistribution;
  recentFocus: RankDistribution;
  focusSource: OutlookSource;
  recentWithin: boolean;
  recentCompatible: boolean;
}): readonly string[] {
  if (focusSource.kind === "example") {
    const fewerLowerRanks =
      (focus.weights[2] + focus.weights[3]) * recentFocus.denominator <
      (recentFocus.weights[2] + recentFocus.weights[3]) * focus.denominator;
    const moreWins =
      focus.weights[0] * recentFocus.denominator > recentFocus.weights[0] * focus.denominator;
    const concrete = [
      fewerLowerRanks ? "下位だった試合で、共通する展開を確かめる" : null,
      moreWins ? "勝ち切れなかった試合で、見直せる点を探す" : null,
    ].filter((value): value is string => value !== null);
    if (concrete.length > 0) return concrete;
  }
  if (recentWithin)
    return recentCompatible ? ["成績を保てた試合を振り返る"] : ["内訳を見直す手掛かりを探す"];
  return ["改善の手掛かりを探す"];
}

/** The same-length personal best, its absence, or its loading state; failures show a retry. */
export function outlookBestRecord(
  goalHorizon: number,
  historical: OutlookHistoricalWindow | undefined,
  failed: boolean,
): string | null {
  if (historical?.window)
    return `連続${goalHorizon}戦の自己ベスト ${historical.window.averageRank.toFixed(2)}位（${outlookMonthRange(historical.window.period)}）`;
  if (historical?.status === "insufficient") return `連続${goalHorizon}戦の記録はまだありません`;
  return failed ? null : "自己ベストを読み込み中";
}

export type OutlookDetailRow = Readonly<{
  h: number;
  goal: boolean;
  focusAverage: Rational;
  rivalAverage: Rational;
  gap: Rational;
  exampleGaps: readonly Rational[];
  required: RequiredMean | null;
}>;

/**
 * The rows that stand in for both graphs: now, 10, 20, 50, 100 games and the goal, including a
 * goal after the graph's 200 games.
 */
export function outlookDetailRows({
  cumulative,
  pair,
  goalHorizon,
  exampleGapsAt,
}: {
  cumulative: CumulativePair;
  pair: Pair;
  goalHorizon: number;
  exampleGapsAt: (h: number) => readonly Rational[];
}): readonly OutlookDetailRow[] {
  return [...new Set([0, 10, 20, 50, 100, goalHorizon])]
    .toSorted((a, b) => a - b)
    .map((h) => {
      const projected = projectOutlook(cumulative, pair[0], pair[1], h);
      return {
        h,
        goal: h === goalHorizon,
        focusAverage: projected.focusAverage,
        rivalAverage: projected.rivalAverage,
        gap: projected.gap,
        exampleGaps: h === 0 ? [] : exampleGapsAt(h),
        required: h === 0 ? null : requiredMean(cumulative, pair[1], h),
      };
    });
}

export type OutlookGoalExampleList =
  | Readonly<{ kind: "unread" }>
  | Readonly<{ kind: "insufficient" }>
  /** No assumption at all reaches this goal, so no record can. */
  | Readonly<{ kind: "unreachable" }>
  | Readonly<{ kind: "none" }>
  /** Records reach the goal but every one conflicts with the rival's assumption. */
  | Readonly<{ kind: "incompatible" }>
  | Readonly<{ kind: "examples"; examples: readonly HistoricalOutlookExample[] }>;

/**
 * Up to three stored 20-game types, in their stored order, whose exact mean is strictly below the
 * goal's boundary and that can share games with the rival's assumption.
 */
export function outlookGoalExampleList(
  data: OutlookExamplesData | undefined,
  required: RequiredMean,
  rival: RankDistribution,
): OutlookGoalExampleList {
  if (required.kind === "impossible") return { kind: "unreachable" };
  if (!data) return { kind: "unread" };
  if (data.examples.status === "insufficient") return { kind: "insufficient" };
  const examples: HistoricalOutlookExample[] = [];
  let qualifying = false;
  for (const example of data.examples.types) {
    const distribution = distributionFromCounts(example.rankCounts);
    if (!outlookMeetsGoal(distribution, required.threshold)) continue;
    qualifying = true;
    if (areDistributionsCompatible(distribution, rival)) examples.push(example);
    if (examples.length === 3) break;
  }
  if (examples.length > 0) return { kind: "examples", examples };
  return { kind: qualifying ? "incompatible" : "none" };
}
