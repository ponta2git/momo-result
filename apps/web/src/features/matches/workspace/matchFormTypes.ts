import type {
  DraftByKind,
  IncidentLookupEntry,
  ReviewPlayer,
} from "@/features/draftReview/mergeDrafts";
import type { ConfirmMatchFormValues } from "@/features/draftReview/schema";
import { fixedMembers } from "@/features/ocrCapture/localMasters";

export const incidentColumns = [
  ["destination", "目的地"],
  ["plusStation", "プラス駅"],
  ["minusStation", "マイナス駅"],
  ["cardStation", "カード駅"],
  ["cardShop", "カード売り場"],
  ["suriNoGinji", "スリの銀次"],
] as const;

export type IncidentKey = (typeof incidentColumns)[number][0];
export type IncidentLabel = (typeof incidentColumns)[number][1];

export type MatchDraftSummary = {
  status: string;
  heldEventId?: string;
  matchNoInEvent?: number;
  gameTitleId?: string;
  seasonMasterId?: string;
  ownerMemberId?: string;
  mapMasterId?: string;
  playedAt?: string;
  totalAssetsDraftId?: string;
  revenueDraftId?: string;
  incidentLogDraftId?: string;
};

export type WorkspaceMode = "review" | "create" | "edit";

export type MatchFormValues = ConfirmMatchFormValues & {
  matchDraftId?: string;
};

export type MatchWorkspaceInitialData = {
  draftByKind: DraftByKind;
  incidentByPlayOrder: Map<number, IncidentLookupEntry>;
  originalPlayers: ReviewPlayer[];
  warnings: string[];
};

export const emptyIncidents = (): Record<IncidentKey, number> => ({
  cardShop: 0,
  cardStation: 0,
  destination: 0,
  minusStation: 0,
  plusStation: 0,
  suriNoGinji: 0,
});

export function emptyPlayers(): MatchFormValues["players"] {
  return fixedMembers.map((member, index) => ({
    incidents: emptyIncidents(),
    memberId: member.memberId,
    playOrder: index + 1,
    rank: index + 1,
    revenueManYen: 0,
    totalAssetsManYen: 0,
  }));
}

export function createEmptyMatchForm(nowIso: string): MatchFormValues {
  return {
    draftIds: {},
    gameTitleId: "",
    heldEventId: "",
    mapMasterId: "",
    matchNoInEvent: 1,
    ownerMemberId: fixedMembers[0]?.memberId ?? "member_ponta",
    playedAt: nowIso,
    players: emptyPlayers(),
    seasonMasterId: "",
  };
}
