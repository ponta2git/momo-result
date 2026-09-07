import { Skeleton } from "@/shared/ui/feedback/Skeleton";
import { PageContentSurface } from "@/shared/ui/layout/PageContentSurface";
import { PageFrame } from "@/shared/ui/layout/PageFrame";

export function PageSkeleton({ showReturnAction }: { showReturnAction: boolean }) {
  return (
    <PageFrame aria-busy="true" aria-label="戦績比較を読み込み中" width="wide">
      <PageContentSurface
        aria-label="戦績比較"
        className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4"
        role="region"
      >
        {showReturnAction ? (
          <div className="flex justify-end" data-page-content-actions="">
            <Skeleton className="h-11 w-32 rounded-sm pointer-fine:h-9" />
          </div>
        ) : null}
        <Skeleton className="min-h-24 rounded-md" />
        <ComparisonSkeleton />
      </PageContentSurface>
    </PageFrame>
  );
}

export function ComparisonSkeleton() {
  return (
    <>
      {["a", "b", "c", "d"].map((id) => (
        <Skeleton key={id} className="min-h-64 rounded-md" />
      ))}
    </>
  );
}
