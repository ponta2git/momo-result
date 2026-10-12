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

import {
  buildMatchListSearchParams,
  defaultMatchListSearch,
  hasMatchListFilters,
  parseMatchListSearchParams,
} from "@/features/matches/list/matchListSearchParams";
import type { MatchListSearch } from "@/features/matches/list/matchListTypes";

export type MatchListLocationState = {
  apply: (search: MatchListSearch) => void;
  clear: () => void;
  current: MatchListSearch;
  deferred: MatchListSearch;
  hasFilters: boolean;
  resetCursorIfUnchanged: (expectedSearch: MatchListSearch) => boolean;
  settling: boolean;
};

function searchSignature(search: MatchListSearch): string {
  return buildMatchListSearchParams(search).toString();
}

/** Owns parsing, canonical serialization, optimistic display, and updates for the list URL. */
export function useMatchListLocationState(): MatchListLocationState {
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

  const apply = useCallback(
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
  const clear = useCallback(() => apply(defaultMatchListSearch), [apply]);
  const resetCursorIfUnchanged = useCallback(
    (expectedSearch: MatchListSearch) => {
      const latestSearch = latestSearchRef.current;
      if (searchSignature(latestSearch) !== searchSignature(expectedSearch)) return false;
      apply({ ...latestSearch, cursor: "" });
      return true;
    },
    [apply],
  );

  return {
    apply,
    clear,
    current,
    deferred,
    hasFilters: hasMatchListFilters(current),
    resetCursorIfUnchanged,
    settling: isTransitionPending || searchSignature(current) !== searchSignature(deferred),
  };
}
