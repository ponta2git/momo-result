import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";

import {
  parseSeriesAnalysisAdminSearch,
  updateSeriesAnalysisAdminSearch,
} from "@/features/seriesAnalysisAdmin/seriesAnalysisAdminUrlState";
import type { SeriesAnalysisAdminNavigation } from "@/features/seriesAnalysisAdmin/seriesAnalysisAdminUrlState";

export function useSeriesAnalysisAdminLocation() {
  const [params, setParams] = useSearchParams();
  const update = useCallback(
    (action: SeriesAnalysisAdminNavigation) => {
      const next = updateSeriesAnalysisAdminSearch(params, action);
      setParams(next.params, { replace: next.replace });
    },
    [params, setParams],
  );
  const selectTitle = useCallback((value: string) => update({ kind: "title", value }), [update]);
  return { ...parseSeriesAnalysisAdminSearch(params), selectTitle, update };
}
