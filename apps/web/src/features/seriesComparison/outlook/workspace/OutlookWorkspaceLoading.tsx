import {
  OutlookBodyLayout,
  OutlookComparisonLayout,
  OutlookQuestion,
  OutlookWorkspaceFrame,
} from "@/features/seriesComparison/outlook/workspace/OutlookWorkspaceLayout";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";

function QuestionSkeleton({ id }: { id: string }) {
  return (
    <OutlookQuestion
      labelledBy={id}
      question={<Skeleton className="h-5 w-48 max-w-full" />}
      answer={<Skeleton className="h-7 w-3/4" />}
      support={<Skeleton className="h-4 w-2/3" />}
      chart={<Skeleton className="h-52.5 w-full min-[30rem]:h-57.5" />}
      notes={<Skeleton className="h-4 w-4/5" />}
    />
  );
}

/** The workspace's own layout parts hold its shape while the first summary is prepared. */
export function OutlookWorkspaceLoading() {
  return (
    <div role="status" className="min-w-0">
      <span className="sr-only">見通しを読み込み中</span>
      <OutlookWorkspaceFrame
        comparison={
          <OutlookComparisonLayout
            people={
              <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2">
                {["focus", "rival"].map((role) => (
                  <div key={role} className="grid min-w-0 gap-2">
                    <Skeleton className="h-5 w-20 max-w-full" />
                    <Skeleton className="h-11 rounded-sm pointer-fine:h-10" />
                  </div>
                ))}
                <Skeleton className="size-11 rounded-sm" />
              </div>
            }
            standing={
              <div className="grid min-w-0 gap-2">
                <Skeleton className="h-4 w-28 max-w-full" />
                <Skeleton className="h-10 w-80 max-w-full" />
              </div>
            }
          />
        }
      >
        <OutlookBodyLayout
          strip={(placement) =>
            placement === "page" ? (
              <div className="grid gap-1 lg:hidden">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-5 w-56 max-w-full" />
                <Skeleton className="h-4 w-40" />
              </div>
            ) : null
          }
          assumptions={
            <div className="grid gap-6">
              <Skeleton className="h-5 w-32" />
              {["first", "second"].map((person) => (
                <div key={person} className="grid min-w-0 gap-2">
                  <div className="flex items-center justify-between gap-3">
                    <Skeleton className="h-5 w-20" />
                    <Skeleton className="h-4 w-24" />
                  </div>
                  <Skeleton className="h-11 w-28 rounded-sm pointer-fine:h-10" />
                  <div className="grid gap-0.5">
                    <div className="h-4" />
                    <div className="flex min-h-11 items-center px-2 pointer-fine:min-h-8">
                      <Skeleton className="h-1.5 w-full rounded-full" />
                    </div>
                    <Skeleton className="h-4 w-full" />
                  </div>
                  <div className="h-4" />
                </div>
              ))}
            </div>
          }
          trend={<QuestionSkeleton id="outlook-loading-trend" />}
          goal={<QuestionSkeleton id="outlook-loading-goal" />}
          details={<Skeleton className="h-11 w-full" />}
        />
      </OutlookWorkspaceFrame>
    </div>
  );
}
