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
import { useMatchListResource } from "@/features/matches/list/useMatchListResource";
import { cursorForPage } from "@/shared/lib/cursorPagination";
import type { PaginationState } from "@/shared/lib/pagination";
import { withReturnTo } from "@/shared/navigation/returnTo";

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
    backHref: string | undefined;
    exportHref: string;
    manualCreateHref: string;
    ocrHref: string;
  };
  summary: {
    counts: MatchListSummaryCounts | undefined;
    loadFailed: boolean;
    loading: boolean;
    masked: boolean;
    retry: () => void;
  };
};

/** Composes URL, resources, and draft navigation into the list page's render contract. */
export function useMatchesListPageModel(): MatchesListPageModel {
  const location = useMatchListLocationState();
  const resource = useMatchListResource({
    currentSearch: location.current,
    deferredSearch: location.deferred,
    listReturnTo: location.listReturnTo,
    locationSettling: location.settling,
    resetCursorIfUnchanged: location.resetCursorIfUnchanged,
  });
  const draftNavigation = useConfirmedDraftNavigationCommand(location.listReturnTo);

  const paginationValue = resource.list.pagination;
  const pagination = paginationValue
    ? {
        changePage: (page: number) => {
          const cursor = cursorForPage(paginationValue, page);
          if (cursor !== undefined) location.apply({ ...location.current, cursor });
        },
        changePageSize: (pageSize: number) =>
          location.apply({ ...location.current, cursor: "", pageSize }),
        value: paginationValue,
      }
    : undefined;

  return {
    drafts: {
      rowActions: {
        checkingDraftIds: draftNavigation.checkingIds,
        disabled: resource.list.scopeChanging,
        onDraftStatusCheckAction: (action) => void draftNavigation.run(action),
      },
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
      refresh: resource.refresh,
      refreshFailed: resource.list.refreshFailed,
      sameScopeRefreshing: resource.list.sameScopeRefreshing,
      scopeChanging: resource.list.scopeChanging,
      updating: resource.list.updating,
    },
    navigation: {
      backHref: location.parentReturnTo,
      exportHref: withReturnTo("/exports", location.listReturnTo),
      manualCreateHref: withReturnTo("/matches/new", location.listReturnTo),
      ocrHref: withReturnTo("/ocr/new", location.listReturnTo),
    },
    summary: resource.summary,
  };
}
