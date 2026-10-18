import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { useParams } from "react-router-dom";

import { buildHeldEventDetailView } from "@/features/heldEvents/detail/heldEventDetailPresentation";
import type { HeldEventDetailView } from "@/features/heldEvents/detail/heldEventDetailPresentation";
import { readDetailQuery } from "@/shared/api/detailReadResult";
import { shouldShowQueryError } from "@/shared/api/queryErrorState";
import { heldEventRouteDetailQueryOptions } from "@/shared/api/queryOptions";
import { useRetryNotice } from "@/shared/lib/useRetryNotice";

/** Composes the route's read owner with the pure detail presentation. */
export function useHeldEventDetail(): HeldEventDetailView {
  const { heldEventId = "", publicId } = useParams<{ heldEventId: string; publicId: string }>();
  const read = useHeldEventDetailRead(heldEventId, publicId);
  return buildHeldEventDetailView({ heldEventId: publicId ?? heldEventId, ...read });
}

function useHeldEventDetailRead(heldEventId: string, publicId?: string) {
  const query = useQuery(heldEventRouteDetailQueryOptions(heldEventId, publicId));
  const result = readDetailQuery(query);
  const pending = query.isFetching || query.isPaused;
  const stale = useRetryNotice(
    shouldShowQueryError({ error: result.error, isFetching: pending }),
    pending,
    publicId ?? heldEventId,
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
