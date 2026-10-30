import type { HeldEventResponse } from "@/shared/api/heldEvents";
import type { ListMatchesQuery, MatchSummaryResponse } from "@/shared/api/matches";
import type { PaginationState } from "@/shared/lib/pagination";
import type {
  HeldOrderSort,
  MatchSearchScopeCandidates,
} from "@/shared/matches/matchSearchConditions";
import type { AppliedCondition } from "@/shared/ui/forms/AppliedConditionChips";

export type MatchListSort = HeldOrderSort;

export type MatchListRecord = NonNullable<ListMatchesQuery["record"]>;

export type MatchListRecordRange = NonNullable<ListMatchesQuery["recordRange"]>;

/** One "who / what / how much" condition; `memberId` empty means any of the four players. */
export type MatchListRecordCondition = Readonly<{
  memberId: string;
  record: MatchListRecord | "";
  range: MatchListRecordRange;
  value: string;
}>;

/** URL-owned search. Text-like values keep the user's canonical string until the API query. */
export type MatchListSearch = Readonly<{
  cursor: string;
  from: string;
  gameTitleId: string;
  heldEventId: string;
  mapMasterId: string;
  pageSize: number;
  q: string;
  record: MatchListRecordCondition;
  seasonMasterId: string;
  sort: MatchListSort;
  to: string;
}>;

export type MatchListFilterChange =
  | { kind: "sort"; sort: MatchListSort }
  | { kind: "gameTitle"; gameTitleId: string }
  | { kind: "season"; seasonMasterId: string }
  | { kind: "map"; mapMasterId: string }
  | { kind: "heldEvent"; heldEventId: string }
  | { kind: "period"; from: string; to: string }
  | { kind: "memo"; q: string }
  | { kind: "record"; record: MatchListRecordCondition }
  | { kind: "conditions"; search: MatchListSearch }
  | { kind: "removeCondition"; condition: MatchListConditionKey };

export type MatchListConditionKey =
  | "gameTitle"
  | "season"
  | "map"
  | "heldEvent"
  | "period"
  | "memo"
  | "record";

export type MatchListAppliedCondition = AppliedCondition<MatchListConditionKey>;

export type MatchListFilterActions = {
  onChange: (change: MatchListFilterChange) => void;
  onClear: () => void;
};

export type MatchListFilterCandidates = MatchSearchScopeCandidates & {
  heldEvents: HeldEventResponse[];
  heldEventPicker?: {
    error?: string | undefined;
    heldEvents: HeldEventResponse[];
    pagination?: PaginationState | undefined;
    pending: boolean;
    scopeChanging: boolean;
    selectedHeldEvent?: HeldEventResponse | undefined;
    onPageChange: (page: number) => void;
  };
};

export type MatchListItemView = {
  detailHref: string;
  exportHref: string;
  gameSeasonLabel: string;
  heldAt?: string;
  id: string;
  mapName: string;
  matchNoLabel: string;
  noteBody?: string;
  ranks: Array<{ displayName: string; memberId: string; rank: number }>;
};

export type MatchListSourceItem = MatchSummaryResponse;
