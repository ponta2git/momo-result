import type { ConfirmMatchRequest } from "@/features/draftReview/schema";
import type { MatchFormValues } from "@/features/matches/workspace/matchFormTypes";
import type { components } from "@/shared/api/generated";

export type MatchConfirmRequest = ConfirmMatchRequest;
export type MatchUpdateRequest = components["schemas"]["UpdateMatchRequest"];

function toIsoFromLocal(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function pruneDraftIds(values: MatchFormValues["draftIds"]): MatchConfirmRequest["draftIds"] {
  const next: MatchConfirmRequest["draftIds"] = {};
  if (values.incidentLog) next.incidentLog = values.incidentLog;
  if (values.revenue) next.revenue = values.revenue;
  if (values.totalAssets) next.totalAssets = values.totalAssets;
  return next;
}

export function toConfirmMatchRequest(values: MatchFormValues): MatchConfirmRequest {
  return {
    draftIds: pruneDraftIds(values.draftIds),
    gameTitleId: values.gameTitleId,
    heldEventId: values.heldEventId,
    mapMasterId: values.mapMasterId,
    matchNoInEvent: values.matchNoInEvent,
    ownerMemberId: values.ownerMemberId,
    playedAt: toIsoFromLocal(values.playedAt),
    players: values.players,
    seasonMasterId: values.seasonMasterId,
  };
}

export function toUpdateMatchRequest(values: MatchFormValues): MatchUpdateRequest {
  return toConfirmMatchRequest(values);
}
