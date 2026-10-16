import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useOptimistic,
  useRef,
  useState,
  useTransition,
} from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";

import type { OwnerMetricId } from "@/features/seriesComparison/model/seriesAnalysisOwnerMetrics";
import { defaultSeriesAnalysisView } from "@/features/seriesComparison/model/seriesAnalysisViewModel";
import type {
  SeriesAnalysisSelection,
  SeriesAnalysisSelectionChange,
  SeriesAnalysisViewId,
} from "@/features/seriesComparison/model/seriesAnalysisViewModel";
import {
  buildSeriesAnalysisSearchParams,
  parseSeriesAnalysisSearchParams,
  seriesAnalysisNormalizationNotice,
} from "@/features/seriesComparison/navigation/seriesAnalysisUrl";

/** One page-local operation; only the matching REPLACE commit can inherit its source position. */
export type SeriesAnalysisDisplayIntent = {
  operation: number;
  sourceVisit: string;
  target: string;
  position: { x: number; y: number };
};
type PendingLocation = {
  sourceKey: string;
  target: string;
  state: SeriesAnalysisSelection;
  hash: string;
};

/** Read once so scope verification and URL updates share the same requested selection. */
export function useSeriesAnalysisLocationRequest() {
  const [searchParams] = useSearchParams();
  const selection = useMemo(() => parseSeriesAnalysisSearchParams(searchParams), [searchParams]);
  return useMemo(() => ({ searchParams, selection }), [searchParams, selection]);
}

/** Owns canonical URL commits and atomic updates, including uncommitted successive actions. */
export function useSeriesAnalysisLocationState({
  request,
  normalizedSelection,
  canonicalizationEnabled,
  changeSelection,
}: {
  request: ReturnType<typeof useSeriesAnalysisLocationRequest>;
  normalizedSelection: SeriesAnalysisSelection;
  canonicalizationEnabled: boolean;
  changeSelection: (
    current: SeriesAnalysisSelection,
    change: SeriesAnalysisSelectionChange,
  ) => SeriesAnalysisSelection;
}) {
  const { searchParams, selection: requestedSelection } = request;
  const location = useLocation();
  const navigate = useNavigate();
  const [, startStateTransition] = useTransition();
  const [state, setOptimisticState] = useOptimistic(normalizedSelection);
  const deferredState = useDeferredValue(state);
  const pending = useRef<PendingLocation | undefined>(undefined);
  const operation = useRef(0);
  const [displayIntent, setDisplayIntent] = useState<SeriesAnalysisDisplayIntent>();
  const [normalization, setNormalization] = useState<{
    source: string;
    message: string | undefined;
  }>();
  const href = `${location.pathname}${location.search}${location.hash}`;
  if (canonicalizationEnabled && normalization?.source !== location.key) {
    const message = seriesAnalysisNormalizationNotice(
      searchParams,
      requestedSelection,
      normalizedSelection,
    );
    if (message) setNormalization({ source: location.key, message });
  }

  useEffect(() => {
    if (!canonicalizationEnabled) return;
    // A canonicalization based on the old visit cannot overwrite a user action in flight.
    if (pending.current?.sourceKey === location.key && pending.current.target !== href) return;
    pending.current = undefined;
    const next = buildSeriesAnalysisSearchParams(normalizedSelection);
    if (next.toString() !== searchParams.toString()) {
      void navigate(
        { pathname: location.pathname, search: `?${next.toString()}`, hash: location.hash },
        { replace: true, state: location.state, preventScrollReset: true },
      );
    }
  }, [
    href,
    location.hash,
    location.key,
    location.pathname,
    location.state,
    navigate,
    canonicalizationEnabled,
    searchParams,
    normalizedSelection,
  ]);

  const update = useCallback(
    (
      change: SeriesAnalysisSelectionChange,
      updateOptions: { replace?: boolean; displayOnly?: boolean } = {},
    ) => {
      const previous = pending.current;
      const inFlight =
        previous && (previous.sourceKey === location.key || previous.target === href)
          ? previous
          : undefined;
      const normalized = changeSelection(inFlight?.state ?? normalizedSelection, change);
      const params = buildSeriesAnalysisSearchParams(normalized);
      const hash = updateOptions.displayOnly ? "#metric-owner" : (inFlight?.hash ?? location.hash);
      const target = `${location.pathname}?${params.toString()}${hash}`;
      pending.current = { sourceKey: location.key, target, state: normalized, hash };
      setNormalization({ source: location.key, message: undefined });
      operation.current += 1;
      setDisplayIntent(
        updateOptions.displayOnly
          ? {
              operation: operation.current,
              sourceVisit: `${location.key}:${location.hash}`,
              target,
              position: { x: window.scrollX, y: window.scrollY },
            }
          : undefined,
      );
      startStateTransition(async () => {
        setOptimisticState(normalized);
        await navigate(
          { pathname: location.pathname, search: `?${params.toString()}`, hash },
          {
            replace: updateOptions.replace ?? true,
            state: location.state,
            preventScrollReset: true,
          },
        );
      });
    },
    [
      href,
      location.hash,
      location.key,
      location.pathname,
      location.state,
      navigate,
      changeSelection,
      setOptimisticState,
      normalizedSelection,
    ],
  );

  const updateGameTitle = useCallback(
    (gameTitleId: string) => update({ kind: "title", gameTitleId }, { replace: false }),
    [update],
  );
  const updateSeasonMasterId = useCallback(
    (seasonMasterId: string) => update({ kind: "season", seasonMasterId }, { replace: false }),
    [update],
  );
  const updateMapMasterId = useCallback(
    (mapMasterId: string) => update({ kind: "map", mapMasterId }, { replace: false }),
    [update],
  );
  const updateView = useCallback(
    (view: SeriesAnalysisViewId, updateOptions?: { replace?: boolean }) =>
      update({ kind: "view", view }, updateOptions),
    [update],
  );
  const updateOwnerMetric = useCallback(
    (ownerMetric: OwnerMetricId) =>
      update({ kind: "ownerMetric", ownerMetric }, { displayOnly: true }),
    [update],
  );
  const focusMatch = useCallback(
    (matchId: string) => update({ kind: "focus", matchId }, { replace: false }),
    [update],
  );
  const clearFocusedMatch = useCallback(
    () => update({ kind: "focus", matchId: undefined }),
    [update],
  );
  const clearScope = useCallback(
    () => update({ kind: "clearScope" }, { replace: false }),
    [update],
  );
  const updateOutlookMember = useCallback(
    (role: "focus" | "rival", memberId: string) =>
      update({ kind: "member", role, memberId }, { replace: false }),
    [update],
  );

  return {
    actions: {
      clearFocusedMatch,
      clearScope,
      focusMatch,
      updateGameTitle,
      updateMapMasterId,
      updateSeasonMasterId,
      updateView,
      updateOwnerMetric,
      updateOutlookMember,
    },
    activeView: state.view ?? defaultSeriesAnalysisView,
    deferredState,
    displayIntent,
    normalizationNotice: normalization?.message,
    state,
  };
}
