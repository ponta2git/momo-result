import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { useParams } from "react-router-dom";

import { buildHeldEventDetailView } from "@/features/heldEvents/detail/heldEventDetailPresentation";
import type { HeldEventDetailView } from "@/features/heldEvents/detail/heldEventDetailPresentation";
import { readDetailQuery } from "@/shared/api/detailReadResult";
import { shouldShowQueryError } from "@/shared/api/queryErrorState";
import { heldEventDetailQueryOptions } from "@/shared/api/queryOptions";
import { useRetryNotice } from "@/shared/lib/useRetryNotice";

/** Composes the route's read owner with the pure detail presentation. */
export function useHeldEventDetailPageModel(): HeldEventDetailView {
  const { heldEventId = "" } = useParams<{ heldEventId: string }>();
  const read = useHeldEventDetailRead(heldEventId);
  return buildHeldEventDetailView({ heldEventId, ...read });
}

function useHeldEventDetailRead(heldEventId: string) {
  const query = useQuery(heldEventDetailQueryOptions(heldEventId, heldEventId.trim().length > 0));
  const result = readDetailQuery(query);
  const pending = query.isFetching || query.isPaused;
  const stale = useRetryNotice(
    shouldShowQueryError({ error: result.error, isFetching: pending }),
    pending,
    heldEventId,
  );
  const { refetch } = query;
  const refresh = useCallback(() => {
    void refetch();
  }, [refetch]);
  return {
    ...result,
    pending,
    initialPending: query.isPending,
    stale,
    refresh: { disabled: pending, pending, run: refresh },
  };
}
