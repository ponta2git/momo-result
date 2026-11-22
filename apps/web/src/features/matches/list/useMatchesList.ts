import { useState } from "react";

import { isCompleteMatchListRecord } from "@/features/matches/list/matchListConditions";
import type {
  MatchListFilterActions,
  MatchListFilterCandidates,
  MatchListItemView,
  MatchListSearch,
} from "@/features/matches/list/matchListTypes";
import { useMatchListRefresh } from "@/features/matches/list/useMatchListRefresh";
import { useMatchListResource } from "@/features/matches/list/useMatchListResource";
import { useMatchListSelection } from "@/features/matches/list/useMatchListSelection";
import type { PaginationState } from "@/shared/lib/pagination";
import { recordEntryHref } from "@/shared/navigation/matchLinks";

type MatchListRefreshAction = {
  pending: boolean;
  run: () => Promise<void>;
};

export type MatchesListView = {
  draftCount: number | undefined;
  filters: {
    actions: MatchListFilterActions;
    candidates: MatchListFilterCandidates;
    detailsOpen: boolean;
    hasConditions: boolean;
    loadFailed: boolean;
    pending: boolean;
    refresh: { pending: boolean; run: () => void };
    search: MatchListSearch;
    setDetailsOpen: (open: boolean) => void;
  };
  list: {
    items: MatchListItemView[];
    memoQuery: string;
    loadFailed: boolean;
    loading: boolean;
    pagination:
      | {
          changePage: (page: number) => void;
          changePageSize: (pageSize: number) => void;
          value: PaginationState;
        }
      | undefined;
    refresh: MatchListRefreshAction;
    refreshFailed: boolean;
    sameScopeRefreshing: boolean;
    scopeChanging: boolean;
    updating: boolean;
  };
  navigation: {
    draftsHref: string;
    /** Recording starts from a held event, so the list sends a first record to the newest one. */
    recordHref: string;
  };
};

/** Composes URL selection and list reads for the page. */
export function useMatchesList(desktop: boolean, sheetOpen: boolean): MatchesListView {
  const selection = useMatchListSelection();
  const [detailsOpen, setDetailsOpen] = useState(() => {
    const { heldEventId, from, to, q, record } = selection.current;
    return Boolean(heldEventId || from || to || q || isCompleteMatchListRecord(record));
  });
  const refresh = useMatchListRefresh(selection.current, selection.applyRefresh);
  const resource = useMatchListResource({
    showMasterOptions: desktop || sheetOpen,
    showHeldEventOptions: (desktop && detailsOpen) || sheetOpen,
    currentSearch: selection.current,
    deferredSearch: selection.deferred,
    locationSettling: selection.settling,
    manualRefresh: refresh,
  });

  const paginationValue = resource.list.pagination;
  const pagination = paginationValue
    ? {
        changePage: (page: number) => {
          selection.change({ kind: "page", page, pagination: paginationValue });
        },
        changePageSize: (pageSize: number) => selection.change({ kind: "pageSize", pageSize }),
        value: paginationValue,
      }
    : undefined;

  return {
    draftCount: resource.draftCount,
    filters: {
      actions: { onChange: selection.change, onClear: selection.clear },
      candidates: resource.filters.candidates,
      detailsOpen,
      hasConditions: selection.hasConditions,
      loadFailed: resource.filters.loadFailed,
      pending: resource.list.scopeChanging,
      refresh: resource.filters.refresh,
      search: selection.current,
      setDetailsOpen,
    },
    list: {
      items: resource.list.items,
      memoQuery: resource.list.memoQuery,
      loadFailed: resource.list.loadFailed,
      loading: resource.list.loading,
      pagination,
      refresh: { pending: refresh.pending, run: () => refresh.run(resource.refresh) },
      refreshFailed: resource.list.refreshFailed,
      sameScopeRefreshing: resource.list.sameScopeRefreshing,
      scopeChanging: resource.list.scopeChanging,
      updating: resource.list.updating,
    },
    navigation: {
      draftsHref: "/drafts",
      recordHref: recordEntryHref,
    },
  };
}
