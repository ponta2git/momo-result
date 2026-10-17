import { useMemo } from "react";

import type {
  MatchListFilterActions,
  MatchListFilterCandidates,
  MatchListItemView,
  MatchListRowActions,
  MatchListSearch,
  MatchListSummaryCounts,
} from "@/features/matches/list/matchListTypes";
import { useConfirmedDraftNavigation } from "@/features/matches/list/useConfirmedDraftNavigation";
import { useMatchListRefresh } from "@/features/matches/list/useMatchListRefresh";
import { useMatchListResource } from "@/features/matches/list/useMatchListResource";
import { useMatchListSelection } from "@/features/matches/list/useMatchListSelection";
import type { PaginationState } from "@/shared/lib/pagination";

type MatchListRefreshAction = {
  pending: boolean;
  run: () => Promise<void>;
};

export type MatchesListView = {
  draftNavigation: { rowActions: MatchListRowActions };
  filters: {
    actions: MatchListFilterActions;
    candidates: MatchListFilterCandidates;
    hasActive: boolean;
    loadFailed: boolean;
    pending: boolean;
    refresh: { pending: boolean; run: () => void };
    search: MatchListSearch;
  };
  list: {
    items: MatchListItemView[];
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
    exportHref: string;
    manualCreateHref: string;
    ocrHref: string;
  };
  summary: {
    counts: MatchListSummaryCounts | undefined;
    loadFailed: boolean;
    loading: boolean;
    masked: boolean;
    retryPending: boolean;
    retry: () => void;
  };
};

/** Composes URL selection, list reads, and draft navigation for the page. */
export function useMatchesList(): MatchesListView {
  const selection = useMatchListSelection();
  const refresh = useMatchListRefresh(selection.current, selection.applyRefresh);
  const resource = useMatchListResource({
    currentSearch: selection.current,
    deferredSearch: selection.deferred,
    locationSettling: selection.settling,
    manualRefresh: refresh,
  });
  const draftNavigation = useConfirmedDraftNavigation();

  const { checkingIds, errors, run: checkDraftStatus } = draftNavigation;
  const rowActions = useMemo<MatchListRowActions>(
    () => ({
      checkingDraftIds: checkingIds,
      draftErrors: errors,
      disabled: resource.list.scopeChanging,
      onDraftStatusCheckAction: (action) => void checkDraftStatus(action),
    }),
    [checkingIds, errors, resource.list.scopeChanging, checkDraftStatus],
  );

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
    draftNavigation: {
      rowActions,
    },
    filters: {
      actions: { onChange: selection.change, onClear: selection.clear },
      candidates: resource.filters.candidates,
      hasActive: selection.hasFilters,
      loadFailed: resource.filters.loadFailed,
      pending: resource.list.scopeChanging,
      refresh: resource.filters.refresh,
      search: selection.current,
    },
    list: {
      items: resource.list.items,
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
      exportHref: "/exports",
      manualCreateHref: "/matches/new",
      ocrHref: "/ocr/new",
    },
    summary: resource.summary,
  };
}
