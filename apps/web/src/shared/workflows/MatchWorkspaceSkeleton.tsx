import { actionRowClass, taskActionPanelClass } from "@/shared/ui/actions/actionGroup";
import { cn } from "@/shared/ui/cn";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";
import { controlSkeletonHeightClass } from "@/shared/ui/forms/controlPresentation";
import { PageContentSurface } from "@/shared/ui/layout/PageContentSurface";
import { StatusBadge } from "@/shared/ui/status/StatusBadge";
import {
  matchWorkspaceSideBySideColumnsClass,
  workspaceSampleStatus,
} from "@/shared/workflows/matchWorkspacePresentation";

export type MatchWorkspaceSkeletonProps = {
  mode: "create" | "edit" | "review";
  sample: boolean;
  sourcePanel: boolean;
};

/**
 * Mirrors the editor's slots that the URL already decides: the setup and achievement
 * triggers, the result and achievement tabs, the score section, the note field outside editing,
 * the source panel when the page reserves the workspace width, and the final action panel. Notices that depend on the
 * loaded data are not guessed. The route fallback and the workspace's own loading share it.
 */
export function MatchWorkspaceSkeleton({ mode, sample, sourcePanel }: MatchWorkspaceSkeletonProps) {
  return (
    <PageContentSurface aria-label="試合内容" className="grid grid-cols-1 gap-6" role="region">
      <div className={cn(actionRowClass, "justify-between")}>
        <Skeleton className="h-11 w-32 max-w-full rounded-sm pointer-fine:h-9" />
        {sample ? (
          <div className="ms-auto">
            <StatusBadge {...workspaceSampleStatus} />
          </div>
        ) : null}
      </div>
      <div aria-hidden="true" className="grid min-w-0 gap-4">
        <div className="grid min-w-0">
          <div className="grid min-h-11 gap-1 px-3 py-2">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-4 w-full max-w-80" />
          </div>
          {mode === "create" ? <SetupFieldsSkeleton /> : null}
        </div>
        {/* The result and achievement views, the result opening first. */}
        <div className="flex min-h-11 items-end gap-2 border-b border-[var(--color-border)] pointer-fine:min-h-9">
          <Skeleton className="mb-2 h-5 w-20" />
          <Skeleton className="mb-2 h-5 w-24" />
        </div>
        <div className="@container/match-editor min-w-0">
          <div
            className={cn(
              "grid min-w-0 grid-cols-1 gap-4",
              sourcePanel ? matchWorkspaceSideBySideColumnsClass : "",
            )}
          >
            <div className="order-2 grid min-w-0 gap-4 @min-[79rem]/match-editor:order-none">
              <ScoreSectionSkeleton />
              {mode === "edit" ? null : (
                <div className="grid gap-2">
                  <div className="grid gap-1">
                    <Skeleton className="h-5 w-32" />
                    <Skeleton className="h-4 w-full max-w-80" />
                  </div>
                  <Skeleton className="h-24 w-full rounded-sm" />
                </div>
              )}
            </div>
            {sourcePanel ? (
              <div className="order-1 @min-[79rem]/match-editor:order-none">
                <SourcePanelSkeleton />
              </div>
            ) : null}
          </div>
        </div>
        <div className={taskActionPanelClass}>
          <div className="grid gap-x-4 gap-y-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <Skeleton className="h-[3.125rem] w-40 rounded-sm sm:col-start-2" />
          </div>
        </div>
      </div>
    </PageContentSurface>
  );
}

/** Same 12-column spans as the setup fields, which a new match shows open from the start. */
const setupFieldSpans = [
  ["heldEvent", "lg:col-span-5"],
  ["matchNo", "lg:col-span-2"],
  ["playedAt", "lg:col-span-5"],
  ["gameTitle", "lg:col-span-3"],
  ["season", "lg:col-span-3"],
  ["map", "lg:col-span-3"],
  ["owner", "lg:col-span-3"],
] as const;

function SetupFieldsSkeleton() {
  return (
    <div className="mt-3 grid gap-4 px-3">
      <div className="grid gap-4 lg:grid-cols-12">
        {setupFieldSpans.map(([field, spanClass]) => (
          <div key={field} className={cn("grid gap-2", spanClass)}>
            <Skeleton className="h-5 w-24" />
            <Skeleton className={controlSkeletonHeightClass} />
          </div>
        ))}
      </div>
      <div className="flex min-h-11 items-center px-3 pointer-fine:min-h-10">
        <Skeleton className="h-5 w-48" />
      </div>
    </div>
  );
}

/** The table and the cards switch at the same 70rem viewport width as the score grid. */
function ScoreSectionSkeleton() {
  return (
    <div className="grid min-w-0 gap-4">
      <div className="grid gap-1">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="hidden h-4 w-full max-w-xl min-[70rem]:block" />
      </div>
      <div className="hidden gap-2 py-2 min-[70rem]:grid">
        <Skeleton className="h-8 w-full" />
        {["player-a", "player-b", "player-c", "player-d"].map((id) => (
          <Skeleton key={id} className="h-[6.75rem] w-full rounded-md" />
        ))}
      </div>
      <div className="grid gap-4 min-[70rem]:hidden">
        <Skeleton className="h-[44rem] w-full rounded-md" />
        {["player-b", "player-c", "player-d"].map((id) => (
          <Skeleton key={id} className="h-[4.5rem] w-full rounded-md" />
        ))}
      </div>
    </div>
  );
}

function SourcePanelSkeleton() {
  return (
    <div className="grid gap-4 rounded-md border border-[var(--color-border)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="grid min-w-0 flex-[1_1_16rem] gap-1">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-4 w-full max-w-72" />
        </div>
        <Skeleton className="h-11 w-28 rounded-sm pointer-fine:h-9" />
      </div>
      <Skeleton className="h-11 w-full rounded-sm" />
      <div className="grid gap-2 rounded-sm border border-[var(--color-border)] p-3">
        <Skeleton className="aspect-video w-full" />
        <Skeleton className="h-11 w-full max-w-60 pointer-fine:h-9" />
      </div>
    </div>
  );
}
