import { cn } from "@/shared/ui/cn";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";

const columnsClass = "lg:grid-cols-[minmax(18rem,21rem)_minmax(0,1fr)]";

/** Holds the workspace's shape while the first summary is prepared: people, two means, two answers. */
export function OutlookWorkspaceLoading() {
  return (
    <div className="grid min-w-0 grid-cols-1 gap-6" role="status">
      <span className="sr-only">見通しを読み込み中</span>
      <div className={cn("grid min-w-0 grid-cols-1 items-end gap-x-10 gap-y-4", columnsClass)}>
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2">
          {["focus", "rival"].map((role) => (
            <div key={role} className="grid min-w-0 gap-2">
              <Skeleton className="h-5 w-20 max-w-full" />
              <Skeleton className="h-11 rounded-sm pointer-fine:h-10" />
            </div>
          ))}
          <Skeleton className="size-11 rounded-sm" />
        </div>
        <div className="grid min-w-0 gap-2">
          <Skeleton className="h-4 w-28 max-w-full" />
          <Skeleton className="h-10 w-80 max-w-full" />
        </div>
      </div>
      <div className="grid gap-1 lg:hidden">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-5 w-56 max-w-full" />
        <Skeleton className="h-4 w-40" />
      </div>
      <div className={cn("grid min-w-0 grid-cols-1 gap-x-10 gap-y-8 lg:gap-y-10", columnsClass)}>
        <div className="grid min-w-0 content-start gap-6">
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
                <div className="flex min-h-11 items-center pointer-fine:min-h-8">
                  <Skeleton className="h-2 w-full rounded-full" />
                </div>
                <Skeleton className="h-4 w-full" />
              </div>
            </div>
          ))}
        </div>
        <div className="grid min-w-0 grid-cols-1 gap-x-8 gap-y-10 xl:grid-cols-2">
          {["trend", "goal"].map((question) => (
            <div key={question} className="grid min-w-0 content-start gap-y-1">
              <div className="flex min-h-10 items-center">
                <Skeleton className="h-5 w-48 max-w-full" />
              </div>
              <Skeleton className="h-7 w-3/4" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="mt-3 h-52.5 w-full min-[30rem]:h-60" />
              <Skeleton className="mt-1 h-4 w-4/5" />
            </div>
          ))}
          <Skeleton className="h-11 w-full xl:col-span-2" />
        </div>
      </div>
    </div>
  );
}
