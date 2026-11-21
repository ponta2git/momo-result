import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useParams } from "react-router-dom";

import { buildHeldEventDetailView } from "@/features/heldEvents/detail/heldEventDetailPresentation";
import type { HeldEventDetailView } from "@/features/heldEvents/detail/heldEventDetailPresentation";
import { completionCheckOptions, useUserRefresh } from "@/shared/api/completionCheck";
import { readDetailQuery } from "@/shared/api/detailReadResult";
import { getHeldEventDraftStatuses } from "@/shared/api/heldEvents";
import type { HeldEventDraftStatusResponse } from "@/shared/api/heldEvents";
import { shouldShowQueryError } from "@/shared/api/queryErrorState";
import { heldEventKeys } from "@/shared/api/queryKeys";
import { heldEventRouteDetailQueryOptions } from "@/shared/api/queryOptions";
import { loadResourceReadResult } from "@/shared/api/resourceReadResult";
import { runningOcrReadsWait } from "@/shared/domain/draftStatus";
import { useRetryNotice } from "@/shared/lib/useRetryNotice";

/** Composes the route's read owner with the pure detail presentation. */
export function useHeldEventDetail(): HeldEventDetailView {
  const { heldEventId = "", publicId } = useParams<{ heldEventId: string; publicId: string }>();
  const read = useHeldEventDetailRead(heldEventId, publicId);
  return buildHeldEventDetailView({ heldEventId: publicId ?? heldEventId, ...read });
}

function sameDraftStatuses(
  displayed: readonly HeldEventDraftStatusResponse[],
  current: readonly HeldEventDraftStatusResponse[],
) {
  if (displayed.length !== current.length) return false;
  const byId = new Map(displayed.map((draft) => [draft.matchDraftId, draft.status]));
  return current.every((draft) => byId.get(draft.matchDraftId) === draft.status);
}

function useHeldEventDetailRead(heldEventId: string, publicId?: string) {
  const options = heldEventRouteDetailQueryOptions(heldEventId, publicId);
  const query = useQuery(options);
  const result = readDetailQuery(query);
  const wait = runningOcrReadsWait(result.detail?.drafts ?? []);
  const checking = query.isSuccess && wait !== undefined;
  const checkedId = checking ? result.detail?.id : undefined;
  const [attempt, setAttempt] = useState(0);
  const completion = useQuery({
    queryKey: heldEventKeys.ocrCompletion(options.queryKey, checkedId, attempt),
    enabled: checkedId !== undefined,
    // The first detail already describes the wait. Check on the shared timer, including after
    // a manual refresh, rather than sending a redundant request as soon as the screen opens.
    initialData: null,
    staleTime: "static",
    gcTime: 0,
    retry: false,
    ...completionCheckOptions(() => wait),
    queryFn: async ({ client, signal }) => {
      const baseline = client.getQueryState(options.queryKey);
      const displayed = baseline?.data;
      if (!checkedId || displayed?.kind !== "found" || displayed.detail.id !== checkedId)
        return null;
      const statuses = await loadResourceReadResult(() =>
        getHeldEventDraftStatuses(checkedId, { signal }),
      );
      // A newer detail, a different route, or an ended session owns its own view.
      if (
        !signal.aborted &&
        client.getQueryState(options.queryKey) === baseline &&
        (statuses.kind === "notFound" ||
          !sameDraftStatuses(displayed.detail.drafts ?? [], statuses.value))
      ) {
        await client.refetchQueries(
          { queryKey: options.queryKey, exact: true, type: "active" },
          { cancelRefetch: false, throwOnError: true },
        );
      }
      return statuses;
    },
  });
  const userRefresh = useUserRefresh(async () => {
    if ((await query.refetch()).isSuccess) setAttempt((previous) => previous + 1);
  });
  const error = result.error ?? (checking ? completion.error : null);
  const pending = userRefresh.pending || query.isPaused || (query.isFetching && !checking);
  const stale = useRetryNotice(
    shouldShowQueryError({ error, isFetching: pending }),
    pending,
    publicId ?? heldEventId,
  );
  return {
    ...result,
    error,
    pending,
    initialPending: query.isPending,
    stale,
    refresh: { disabled: pending, pending, run: userRefresh.run },
  };
}
