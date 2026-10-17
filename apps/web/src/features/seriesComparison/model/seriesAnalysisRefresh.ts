import { planSeriesAnalysisRead } from "@/features/seriesComparison/model/seriesAnalysisReadPlan";
import type {
  SeriesAnalysisSelection,
  SeriesAnalysisViewId,
} from "@/features/seriesComparison/model/seriesAnalysisSelection";
import type { SeriesAnalysisScopeStatus } from "@/shared/api/seriesPlayerRadar";

/** A new publication selects its own reads; refresh only the still-eligible captured view. */
export async function refreshSeriesAnalysis({
  activeView,
  artifactId,
  deferredSelection,
  selection,
  refreshPublication,
  refreshScope,
  refreshVisibleResources,
}: {
  activeView: SeriesAnalysisViewId;
  artifactId: string | undefined;
  deferredSelection: SeriesAnalysisSelection;
  selection: SeriesAnalysisSelection;
  refreshPublication: () => Promise<{ artifactId: string | undefined } | undefined>;
  refreshScope: (() => Promise<SeriesAnalysisScopeStatus>) | undefined;
  refreshVisibleResources: () => Promise<void>;
}): Promise<void> {
  if (!selection.gameTitleId) return;
  const publication = await refreshPublication();
  if (!publication || publication.artifactId !== artifactId) return;
  if (refreshScope) {
    try {
      const scope = await refreshScope();
      const plan = planSeriesAnalysisRead({
        activeView,
        artifactId,
        deferredSelection,
        scopeState: scope.state,
        selection,
      });
      if (!("query" in plan)) return;
    } catch {
      return;
    }
  }
  await refreshVisibleResources();
}
