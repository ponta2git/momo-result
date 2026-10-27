import type { ListHeldEventsMetric } from "@/shared/api/heldEvents";
import type {
  HeldOrderSort,
  MatchSearchScopeCandidates,
  SearchRange,
} from "@/shared/matches/matchSearchConditions";
import type { AppliedCondition } from "@/shared/ui/forms/AppliedConditionChips";

export type HeldEventListMetric = ListHeldEventsMetric;

/** One "who / which metric / how much" condition; `memberId` empty means any of the four players. */
export type HeldEventListMetricCondition = Readonly<{
  memberId: string;
  metric: HeldEventListMetric | "";
  range: SearchRange;
  value: string;
}>;

/** URL-owned search. `minMatchCount` 0 means no lower bound. */
export type HeldEventListSearch = Readonly<{
  from: string;
  gameTitleId: string;
  mapMasterId: string;
  metric: HeldEventListMetricCondition;
  minMatchCount: number;
  page: number;
  pageSize: number;
  q: string;
  seasonMasterId: string;
  sort: HeldOrderSort;
  to: string;
}>;

export type HeldEventListConditionKey =
  | "gameTitle"
  | "season"
  | "map"
  | "period"
  | "matchCount"
  | "memo"
  | "metric";

export type HeldEventListAppliedCondition = AppliedCondition<HeldEventListConditionKey>;

export type HeldEventListFilterChange =
  | { kind: "sort"; sort: HeldOrderSort }
  | { kind: "gameTitle"; gameTitleId: string }
  | { kind: "season"; seasonMasterId: string }
  | { kind: "map"; mapMasterId: string }
  | { kind: "period"; from: string; to: string }
  | { kind: "matchCount"; minMatchCount: number }
  | { kind: "memo"; q: string }
  | { kind: "metric"; metric: HeldEventListMetricCondition }
  | { kind: "conditions"; search: HeldEventListSearch }
  | { kind: "removeCondition"; condition: HeldEventListConditionKey };

export type HeldEventListFilterActions = {
  onChange: (change: HeldEventListFilterChange) => void;
  onClear: () => void;
};

export type HeldEventListFilterCandidates = MatchSearchScopeCandidates;
