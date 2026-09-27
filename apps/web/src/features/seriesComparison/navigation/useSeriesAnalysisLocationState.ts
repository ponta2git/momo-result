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

import { isOwnerMetricId } from "@/features/seriesComparison/model/seriesAnalysisOwnerMetrics";
import type { OwnerMetricId } from "@/features/seriesComparison/model/seriesAnalysisOwnerMetrics";
import {
  buildSeriesAnalysisSearchParams,
  compatibleMapIds,
  compatibleSeasonIds,
  defaultSeriesAnalysisView,
  isSeriesAnalysisViewId,
  normalizeSeriesAnalysisSelection,
  parseSeriesAnalysisSearchParams,
} from "@/features/seriesComparison/model/seriesAnalysisViewModel";
import type {
  SeriesAnalysisUrlState,
  SeriesAnalysisViewId,
} from "@/features/seriesComparison/model/seriesAnalysisViewModel";
import type { SeriesAnalysisOptionsResponse } from "@/shared/api/seriesAnalysis";
import { sanitizeReturnTo } from "@/shared/navigation/returnTo";

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
  state: SeriesAnalysisUrlState;
  hash: string;
};

/** Owns parsing, canonicalization, and atomic URL updates, including uncommitted successive actions. */
export function useSeriesAnalysisLocationState(options: SeriesAnalysisOptionsResponse | undefined) {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const returnTo = sanitizeReturnTo(searchParams.get("returnTo"));
  const rawState = useMemo(() => parseSeriesAnalysisSearchParams(searchParams), [searchParams]);
  const [, startStateTransition] = useTransition();
  const urlState = useMemo(
    () => normalizeSeriesAnalysisSelection(options, rawState),
    [options, rawState],
  );
  const [state, setOptimisticState] = useOptimistic(urlState);
  const deferredState = useDeferredValue(state);
  const pending = useRef<PendingLocation | undefined>(undefined);
  const operation = useRef(0);
  const [displayIntent, setDisplayIntent] = useState<SeriesAnalysisDisplayIntent>();
  const [normalization, setNormalization] = useState<{
    source: string;
    message: string | undefined;
  }>();
  const href = `${location.pathname}${location.search}${location.hash}`;
  if (options && normalization?.source !== location.key) {
    const reasons: string[] = [];
    if (rawState.gameTitleId && rawState.gameTitleId !== urlState.gameTitleId) {
      reasons.push(
        urlState.gameTitleId
          ? "指定された作品は比較できないため、選択可能な作品に切り替えました。"
          : "指定された作品は比較できないため、作品の選択を解除しました。",
      );
    }
    if (rawState.seasonMasterId && rawState.seasonMasterId !== urlState.seasonMasterId) {
      reasons.push("指定されたシーズンは比較できないため、全シーズンに戻しました。");
    }
    if (rawState.mapMasterId && rawState.mapMasterId !== urlState.mapMasterId) {
      reasons.push("指定されたマップは現在の比較条件で利用できないため、全マップに戻しました。");
    }
    const rawView = searchParams.get("view");
    if (rawView !== null && !isSeriesAnalysisViewId(rawView.trim())) {
      reasons.push("指定された表示は利用できないため、振り返りに戻しました。");
    }
    const rawMetric = searchParams.get("ownerMetric");
    if (rawMetric !== null && !isOwnerMetricId(rawMetric)) {
      reasons.push("オーナー比較の指標を平均順位に戻しました。");
    }
    if (rawState.focusMatchId && !urlState.focusMatchId) {
      reasons.push("比較条件が変わったため、選択試合の強調表示を解除しました。");
    }
    if (reasons.length > 0) {
      setNormalization({ source: location.key, message: reasons.join(" ") });
    }
  }

  useEffect(() => {
    if (!options) return;
    // A canonicalization based on the old visit cannot overwrite a user action in flight.
    if (pending.current?.sourceKey === location.key && pending.current.target !== href) return;
    pending.current = undefined;
    const next = buildSeriesAnalysisSearchParams(urlState);
    if (returnTo) next.set("returnTo", returnTo);
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
    options,
    returnTo,
    searchParams,
    urlState,
  ]);

  const update = useCallback(
    (
      change: (current: SeriesAnalysisUrlState) => SeriesAnalysisUrlState,
      updateOptions: { replace?: boolean; displayOnly?: boolean } = {},
    ) => {
      const previous = pending.current;
      const inFlight =
        previous && (previous.sourceKey === location.key || previous.target === href)
          ? previous
          : undefined;
      const normalized = normalizeSeriesAnalysisSelection(
        options,
        change(inFlight?.state ?? urlState),
      );
      const params = buildSeriesAnalysisSearchParams(normalized);
      if (returnTo) params.set("returnTo", returnTo);
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
      options,
      returnTo,
      setOptimisticState,
      urlState,
    ],
  );

  const updateGameTitle = useCallback(
    (gameTitleId: string) =>
      update((current) => ({
        gameTitleId,
        view: current.view ?? defaultSeriesAnalysisView,
        ownerMetric: current.ownerMetric,
      })),
    [update],
  );
  const updateSeasonMasterId = useCallback(
    (seasonMasterId: string) =>
      update((current) => {
        const nextSeason = seasonMasterId || undefined;
        const mapIds = compatibleMapIds(options, current.gameTitleId, nextSeason);
        const currentMap = current.mapMasterId;
        return {
          ...current,
          focusMatchId: undefined,
          mapMasterId: currentMap && mapIds && !mapIds.has(currentMap) ? undefined : currentMap,
          seasonMasterId: nextSeason,
        };
      }),
    [options, update],
  );
  const updateMapMasterId = useCallback(
    (mapMasterId: string) =>
      update((current) => {
        const nextMap = mapMasterId || undefined;
        const seasonIds = compatibleSeasonIds(options, current.gameTitleId, nextMap);
        const currentSeason = current.seasonMasterId;
        return {
          ...current,
          focusMatchId: undefined,
          mapMasterId: nextMap,
          seasonMasterId:
            currentSeason && seasonIds && !seasonIds.has(currentSeason) ? undefined : currentSeason,
        };
      }),
    [options, update],
  );
  const updateView = useCallback(
    (view: SeriesAnalysisViewId, updateOptions?: { replace?: boolean }) =>
      update((current) => ({ ...current, view }), updateOptions),
    [update],
  );
  const updateOwnerMetric = useCallback(
    (ownerMetric: OwnerMetricId) =>
      update((current) => ({ ...current, ownerMetric }), { displayOnly: true }),
    [update],
  );
  const focusMatch = useCallback(
    (focusMatchId: string) =>
      update((current) => ({ ...current, focusMatchId }), { replace: false }),
    [update],
  );
  const clearFocusedMatch = useCallback(
    () => update((current) => ({ ...current, focusMatchId: undefined })),
    [update],
  );
  const clearScope = useCallback(
    () =>
      update((current) => ({
        ...current,
        focusMatchId: undefined,
        mapMasterId: undefined,
        seasonMasterId: undefined,
      })),
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
    },
    activeView: state.view ?? defaultSeriesAnalysisView,
    deferredState,
    displayIntent,
    normalizationNotice: normalization?.message,
    returnTo,
    state,
  };
}
