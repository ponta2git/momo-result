import type { HeldEventResponse } from "@/shared/api/heldEvents";
import type {
  GameTitleResponse,
  MapMasterResponse,
  SeasonMasterResponse,
} from "@/shared/api/masters";
import type { MatchSummaryResponse } from "@/shared/api/matches";
import type { DraftStatusLabel, DraftStatusOrUnknown } from "@/shared/domain/draftStatus";
import type { PaginationState } from "@/shared/lib/pagination";

export type MatchListStatus = DraftStatusOrUnknown;

export type MatchListKind = "match" | "match_draft";

export type MatchListStatusFilter =
  | "all"
  | "incomplete"
  | "ocr_running"
  | "pre_confirm"
  | "needs_review"
  | "confirmed";

export type MatchListSort =
  | "status_priority"
  | "updated_desc"
  | "held_desc"
  | "held_asc"
  | "match_no_asc";

export type MatchListSearch = {
  gameTitleId: string;
  heldEventId: string;
  cursor: string;
  pageSize: number;
  seasonMasterId: string;
  sort: MatchListSort;
  status: MatchListStatusFilter;
};

export type MatchListFilterActions = {
  onApply: (nextSearch: MatchListSearch) => void;
  onClear: () => void;
};

export type MatchListFilterCandidates = {
  gameTitles: GameTitleResponse[];
  heldEvents: HeldEventResponse[];
  heldEventPicker?: {
    error?: string | undefined;
    heldEvents: HeldEventResponse[];
    pagination?: PaginationState | undefined;
    pending: boolean;
    selectedHeldEvent?: HeldEventResponse | undefined;
    onPageChange: (page: number) => void;
  };
  seasons: SeasonMasterResponse[];
};

export type MatchListFilterSelectionErrors = {
  gameTitles?: string;
  heldEvents?: string;
  seasons?: string;
};

export type MatchListAction = {
  disabled?: boolean;
  draftStatusCheck?: {
    draftId: string;
  };
  href?: string;
  label: string;
  variant?: "primary" | "quiet" | "secondary";
};

export type MatchListRowActions = {
  checkingDraftIds?: ReadonlySet<string> | undefined;
  disabled?: boolean;
  onDraftStatusCheckAction: (action: MatchListAction) => void;
};

export type MatchListItemView = {
  canCancelOcr: boolean;
  createdAt: string;
  detailHref?: string;
  displayStatus: "confirmed" | "ocr" | "pre_confirm";
  exportHref?: string;
  gameTitleId?: string;
  gameTitleName?: string;
  hasWarnings: boolean;
  hasNote?: boolean;
  heldAt?: string;
  heldEventId?: string;
  id: string;
  kind: MatchListKind;
  mapName?: string;
  matchDraftId?: string;
  matchId?: string;
  matchNoInEvent?: number;
  ownerName?: string;
  primaryAction: MatchListAction;
  ranks: Array<{ displayName: string; memberId: string; rank: number }>;
  reviewHref?: string;
  secondaryActions: MatchListAction[];
  seasonMasterId?: string;
  seasonName?: string;
  status: MatchListStatus;
  statusDescription?: string;
  statusLabel: DraftStatusLabel;
  updatedAt: string;
};

export type MatchListSummaryCounts = {
  incompleteCount: number;
  needsReviewCount: number;
  ocrRunningCount: number;
  preConfirmCount: number;
};

export type MatchListLookupMaps = {
  gameTitlesById: Map<string, GameTitleResponse>;
  heldEventsById: Map<string, HeldEventResponse>;
  mapsById: Map<string, MapMasterResponse>;
  seasonsById: Map<string, SeasonMasterResponse>;
};

export type MatchListSourceItem = MatchSummaryResponse;
