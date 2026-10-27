import { useEffect } from "react";

import type {
  HeldEventListFilterActions,
  HeldEventListFilterCandidates,
  HeldEventListSearch,
} from "@/features/heldEvents/list/heldEventListTypes";
import { useHeldEventListSelection } from "@/features/heldEvents/list/useHeldEventListSelection";
import { useHeldEventsListResource } from "@/features/heldEvents/list/useHeldEventsListResource";
import type { HeldEventsListResource } from "@/features/heldEvents/list/useHeldEventsListResource";
import type { PaginationState } from "@/shared/lib/pagination";

export type HeldEventsListView = {
  filters: {
    actions: HeldEventListFilterActions;
    candidates: HeldEventListFilterCandidates;
    hasConditions: boolean;
    loadFailed: boolean;
    pending: boolean;
    refresh: { pending: boolean; run: () => void };
    search: HeldEventListSearch;
  };
  list: Omit<HeldEventsListResource["list"], "pagination"> & {
    pagination:
      | {
          changePage: (page: number) => void;
          changePageSize: (pageSize: number) => void;
          value: PaginationState;
        }
      | undefined;
  };
  refresh: HeldEventsListResource["refresh"];
};

/** Composes URL selection, the list read, and server-confirmed page correction. */
export function useHeldEventsList(): HeldEventsListView {
  const selection = useHeldEventListSelection();
  const resource = useHeldEventsListResource({
    currentSearch: selection.current,
    deferredSearch: selection.deferred,
    locationSettling: selection.settling,
  });
  const { change } = selection;
  const { correctionPage } = resource;
  useEffect(() => {
    if (correctionPage !== undefined) change({ kind: "page", page: correctionPage });
  }, [change, correctionPage]);

  const paginationValue = resource.list.pagination;
  return {
    filters: {
      actions: { onChange: change, onClear: selection.clear },
      candidates: resource.filters.candidates,
      hasConditions: selection.hasConditions,
      loadFailed: resource.filters.loadFailed,
      pending: resource.list.scopeChanging,
      refresh: resource.filters.refresh,
      search: selection.current,
    },
    list: {
      ...resource.list,
      pagination: paginationValue
        ? {
            changePage: (page: number) => change({ kind: "page", page }),
            changePageSize: (pageSize: number) => change({ kind: "pageSize", pageSize }),
            value: paginationValue,
          }
        : undefined,
    },
    refresh: resource.refresh,
  };
}
