import { Skeleton } from "@/shared/ui/feedback/Skeleton";

export function SeriesAnalysisDrilldownLoading() {
  return (
    <div aria-label="詳細を読み込み中" className="grid gap-3">
      <Skeleton className="min-h-12" />
      <Skeleton className="min-h-40" />
    </div>
  );
}
