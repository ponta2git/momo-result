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
import { useMatchListRefresh } from "@/features/matches/list/useMatchListRefresh";
import { useMatchListResource } from "@/features/matches/list/useMatchListResource";
import { useMatchListSelection } from "@/features/matches/list/useMatchListSelection";
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
  const selection = useMatchListSelection();
  const refresh = useMatchListRefresh(selection.current, selection.applyRefresh);
  const resources = useMatchListResource({
    currentSearch: selection.current,
    deferredSearch: selection.deferred,
    locationSettling: selection.settling,
    manualRefresh: refresh,
  });
  const draftNavigation = useConfirmedDraftNavigationCommand();

  const { checkingIds, errors, run: checkDraftStatus } = draftNavigation;
  const rowActions = useMemo<MatchListRowActions>(
    () => ({
      checkingDraftIds: checkingIds,
      draftErrors: errors,
      disabled: resources.list.scopeChanging,
      onDraftStatusCheckAction: (action) => void checkDraftStatus(action),
    }),
    [checkingIds, errors, resources.list.scopeChanging, checkDraftStatus],
  );

  const paginationValue = resources.list.pagination;
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
    drafts: {
      rowActions,
    },
    filters: {
      actions: { onChange: selection.change, onClear: selection.clear },
      candidates: resources.filters.candidates,
      hasActive: selection.hasFilters,
      loadFailed: resources.filters.loadFailed,
      pending: resources.list.scopeChanging,
      refresh: resources.filters.refresh,
      search: selection.current,
    },
    list: {
      items: resources.list.items,
      loadFailed: resources.list.loadFailed,
      loading: resources.list.loading,
      pagination,
      refresh: { pending: refresh.pending, run: () => refresh.run(resources.refresh) },
      refreshFailed: resources.list.refreshFailed,
      sameScopeRefreshing: resources.list.sameScopeRefreshing,
      scopeChanging: resources.list.scopeChanging,
      updating: resources.list.updating,
    },
    navigation: {
      exportHref: "/exports",
      manualCreateHref: "/matches/new",
      ocrHref: "/ocr/new",
    },
    summary: resources.summary,
  };
}
