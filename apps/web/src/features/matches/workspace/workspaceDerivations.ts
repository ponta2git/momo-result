import type { OcrDraftResponse } from "@/features/draftReview/api";
import type { MatchDraftDetailResponse } from "@/features/matches/workspace/api";
import type {
  MatchDraftSummary,
  MatchFormValues,
} from "@/features/matches/workspace/matchFormTypes";
import { slotKinds } from "@/shared/api/enums";
import { bySlot } from "@/shared/lib/slotMap";
import type { SlotMap } from "@/shared/lib/slotMap";

export function draftIdsFromParams(searchParams: URLSearchParams): SlotMap<string> {
  return bySlot([
    ["total_assets", searchParams.get("totalAssets")],
    ["revenue", searchParams.get("revenue")],
    ["incident_log", searchParams.get("incidentLog")],
  ]);
}

export function draftsByKind(
  ids: SlotMap<string>,
  drafts: OcrDraftResponse[] | undefined,
): SlotMap<OcrDraftResponse> {
  const byId = new Map((drafts ?? []).map((draft) => [draft.draftId, draft]));
  return bySlot(slotKinds.map((kind) => [kind, ids[kind] ? byId.get(ids[kind]) : undefined]));
}

export function draftIdsFromDetail(
  detail: MatchDraftDetailResponse | undefined,
): SlotMap<string> {
  if (!detail) {
    return {};
  }
  return bySlot([
    ["total_assets", detail.totalAssetsDraftId],
    ["revenue", detail.revenueDraftId],
    ["incident_log", detail.incidentLogDraftId],
  ]);
}

export function toIsoFromLocal(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

/**
 * `<input type="datetime-local">` 用に、現在のローカル時刻を `YYYY-MM-DDTHH:mm` 形式で返す。
 * `useEffect` で初期化しないで済むよう、純粋関数として分離。
 */
export function currentLocalIsoMinute(now: Date = new Date()): string {
  const offsetMs = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offsetMs).toISOString().slice(0, 16);
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
