import type { SeriesAnalysisViewId } from "@/features/seriesComparison/model/seriesAnalysisViewModel";
import { OutlookLoading } from "@/features/seriesComparison/outlook/OutlookLoading";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";
import { PageContentSurface } from "@/shared/ui/layout/PageContentSurface";
import { PageFrame } from "@/shared/ui/layout/PageFrame";

export function PageSkeleton({
  showReturnAction,
  view,
}: {
  showReturnAction: boolean;
  view?: SeriesAnalysisViewId | undefined;
}) {
  return (
    <PageFrame aria-label="戦績比較を読み込み中" width="wide">
      {showReturnAction ? (
        <div>
          <Skeleton className="h-11 w-40 max-w-full rounded-sm pointer-fine:h-9" />
        </div>
      ) : null}
      <PageContentSurface
        aria-label="戦績比較"
        className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4"
        role="region"
      >
        <div className="@container/analysis-scope grid min-w-0 gap-2">
          <Skeleton className="h-14 w-full" />
          <div className="grid grid-cols-1 items-center justify-items-start gap-2 @sm/analysis-scope:flex @sm/analysis-scope:justify-between">
            <Skeleton className="h-4 w-44 max-w-full" />
            <Skeleton className="h-11 w-32 max-w-full pointer-fine:h-9" />
          </div>
        </div>
        <div aria-hidden="true" className="flex flex-wrap gap-2">
          {["次戦に備える", "分析する", "見通しを試す"].map((label) => (
            <Skeleton
              key={label}
              className="inline-flex min-h-11 items-center rounded-sm px-3 py-2 text-sm leading-5 pointer-fine:min-h-9 pointer-fine:py-1"
            >
              <span className="invisible">{label}</span>
            </Skeleton>
          ))}
        </div>
        <ComparisonSkeleton view={view} />
      </PageContentSurface>
    </PageFrame>
  );
}

export function ComparisonSkeleton({ view }: { view?: SeriesAnalysisViewId | undefined }) {
  if (view === "outlook") return <OutlookLoading />;

  return (
    <>
      <span className="sr-only" role="status">
        戦績比較を読み込み中
      </span>
      {["a", "b", "c", "d"].map((id) => (
        <Skeleton key={id} className="min-h-64 rounded-md" />
      ))}
    </>
  );
}
