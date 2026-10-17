import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useOptimistic,
  useRef,
  useTransition,
} from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";

import { resolveMatchListRefresh } from "@/features/matches/list/matchListRefresh";
import type {
  MatchListRefreshFailure,
  MatchListRefreshResult,
} from "@/features/matches/list/matchListRefresh";
import {
  buildMatchListSearchParams,
  defaultMatchListSearch,
  hasMatchListFilters,
  parseMatchListSearchParams,
} from "@/features/matches/list/matchListSearchParams";
import { changeMatchListSelection } from "@/features/matches/list/matchListSelection";
import type { MatchListSelectionChange } from "@/features/matches/list/matchListSelection";
import type { MatchListSearch } from "@/features/matches/list/matchListTypes";

export type MatchListSelection = {
  change: (change: MatchListSelectionChange) => void;
  clear: () => void;
  current: MatchListSearch;
  deferred: MatchListSearch;
  hasFilters: boolean;
  applyRefresh: (result: MatchListRefreshResult) => MatchListRefreshFailure | null;
  settling: boolean;
};

function searchSignature(search: MatchListSearch): string {
  return buildMatchListSearchParams(search).toString();
}

/** Owns parsing, canonical serialization, optimistic display, and updates for the list URL. */
export function useMatchListSelection(): MatchListSelection {
  const [searchParams] = useSearchParams();
  const { hash } = useLocation();
  const navigate = useNavigate();
  const rawSearch = searchParams.toString();
  const routeSearch = useMemo(
    () => parseMatchListSearchParams(new URLSearchParams(rawSearch)),
    [rawSearch],
  );
  const [isTransitionPending, startTransition] = useTransition();
  const [current, setOptimisticSearch] = useOptimistic(routeSearch);
  const latestSearchRef = useRef(current);
  const deferred = useDeferredValue(current);

  useEffect(() => {
    latestSearchRef.current = current;
  }, [current]);

  const navigateToSearch = useCallback(
    (nextSearch: MatchListSearch) => {
      latestSearchRef.current = nextSearch;
      startTransition(async () => {
        setOptimisticSearch(nextSearch);
        const nextParams = buildMatchListSearchParams(nextSearch);
        await navigate({ search: nextParams.toString(), hash });
      });
    },
    [hash, navigate, setOptimisticSearch],
  );
  const clear = useCallback(() => navigateToSearch(defaultMatchListSearch), [navigateToSearch]);
  const change = useCallback(
    (intent: MatchListSelectionChange) => {
      const nextSearch = changeMatchListSelection(latestSearchRef.current, intent);
      if (nextSearch) navigateToSearch(nextSearch);
    },
    [navigateToSearch],
  );
  const applyRefresh = useCallback(
    (result: MatchListRefreshResult) => {
      const resolved = resolveMatchListRefresh(latestSearchRef.current, result);
      if (resolved.nextSearch) navigateToSearch(resolved.nextSearch);
      return resolved.failure;
    },
    [navigateToSearch],
  );

  return {
    change,
    clear,
    current,
    deferred,
    hasFilters: hasMatchListFilters(current),
    applyRefresh,
    settling: isTransitionPending || searchSignature(current) !== searchSignature(deferred),
  };
}
