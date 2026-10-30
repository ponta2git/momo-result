import {
  isCompleteMatchListRecord,
  parseMatchListRecordValue,
} from "@/features/matches/list/matchListConditions";
import type { MatchListSearch } from "@/features/matches/list/matchListTypes";
import type { ListMatchesQuery } from "@/shared/api/matches";
import { compact } from "@/shared/lib/compact";

export function buildMatchListApiQuery(search: MatchListSearch): ListMatchesQuery {
  const record = isCompleteMatchListRecord(search.record) ? search.record : undefined;
  return compact({
    kind: "match" as const,
    status: "confirmed" as const,
    gameTitleId: search.gameTitleId || undefined,
    seasonMasterId: search.seasonMasterId || undefined,
    mapMasterId: search.mapMasterId || undefined,
    heldEventId: search.heldEventId || undefined,
    from: search.from || undefined,
    to: search.to || undefined,
    q: search.q || undefined,
    memberId: record?.memberId || undefined,
    record: record?.record,
    recordValue: record ? parseMatchListRecordValue(record.record, record.value) : undefined,
    recordRange: record?.range,
    cursor: search.cursor || undefined,
    pageSize: search.pageSize,
    sort: search.sort,
  });
}
