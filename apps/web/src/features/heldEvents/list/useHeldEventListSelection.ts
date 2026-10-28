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
  hasHeldEventListConditions,
  heldEventListSearchSignature,
  parseHeldEventListSearchParams,
} from "@/features/heldEvents/list/heldEventListSearchParams";
import {
  changeHeldEventListSelection,
  clearHeldEventListConditions,
} from "@/features/heldEvents/list/heldEventListSelection";
import type { HeldEventListSelectionChange } from "@/features/heldEvents/list/heldEventListSelection";
import type { HeldEventListSearch } from "@/features/heldEvents/list/heldEventListTypes";

export type HeldEventListSelection = {
  change: (change: HeldEventListSelectionChange) => void;
  clear: () => void;
  current: HeldEventListSearch;
  deferred: HeldEventListSearch;
  hasConditions: boolean;
  settling: boolean;
};

/** Owns parsing, canonical serialization, optimistic display, and updates for the list URL. */
export function useHeldEventListSelection(): HeldEventListSelection {
  const [searchParams] = useSearchParams();
  const { hash } = useLocation();
  const navigate = useNavigate();
  const rawSearch = searchParams.toString();
  const routeSearch = useMemo(
    () => parseHeldEventListSearchParams(new URLSearchParams(rawSearch)),
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
    (nextSearch: HeldEventListSearch) => {
      const nextSignature = heldEventListSearchSignature(nextSearch);
      if (nextSignature === heldEventListSearchSignature(latestSearchRef.current)) return;
      latestSearchRef.current = nextSearch;
      startTransition(async () => {
        setOptimisticSearch(nextSearch);
        await navigate({ search: nextSignature, hash });
      });
    },
    [hash, navigate, setOptimisticSearch],
  );
  const clear = useCallback(
    () => navigateToSearch(clearHeldEventListConditions(latestSearchRef.current)),
    [navigateToSearch],
  );
  const change = useCallback(
    (intent: HeldEventListSelectionChange) => {
      const nextSearch = changeHeldEventListSelection(latestSearchRef.current, intent);
      if (nextSearch) navigateToSearch(nextSearch);
    },
    [navigateToSearch],
  );

  return {
    change,
    clear,
    current,
    deferred,
    hasConditions: hasHeldEventListConditions(current),
    settling:
      isTransitionPending ||
      heldEventListSearchSignature(current) !== heldEventListSearchSignature(deferred),
  };
}
