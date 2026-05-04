import type { HeldEventResponse } from "@/features/draftReview/api";
import type { DraftStatus } from "@/features/matches/draftStatus";
import type { MatchSummaryResponse } from "@/features/matches/api";
import type {
  GameTitleResponse,
  MapMasterResponse,
  SeasonMasterResponse,
} from "@/shared/api/masters";

export type MatchListStatus = DraftStatus;

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
  seasonMasterId: string;
  sort: MatchListSort;
  status: MatchListStatusFilter;
};

export type MatchListAction = {
  disabled?: boolean;
  href?: string;
  label: string;
  variant?: "primary" | "quiet" | "secondary";
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
  statusLabel: "OCR中" | "確定前" | "確定済";
  updatedAt: string;
};

export type MatchListSummaryCounts = {
  incompleteCount: number;
  needsReviewCount: number;
  ocrRunningCount: number;
};

export type MatchListLookupMaps = {
  gameTitlesById: Map<string, GameTitleResponse>;
  heldEventsById: Map<string, HeldEventResponse>;
  mapsById: Map<string, MapMasterResponse>;
  seasonsById: Map<string, SeasonMasterResponse>;
};

export type MatchListSourceItem = MatchSummaryResponse;
