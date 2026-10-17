import { useCallback, useEffect, useMemo } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";

import {
  changeHeldEventsPagination,
  heldEventsPaginationParams,
  readHeldEventsPagination,
} from "@/features/heldEvents/list/heldEventsListPresentation";
import type { HeldEventsPagination } from "@/features/heldEvents/list/heldEventsListPresentation";
import { useHeldEventsListResource } from "@/features/heldEvents/list/useHeldEventsListResource";

/** Owns list navigation and its read snapshot, including server-confirmed page correction. */
export function useHeldEventsList() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const requested = useMemo(() => readHeldEventsPagination(searchParams), [searchParams]);
  const resource = useHeldEventsListResource(requested, searchParams.toString());
  const updatePagination = useCallback(
    (next: HeldEventsPagination) => {
      void navigate({ search: heldEventsPaginationParams(next).toString(), hash: location.hash });
    },
    [location.hash, navigate],
  );
  const { correctionPage } = resource;
  useEffect(() => {
    if (correctionPage !== undefined) {
      updatePagination({ ...requested, page: correctionPage });
    }
  }, [correctionPage, requested, updatePagination]);
  const updatePage = useCallback(
    (page: number) =>
      updatePagination(changeHeldEventsPagination(requested, { kind: "page", page })),
    [requested, updatePagination],
  );
  const updatePageSize = useCallback(
    (pageSize: number) =>
      updatePagination(changeHeldEventsPagination(requested, { kind: "pageSize", pageSize })),
    [requested, updatePagination],
  );
  return {
    snapshot: resource.snapshot,
    refresh: resource.refresh,
    updatePage,
    updatePageSize,
  } as const;
}
