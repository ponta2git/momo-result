import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useOptimistic,
  useTransition,
} from "react";
import { useSearchParams } from "react-router-dom";

import {
  buildSeriesAnalysisSearchParams,
  compatibleMapIds,
  compatibleSeasonIds,
  defaultSeriesAnalysisView,
  normalizeSeriesAnalysisSelection,
  parseSeriesAnalysisSearchParams,
} from "@/features/seriesComparison/model/seriesAnalysisViewModel";
import type {
  SeriesAnalysisUrlState,
  SeriesAnalysisViewId,
} from "@/features/seriesComparison/model/seriesAnalysisViewModel";
import type { SeriesAnalysisOptionsResponse } from "@/shared/api/seriesAnalysis";
import { sanitizeReturnTo } from "@/shared/navigation/returnTo";

/** Owns parsing, canonicalization, and intent-level updates for the series-analysis URL. */
export function useSeriesAnalysisLocationState(options: SeriesAnalysisOptionsResponse | undefined) {
  const [searchParams, setSearchParams] = useSearchParams();
  const returnTo = sanitizeReturnTo(searchParams.get("returnTo"));
  const rawState = useMemo(() => parseSeriesAnalysisSearchParams(searchParams), [searchParams]);
  const [, startStateTransition] = useTransition();
  const urlState = useMemo(
    () => normalizeSeriesAnalysisSelection(options, rawState),
    [options, rawState],
  );
  const [state, setOptimisticState] = useOptimistic(urlState);
  const deferredState = useDeferredValue(state);
  const urlSignature = useMemo(
    () => buildSeriesAnalysisSearchParams(urlState).toString(),
    [urlState],
  );
  const stateSignature = useMemo(() => buildSeriesAnalysisSearchParams(state).toString(), [state]);
  const locationSettling = urlSignature !== stateSignature;

  useEffect(() => {
    if (!options || locationSettling) return;
    const next = buildSeriesAnalysisSearchParams(urlState);
    if (returnTo) next.set("returnTo", returnTo);
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [locationSettling, options, returnTo, searchParams, setSearchParams, urlState]);

  const update = useCallback(
    (next: SeriesAnalysisUrlState, updateOptions: { replace?: boolean } = {}) => {
      const normalized = normalizeSeriesAnalysisSelection(options, next);
      startStateTransition(() => {
        setOptimisticState(normalized);
        const params = buildSeriesAnalysisSearchParams(normalized);
        if (returnTo) params.set("returnTo", returnTo);
        setSearchParams(params, { replace: updateOptions.replace ?? true });
      });
    },
    [options, returnTo, setOptimisticState, setSearchParams],
  );

  const updateGameTitle = useCallback(
    (gameTitleId: string) => update({ gameTitleId, view: state.view ?? defaultSeriesAnalysisView }),
    [state.view, update],
  );
  const updateSeasonMasterId = useCallback(
    (seasonMasterId: string) => {
      const nextSeason = seasonMasterId || undefined;
      const mapIds = compatibleMapIds(options, state.gameTitleId, nextSeason);
      const currentMap = state.mapMasterId;
      update({
        ...state,
        focusMatchId: undefined,
        mapMasterId: currentMap && mapIds && !mapIds.has(currentMap) ? undefined : currentMap,
        seasonMasterId: nextSeason,
      });
    },
    [options, state, update],
  );
  const updateMapMasterId = useCallback(
    (mapMasterId: string) => {
      const nextMap = mapMasterId || undefined;
      const seasonIds = compatibleSeasonIds(options, state.gameTitleId, nextMap);
      const currentSeason = state.seasonMasterId;
      update({
        ...state,
        focusMatchId: undefined,
        mapMasterId: nextMap,
        seasonMasterId:
          currentSeason && seasonIds && !seasonIds.has(currentSeason) ? undefined : currentSeason,
      });
    },
    [options, state, update],
  );
  const updateView = useCallback(
    (view: SeriesAnalysisViewId, updateOptions?: { replace?: boolean }) =>
      update({ ...state, view }, updateOptions),
    [state, update],
  );
  const focusMatch = useCallback(
    (focusMatchId: string) => update({ ...state, focusMatchId }, { replace: false }),
    [state, update],
  );
  const clearFocusedMatch = useCallback(
    () => update({ ...state, focusMatchId: undefined }),
    [state, update],
  );
  const clearScope = useCallback(
    () =>
      update({
        ...state,
        focusMatchId: undefined,
        mapMasterId: undefined,
        seasonMasterId: undefined,
      }),
    [state, update],
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
    },
    activeView: state.view ?? defaultSeriesAnalysisView,
    deferredState,
    returnTo,
    state,
  };
}
