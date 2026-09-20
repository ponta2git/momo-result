import { ChevronRight } from "lucide-react";
import { useLocation } from "react-router-dom";

import {
  buildSeriesAnalysisSearchParams,
  parseSeriesAnalysisSearchParams,
} from "@/features/seriesComparison/model/seriesAnalysisViewModel";
import type { SeriesAnalysisViewId } from "@/features/seriesComparison/model/seriesAnalysisViewModel";
import { useSeriesAnalysisNavigation } from "@/features/seriesComparison/navigation/SeriesAnalysisNavigation";
import type { SeriesAnalysisPlaybookCard } from "@/shared/api/seriesAnalysis";
import { sanitizeReturnTo } from "@/shared/navigation/returnTo";
import { LinkButton } from "@/shared/ui/actions/LinkButton";

const evidenceTargets = {
  revenue: { view: "drivers", sectionId: "metric-revenue-outcome", label: "物件収益の根拠を見る" },
  destination: {
    view: "drivers",
    sectionId: "metric-destination-outcome",
    label: "目的地の根拠を見る",
  },
  assets: { view: "drivers", sectionId: "metric-money", label: "資産分布の根拠を見る" },
  playOrder: { view: "context", sectionId: "metric-play-order", label: "番手別の根拠を見る" },
  ginji: { view: "context", sectionId: "metric-ginji", label: "銀次被害の根拠を見る" },
  recovery: { view: "flow", sectionId: "metric-momentum-switch", label: "推移の根拠を見る" },
  destinationPositive: {
    view: "drivers",
    sectionId: "metric-destination-outcome",
    label: "目的地到着後の根拠を見る",
  },
  accident: { view: "flow", sectionId: "metric-match-digest", label: "事故後の根拠を見る" },
} satisfies Record<
  SeriesAnalysisPlaybookCard["category"],
  { view: SeriesAnalysisViewId; sectionId: string; label: string }
>;

export function SeriesAnalysisSectionLink({
  card,
}: {
  card: Pick<SeriesAnalysisPlaybookCard, "cardId" | "category">;
}) {
  const target = evidenceTargets[card.category];
  const location = useLocation();
  const navigation = useSeriesAnalysisNavigation();
  const params = new URLSearchParams(location.search);
  const search = buildSeriesAnalysisSearchParams({
    ...parseSeriesAnalysisSearchParams(params),
    view: target.view,
  });
  const returnTo = sanitizeReturnTo(params.get("returnTo"));
  if (returnTo) search.set("returnTo", returnTo);
  const id = `review-link-${card.cardId}`;
  return (
    <LinkButton
      icon={<ChevronRight />}
      id={id}
      size="sm"
      variant="quiet"
      to={{
        search: `?${search.toString()}`,
        hash: `#${target.sectionId}`,
      }}
      onClick={(event) => {
        if (
          !event.defaultPrevented &&
          event.button === 0 &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.shiftKey &&
          !event.altKey
        )
          navigation?.rememberOrigin(id);
      }}
    >
      {target.label}
    </LinkButton>
  );
}
