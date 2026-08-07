import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";

export const seriesComparisonDrilldownParamNames = [
  "drilldown",
  "drilldownMemberId",
  "drilldownView",
] as const;

type DrilldownKind = "playOrder" | "rank" | "rankSignals" | "unexpectedWins";

export function preserveSeriesComparisonDrilldownParams(
  source: URLSearchParams,
  target: URLSearchParams,
): URLSearchParams {
  for (const name of seriesComparisonDrilldownParamNames) {
    const value = source.get(name)?.trim();
    if (value) target.set(name, value);
  }
  return target;
}

export function useSeriesComparisonDrilldownUrlState<View extends string>({
  defaultView,
  isView,
  kind,
}: {
  defaultView: View;
  isView: (value: string | null) => value is View;
  kind: DrilldownKind;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const isActive = searchParams.get("drilldown") === kind;
  const selectedMemberId = isActive ? searchParams.get("drilldownMemberId")?.trim() || null : null;
  const rawView = isActive ? searchParams.get("drilldownView") : null;
  const view = isView(rawView) ? rawView : defaultView;

  const update = useCallback(
    (change: (next: URLSearchParams) => void) => {
      const next = new URLSearchParams(searchParams);
      change(next);
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  return useMemo(
    () => ({
      close: () =>
        update((next) => {
          for (const name of seriesComparisonDrilldownParamNames) next.delete(name);
        }),
      open: (memberId: string | undefined) => {
        if (!memberId) return;
        update((next) => {
          next.set("drilldown", kind);
          next.set("drilldownMemberId", memberId);
          next.delete("drilldownView");
        });
      },
      selectedMemberId,
      setMemberId: (memberId: string) =>
        update((next) => {
          next.set("drilldown", kind);
          next.set("drilldownMemberId", memberId);
        }),
      setView: (nextView: View) =>
        update((next) => {
          if (nextView === defaultView) next.delete("drilldownView");
          else next.set("drilldownView", nextView);
        }),
      view,
    }),
    [defaultView, kind, selectedMemberId, update, view],
  );
}
