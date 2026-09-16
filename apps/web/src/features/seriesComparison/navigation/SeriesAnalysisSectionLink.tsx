import { ChevronRight } from "lucide-react";
import { useLocation } from "react-router-dom";

import {
  buildSeriesAnalysisSearchParams,
  parseSeriesAnalysisSearchParams,
} from "@/features/seriesComparison/model/seriesAnalysisViewModel";
import { useSeriesAnalysisNavigation } from "@/features/seriesComparison/navigation/SeriesAnalysisNavigation";
import type { SeriesAnalysisPlaybookCard } from "@/shared/api/seriesAnalysis";
import { sanitizeReturnTo } from "@/shared/navigation/returnTo";
import { LinkButton } from "@/shared/ui/actions/LinkButton";

export function SeriesAnalysisSectionLink({ card }: { card: SeriesAnalysisPlaybookCard }) {
  const location = useLocation();
  const navigation = useSeriesAnalysisNavigation();
  const params = new URLSearchParams(location.search);
  const search = buildSeriesAnalysisSearchParams({
    ...parseSeriesAnalysisSearchParams(params),
    view: card.anchorTarget.view,
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
        hash: `#${encodeURIComponent(card.anchorTarget.sectionId)}`,
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
      {card.anchorTarget.label}
    </LinkButton>
  );
}
