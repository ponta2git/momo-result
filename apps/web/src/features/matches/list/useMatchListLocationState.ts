import { useCallback, useDeferredValue, useMemo, useOptimistic, useTransition } from "react";
import { useSearchParams } from "react-router-dom";

import {
  buildMatchListSearchParams,
  defaultMatchListSearch,
  hasMatchListFilters,
  parseMatchListSearchParams,
} from "@/features/matches/list/matchListSearchParams";
import type { MatchListSearch } from "@/features/matches/list/matchListTypes";
import { sanitizeReturnTo } from "@/shared/navigation/returnTo";

export type MatchListLocationState = {
  apply: (search: MatchListSearch) => void;
  clear: () => void;
  current: MatchListSearch;
  deferred: MatchListSearch;
  hasFilters: boolean;
  listReturnTo: string;
  parentReturnTo: string | undefined;
  settling: boolean;
};

function searchSignature(search: MatchListSearch): string {
  return buildMatchListSearchParams(search).toString();
}

/** Owns parsing, canonical serialization, optimistic display, and updates for the list URL. */
export function useMatchListLocationState(): MatchListLocationState {
  const [searchParams, setSearchParams] = useSearchParams();
  const rawSearch = searchParams.toString();
  const parentReturnTo = sanitizeReturnTo(searchParams.get("returnTo"));
  const routeSearch = useMemo(
    () => parseMatchListSearchParams(new URLSearchParams(rawSearch)),
    [rawSearch],
  );
  const [isTransitionPending, startTransition] = useTransition();
  const [current, setOptimisticSearch] = useOptimistic(routeSearch);
  const deferred = useDeferredValue(current);

  const apply = useCallback(
    (nextSearch: MatchListSearch) => {
      startTransition(() => {
        setOptimisticSearch(nextSearch);
        const nextParams = buildMatchListSearchParams(nextSearch);
        if (parentReturnTo) nextParams.set("returnTo", parentReturnTo);
        setSearchParams(nextParams);
      });
    },
    [parentReturnTo, setOptimisticSearch, setSearchParams],
  );
  const clear = useCallback(() => apply(defaultMatchListSearch), [apply]);

  const canonicalParams = buildMatchListSearchParams(routeSearch);
  if (parentReturnTo) canonicalParams.set("returnTo", parentReturnTo);
  const canonicalSearch = canonicalParams.toString();

  return {
    apply,
    clear,
    current,
    deferred,
    hasFilters: hasMatchListFilters(current),
    listReturnTo: `/matches${canonicalSearch ? `?${canonicalSearch}` : ""}`,
    parentReturnTo,
    settling: isTransitionPending || searchSignature(current) !== searchSignature(deferred),
  };
}
