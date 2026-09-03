import { Skeleton } from "@/shared/ui/feedback/Skeleton";
import { PageContentSurface } from "@/shared/ui/layout/PageContentSurface";
import { PageFrame } from "@/shared/ui/layout/PageFrame";

export function PageSkeleton() {
  return (
    <PageFrame width="wide">
      <Skeleton className="min-h-24 rounded-md" />
      <PageContentSurface className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6">
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
