import {
  distributionMean,
  distributionsEqual,
  exactWholeCounts,
  outlookCrossings,
} from "@/features/seriesComparison/model/outlook";
import type {
  CumulativePair,
  RankDistribution,
  Rational,
} from "@/features/seriesComparison/model/outlook";
import { RANK_INDICES } from "@/features/seriesComparison/model/outlook/distribution";
import { outlookAverage } from "@/features/seriesComparison/outlook/outlookPresentation";
import type {
  OutlookSession,
  OutlookSource,
} from "@/features/seriesComparison/outlook/outlookSession";

type Pair = NonNullable<OutlookSession["comparisonBefore"]>;
type Names = readonly [string, string];

function changeDescription(
  before: RankDistribution,
  after: RankDistribution,
  source: OutlookSource,
): string {
  if (source.kind === "recent") return "直近の成績に戻す";
  if (source.kind === "example") return "過去の成績例を適用";
  if (source.kind === "average") return "平均を変更";
  const previous = exactWholeCounts(before);
  if (!previous) return "整数化して回数を調整";
  const current = exactWholeCounts(after);
  if (current) {
    const changes = RANK_INDICES.map((rank) => ({
      rank,
      difference: current[rank] - previous[rank],
    })).filter((change) => change.difference !== 0);
    const [first, second] = changes;
    if (changes.length === 2 && first && second) {
      const gain = first.difference > 0 ? first : second;
      const lose = first.difference < 0 ? first : second;
      return `${lose.rank + 1}位から${gain.rank + 1}位へ${gain.difference}回移す（20戦あたり）`;
    }
  }
  return "回数を調整";
}

function arrivalText(cumulative: CumulativePair, pair: Pair, names: Names): string {
  const crossing = outlookCrossings(cumulative, pair[0].distribution, pair[1].distribution);
  if (crossing.current === "ahead")
    return crossing.rivalAhead === null
      ? `${names[0]}の先行が続く`
      : `${crossing.rivalAhead}戦後に${names[1]}が上回る`;
  if (crossing.focusAhead !== null) return `${crossing.focusAhead}戦後に${names[0]}が上回る`;
  if (crossing.current === "tied")
    return crossing.rivalAhead === null
      ? "同率が続く"
      : `${crossing.rivalAhead}戦後に${names[1]}が上回る`;
  return `${names[1]}の先行が続く`;
}

function comparison(
  before: Pair | undefined,
  after: Pair,
  cumulative: CumulativePair,
  names: Names,
) {
  if (!before) return null;
  const changes = ([0, 1] as const)
    .filter((role) => !distributionsEqual(before[role].distribution, after[role].distribution))
    .map((role) => ({
      role,
      description: `${names[role]}：${changeDescription(before[role].distribution, after[role].distribution, after[role].source)}`,
      average: `これからの平均：${outlookAverage(distributionMean(before[role].distribution))}位 → ${outlookAverage(distributionMean(after[role].distribution))}位`,
    }));
  if (changes.length === 0) return null;
  return {
    before,
    after,
    changes,
    beforeArrival: arrivalText(cumulative, before, names),
    afterArrival: arrivalText(cumulative, after, names),
  };
}

export function outlookGapText(gap: Rational, names: Names): string {
  if (gap.numerator === 0n) return "同率（差0）";
  const absolute = {
    numerator: gap.numerator < 0n ? -gap.numerator : gap.numerator,
    denominator: gap.denominator,
  };
  const difference =
    absolute.numerator * 10000n < absolute.denominator
      ? "0.0001位未満"
      : `${outlookAverage(absolute)}位`;
  return `${difference}（${gap.numerator > 0n ? names[0] : names[1]}が上）`;
}

export function getOutlookComparison({
  session,
  cumulative,
  names,
}: {
  session: OutlookSession;
  cumulative: CumulativePair;
  names: Names;
}) {
  // Announcements retain the completed change while visible values follow a gesture.
  const committed = comparison(
    session.comparisonBefore,
    session.gesture?.before ?? session.entries,
    cumulative,
    names,
  );
  const pending = session.gesture
    ? comparison(session.gesture.before, session.entries, cumulative, names)
    : null;
  return {
    visible: pending ?? committed,
    announcement: committed
      ? `${committed.changes.map((change) => `${change.description}。${change.average}。`).join(" ")}この成績が続くと、${committed.afterArrival}。`
      : "",
  };
}

export type OutlookComparison = ReturnType<typeof getOutlookComparison>["visible"];
