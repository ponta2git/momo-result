import type {
  MatchDraftSummary,
  MatchFormValues,
} from "@/features/matches/workspace/matchFormTypes";
import { slotKinds } from "@/shared/api/enums";
import type { MatchDraftDetailResponse } from "@/shared/api/matchDrafts";
import type { OcrDraftResponse } from "@/shared/api/ocrDrafts";
import type { NormalizedApiError } from "@/shared/api/problemDetails";
import { trimSearchParam } from "@/shared/lib/searchParams";
import { bySlot } from "@/shared/lib/slotMap";
import type { SlotMap } from "@/shared/lib/slotMap";

export function draftIdsFromParams(searchParams: URLSearchParams): SlotMap<string> {
  return bySlot([
    ["total_assets", trimSearchParam(searchParams.get("totalAssets"))],
    ["revenue", trimSearchParam(searchParams.get("revenue"))],
    ["incident_log", trimSearchParam(searchParams.get("incidentLog"))],
  ]);
}

export function draftsByKind(
  ids: SlotMap<string>,
  drafts: OcrDraftResponse[] | undefined,
): SlotMap<OcrDraftResponse> {
  const byId = new Map((drafts ?? []).map((draft) => [draft.draftId, draft]));
  return bySlot(slotKinds.map((kind) => [kind, ids[kind] ? byId.get(ids[kind]) : undefined]));
}

export function draftIdsFromDetail(detail: MatchDraftDetailResponse | undefined): SlotMap<string> {
  if (!detail) {
    return {};
  }
  return bySlot([
    ["total_assets", detail.totalAssetsDraftId],
    ["revenue", detail.revenueDraftId],
    ["incident_log", detail.incidentLogDraftId],
  ]);
}

export function dedupeWorkspaceErrors(errors: readonly NormalizedApiError[]): NormalizedApiError[] {
  return [
    ...new Map(
      errors.map((error) => [
        `${error.status}\u0000${error.code ?? ""}\u0000${error.title}\u0000${error.detail}`,
        error,
      ]),
    ).values(),
  ];
}

export function prefillFromDraftSummary(
  base: MatchFormValues,
  summary?: MatchDraftSummary,
): MatchFormValues {
  if (!summary) {
    return base;
  }

  return {
    ...base,
    gameTitleId: summary.gameTitleId ?? base.gameTitleId,
    heldEventId: summary.heldEventId ?? base.heldEventId,
    mapMasterId: summary.mapMasterId ?? base.mapMasterId,
    matchNoInEvent: summary.matchNoInEvent ?? base.matchNoInEvent,
    ownerMemberId: (summary.ownerMemberId ??
      base.ownerMemberId) as MatchFormValues["ownerMemberId"],
    playedAt: summary.playedAt ?? base.playedAt,
    seasonMasterId: summary.seasonMasterId ?? base.seasonMasterId,
  };
}
