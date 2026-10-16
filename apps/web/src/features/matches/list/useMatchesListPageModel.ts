import { useMemo } from "react";

import type {
  MatchListFilterActions,
  MatchListFilterCandidates,
  MatchListItemView,
  MatchListRowActions,
  MatchListSearch,
  MatchListSummaryCounts,
} from "@/features/matches/list/matchListTypes";
import { useConfirmedDraftNavigationCommand } from "@/features/matches/list/useConfirmedDraftNavigationCommand";
import { useMatchListLocationState } from "@/features/matches/list/useMatchListLocationState";
import { useMatchListRefresh } from "@/features/matches/list/useMatchListRefresh";
import { useMatchListResource } from "@/features/matches/list/useMatchListResource";
import type { PaginationState } from "@/shared/lib/pagination";

type RefreshModel = {
  pending: boolean;
  run: () => Promise<void>;
};

export type MatchesListPageModel = {
  drafts: { rowActions: MatchListRowActions };
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
    refresh: RefreshModel;
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

/** Composes URL, resources, and draft navigation into the list page's render contract. */
export function useMatchesListPageModel(): MatchesListPageModel {
  const location = useMatchListLocationState();
  const refresh = useMatchListRefresh(location.current, location.applyRefresh);
  const resource = useMatchListResource({
    currentSearch: location.current,
    deferredSearch: location.deferred,
    locationSettling: location.settling,
    manualRefresh: refresh,
  });
  const draftNavigation = useConfirmedDraftNavigationCommand();

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
          location.change({ kind: "page", page, pagination: paginationValue });
        },
        changePageSize: (pageSize: number) => location.change({ kind: "pageSize", pageSize }),
        value: paginationValue,
      }
    : undefined;

  return {
    drafts: {
      rowActions,
    },
    filters: {
      actions: { onApply: location.apply, onClear: location.clear },
      candidates: resource.filters.candidates,
      hasActive: location.hasFilters,
      loadFailed: resource.filters.loadFailed,
      pending: resource.list.scopeChanging,
      refresh: resource.filters.refresh,
      search: location.current,
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
