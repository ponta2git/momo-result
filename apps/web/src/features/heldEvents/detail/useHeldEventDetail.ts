import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";

import { buildHeldEventDetailView } from "@/features/heldEvents/detail/heldEventDetailPresentation";
import type { HeldEventDetailView } from "@/features/heldEvents/detail/heldEventDetailPresentation";
import { completionCheckOptions, useUserRefresh } from "@/shared/api/completionCheck";
import { readDetailQuery } from "@/shared/api/detailReadResult";
import type { HeldEventDetailReadResult } from "@/shared/api/detailReadResult";
import { shouldShowQueryError } from "@/shared/api/queryErrorState";
import { heldEventRouteDetailQueryOptions } from "@/shared/api/queryOptions";
import { runningOcrReadsWait } from "@/shared/domain/draftStatus";
import { useRetryNotice } from "@/shared/lib/useRetryNotice";

/** Composes the route's read owner with the pure detail presentation. */
export function useHeldEventDetail(): HeldEventDetailView {
  const { heldEventId = "", publicId } = useParams<{ heldEventId: string; publicId: string }>();
  const read = useHeldEventDetailRead(heldEventId, publicId);
  return buildHeldEventDetailView({ heldEventId: publicId ?? heldEventId, ...read });
}

/** The hub waits on the OCR reads its drafts show as running; it rechecks itself until they end. */
function runningReadsOf(result: HeldEventDetailReadResult) {
  return result.kind === "found" ? runningOcrReadsWait(result.detail.drafts ?? []) : undefined;
}

function useHeldEventDetailRead(heldEventId: string, publicId?: string) {
  const query = useQuery({
    ...heldEventRouteDetailQueryOptions(heldEventId, publicId),
    ...completionCheckOptions(runningReadsOf),
  });
  const result = readDetailQuery(query);
  const userRefresh = useUserRefresh(query.refetch);
  // While reads are running, the hub's own rechecks stay quiet; neighbors and the update control
  // stay usable, and the running drafts carry the wait.
  const checking = query.data !== undefined && runningReadsOf(query.data) !== undefined;
  const pending = userRefresh.pending || query.isPaused || (query.isFetching && !checking);
  const stale = useRetryNotice(
    shouldShowQueryError({ error: result.error, isFetching: pending }),
    pending,
    publicId ?? heldEventId,
  );
  return {
    ...result,
    pending,
    initialPending: query.isPending,
    stale,
    refresh: { disabled: pending, pending, run: userRefresh.run },
  };
}
