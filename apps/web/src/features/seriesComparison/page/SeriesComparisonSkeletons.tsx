import type { SeriesAnalysisViewId } from "@/features/seriesComparison/model/seriesAnalysisSelection";
import { defaultSeriesAnalysisView } from "@/features/seriesComparison/model/seriesAnalysisSelection";
import { OutlookLoading } from "@/features/seriesComparison/outlook/OutlookLoading";
import {
  analysisViewLabels,
  analysisViewSections,
} from "@/features/seriesComparison/page/SeriesComparisonAnalysisNavigation";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";
import { PageContentSurface } from "@/shared/ui/layout/PageContentSurface";
import { PageFrame } from "@/shared/ui/layout/PageFrame";

type AnalysisViewId = Exclude<SeriesAnalysisViewId, "review" | "outlook">;

const tabSlotClass =
  "inline-flex min-h-11 shrink-0 items-center px-3 py-2 text-sm/5 pointer-fine:min-h-9 pointer-fine:py-1";

export function PageSkeleton({ view }: { view?: SeriesAnalysisViewId | undefined }) {
  return (
    <PageFrame aria-label="戦績比較を読み込み中" width="analysis">
      <PageContentSurface
        aria-label="戦績比較"
        className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6"
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
            <Skeleton key={label} className={`${tabSlotClass} rounded-sm`}>
              <span className="invisible">{label}</span>
            </Skeleton>
          ))}
        </div>
        <ComparisonSkeleton view={view} />
      </PageContentSurface>
    </PageFrame>
  );
}

/** Keeps the URL-fixed rows of the requested purpose: its sub-tabs, contents, and four players. */
export function ComparisonSkeleton({ view }: { view?: SeriesAnalysisViewId | undefined }) {
  const requestedView = view ?? defaultSeriesAnalysisView;
  if (requestedView === "outlook") return <OutlookLoading />;
  if (requestedView === "review") {
    return (
      <div aria-label="戦績比較を読み込み中" className="min-w-0" role="status">
        <span className="sr-only">戦績比較を読み込み中</span>
        <ReviewSkeleton />
      </div>
    );
  }

  return (
    <div
      aria-label="戦績比較を読み込み中"
      className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4"
      role="status"
    >
      <span className="sr-only">戦績比較を読み込み中</span>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div
          aria-hidden="true"
          className="flex max-w-full min-w-0 overflow-hidden border-b border-[var(--color-border)]"
        >
          {analysisViewLabels.map((item) => (
            <span className={tabSlotClass} key={item.id}>
              <Skeleton as="span">
                <span className="invisible">{item.label}</span>
              </Skeleton>
            </span>
          ))}
        </div>
        <Skeleton className="h-11 w-32 max-w-full justify-self-start sm:justify-self-end pointer-fine:h-9" />
      </div>
      <AnalysisSectionsSkeleton view={requestedView} />
    </div>
  );
}

/** Mirrors an analysis view: its fixed table of contents, then section headings with bodies. */
export function AnalysisSectionsSkeleton({ view }: { view: AnalysisViewId }) {
  const sections = analysisViewSections(view);
  return (
    <div aria-hidden="true" className="grid gap-8">
      <div className="flex min-w-0 gap-x-2 overflow-hidden py-1 text-sm/5">
        {sections.map((section) => (
          <span className="inline-flex min-h-11 shrink-0 items-center" key={section.id}>
            <Skeleton as="span">
              <span className="invisible">{section.label}</span>
            </Skeleton>
          </span>
        ))}
      </div>
      {sections.slice(0, 2).map((section) => (
        <div className="grid gap-2" key={section.id}>
          <Skeleton className="h-5 w-40 max-w-full" />
          <Skeleton className="min-h-64" />
        </div>
      ))}
    </div>
  );
}

/** Mirrors the four player columns that always follow the review help action. */
export function ReviewSkeleton() {
  return (
    <div aria-hidden="true" className="grid gap-6">
      <div className="flex justify-end">
        <Skeleton className="h-11 w-32 max-w-full pointer-fine:h-9" />
      </div>
      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
        {["first", "second", "third", "fourth"].map((player) => (
          <div className="grid min-w-0 content-start gap-2" key={player}>
            <Skeleton className="h-5 w-24 max-w-full" />
            <Skeleton className="min-h-48" />
          </div>
        ))}
      </div>
    </div>
  );
}
