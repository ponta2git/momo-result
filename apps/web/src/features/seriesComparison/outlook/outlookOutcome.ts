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
