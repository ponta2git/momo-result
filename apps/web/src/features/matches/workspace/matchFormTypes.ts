import type { ConfirmMatchFormValues } from "@/features/matches/workspace/review/confirmMatchFormSchema";
import type { components } from "@/shared/api/generated";
import { emptyIncidentCountsByKey, incidentColumns } from "@/shared/domain/incidents";
import type { IncidentKey, IncidentLabel } from "@/shared/domain/incidents";
import { fixedMembers } from "@/shared/domain/members";
import type { SlotMap } from "@/shared/lib/slotMap";

export { incidentColumns };
export type { IncidentKey, IncidentLabel };
export type ReviewIncidentCounts = Record<IncidentLabel, number>;

export type DraftByKind = SlotMap<components["schemas"]["OcrDraftResponse"]>;

export type IncidentLookupEntry = {
  confidence: Partial<Record<IncidentLabel, number | null>>;
  counts: ReviewIncidentCounts;
};

export type OriginalPlayerSnapshot = {
  confidence: {
    incidents: Partial<Record<IncidentLabel, number | null>>;
    rank?: number | null;
    revenue?: number | null;
    totalAssets?: number | null;
  };
  incidents: ReviewIncidentCounts;
  memberId: string;
  playOrder: number;
  rank: number;
  rawPlayerName?: string | undefined;
  revenueManYen: number;
  totalAssetsManYen: number;
  warnings: string[];
};

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
  originalPlayers: OriginalPlayerSnapshot[];
  warnings: string[];
};

export const emptyIncidents = (): Record<IncidentKey, number> => ({
  ...emptyIncidentCountsByKey(),
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
