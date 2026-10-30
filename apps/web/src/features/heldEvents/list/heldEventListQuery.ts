import {
  isCompleteHeldEventListMetric,
  parseHeldEventListMetricValue,
} from "@/features/heldEvents/list/heldEventListConditions";
import type { HeldEventListSearch } from "@/features/heldEvents/list/heldEventListTypes";
import type { ListHeldEventsQuery } from "@/shared/api/heldEvents";
import { compact } from "@/shared/lib/compact";

/** The default sort stays implicit so the unconditioned read keeps its established request. */
export function buildHeldEventListApiQuery(search: HeldEventListSearch): ListHeldEventsQuery {
  const metric = isCompleteHeldEventListMetric(search.metric) ? search.metric : undefined;
  return compact({
    page: search.page,
    pageSize: search.pageSize,
    sort: search.sort === "held_desc" ? undefined : search.sort,
    gameTitleId: search.gameTitleId || undefined,
    seasonMasterId: search.seasonMasterId || undefined,
    mapMasterId: search.mapMasterId || undefined,
    from: search.from || undefined,
    to: search.to || undefined,
    minMatchCount: search.minMatchCount > 0 ? search.minMatchCount : undefined,
    q: search.q || undefined,
    memberId: metric?.memberId || undefined,
    metric: metric?.metric,
    metricValue: metric ? parseHeldEventListMetricValue(metric.metric, metric.value) : undefined,
    metricRange: metric?.range,
  });
}
