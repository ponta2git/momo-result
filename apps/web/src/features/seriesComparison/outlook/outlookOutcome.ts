import { outlookCrossings } from "@/features/seriesComparison/outlook/calculation";
import type {
  CumulativePair,
  RankDistribution,
} from "@/features/seriesComparison/outlook/calculation";

type Pair = readonly [RankDistribution, RankDistribution];
type Names = readonly [string, string];
type Crossing = ReturnType<typeof outlookCrossings>;

export type OutlookOutcome = {
  headline: string;
  detail: string | null;
  eventHorizon: bigint | null;
  eventLabel: string;
  crossing: Crossing;
};

/** The main event is the first strict lead; an integer tie remains a separate fact. */
export function outlookOutcome(
  cumulative: CumulativePair,
  distributions: Pair,
  names: Names,
): OutlookOutcome {
  const crossing = outlookCrossings(cumulative, distributions[0], distributions[1]);
  const eventHorizon =
    crossing.current === "ahead"
      ? crossing.rivalAhead
      : crossing.current === "behind"
        ? crossing.focusAhead
        : (crossing.focusAhead ?? crossing.rivalAhead);
  if (eventHorizon === null)
    return {
      headline:
        crossing.current === "tied"
          ? "同率が続きます"
          : `${names[crossing.current === "ahead" ? 0 : 1]}の先行が続きます`,
      detail: null,
      eventHorizon: null,
      eventLabel: "",
      crossing,
    };
  const leader =
    crossing.current === "ahead" || (crossing.current === "tied" && crossing.focusAhead === null)
      ? names[1]
      : names[0];
  return {
    headline: `${eventHorizon}戦後に${leader}が上回ります`,
    detail:
      crossing.exactTie === null
        ? null
        : crossing.exactTie === 0n
          ? "現在は同率"
          : `${crossing.exactTie}戦後は同率`,
    eventHorizon,
    eventLabel: `${leader}が上回る`,
    crossing,
  };
}

/** Compare arrival states directly: no arrival is not an infinite number of games. */
export function compareOutlookOutcomes(
  cumulative: CumulativePair,
  beforePair: Pair,
  afterPair: Pair,
  names: Names,
): string {
  const before = outlookCrossings(cumulative, beforePair[0], beforePair[1]);
  const after = outlookCrossings(cumulative, afterPair[0], afterPair[1]);
  if (before.current === "behind") {
    const previous = before.focusAhead;
    const next = after.focusAhead;
    if (previous === null && next === null) return `どちらの条件でも${names[1]}の先行が続きます`;
    if (previous === null) return `この条件なら${names[0]}が上回れます`;
    if (next === null) return `この条件では${names[0]}が上回れなくなります`;
    if (next === previous) return "逆転する戦数は同じです";
    return next < previous
      ? `逆転が${previous - next}戦早まります`
      : `逆転が${next - previous}戦遅くなります`;
  }
  if (before.current === "ahead") {
    const previous = before.rivalAhead;
    const next = after.rivalAhead;
    if (previous === null && next === null) return `どちらの条件でも${names[0]}の先行が続きます`;
    if (next === null) return `この条件なら${names[0]}の先行が続きます`;
    if (previous === null) return `この条件では${names[1]}が上回るようになります`;
    if (next === previous) return "上回られる戦数は同じです";
    // The first loss, rather than the possible preceding tie, defines this duration.
    return next > previous
      ? `${names[1]}に上回られる時点が${next - previous}戦遅くなります`
      : `${names[1]}に上回られる時点が${previous - next}戦早まります`;
  }
  const previous = before.focusAhead === null ? (before.rivalAhead === null ? null : 1) : 0;
  const next = after.focusAhead === null ? (after.rivalAhead === null ? null : 1) : 0;
  if (previous === next)
    return next === null
      ? "どちらの条件でも同率が続きます"
      : `どちらの条件でも${names[next]}が上回ります`;
  if (next === null) return "同率が続く条件に変わります";
  if (previous === null) return `${names[next]}が上回る条件に変わります`;
  return `上回る人が${names[previous]}から${names[next]}に変わります`;
}
