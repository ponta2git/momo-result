import type {
  MatchListItemView,
  MatchListStatus,
  MatchListSummaryCounts,
} from "@/features/matches/list/matchListTypes";

function summaryDelta(status: MatchListStatus): MatchListSummaryCounts {
  return {
    incompleteCount: status === "confirmed" ? 0 : 1,
    needsReviewCount: status === "needs_review" ? 1 : 0,
    ocrRunningCount: status === "ocr_running" ? 1 : 0,
    preConfirmCount: status !== "confirmed" && status !== "ocr_running" ? 1 : 0,
  };
}

export function summarizeMatchList(items: MatchListItemView[]): MatchListSummaryCounts {
  return items.reduce<MatchListSummaryCounts>(
    (summary, item) => {
      const delta = summaryDelta(item.status);
      return {
        incompleteCount: summary.incompleteCount + delta.incompleteCount,
        needsReviewCount: summary.needsReviewCount + delta.needsReviewCount,
        ocrRunningCount: summary.ocrRunningCount + delta.ocrRunningCount,
        preConfirmCount: summary.preConfirmCount + delta.preConfirmCount,
      };
    },
    {
      incompleteCount: 0,
      needsReviewCount: 0,
      ocrRunningCount: 0,
      preConfirmCount: 0,
    },
  );
}
