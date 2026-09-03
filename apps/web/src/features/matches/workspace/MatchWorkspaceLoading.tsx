import { Skeleton } from "@/shared/ui/feedback/Skeleton";
import { PageContentSurface } from "@/shared/ui/layout/PageContentSurface";
import { PageFrame } from "@/shared/ui/layout/PageFrame";
import { PageHeader } from "@/shared/ui/layout/PageHeader";

export function MatchWorkspaceLoading({
  description = "試合内容を取得しています。",
  title = "試合フォームを読み込み中",
}: {
  description?: string;
  title?: string;
}) {
  return (
    <PageFrame aria-busy="true" aria-label={title} className="gap-4" width="workspace">
      <PageHeader description={description} title={title} />

      <PageContentSurface className="grid gap-6">
        <div className="grid gap-3 md:grid-cols-4">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {["player-a", "player-b", "player-c", "player-d"].map((id) => (
            <div key={id} className="grid gap-3 rounded-sm border border-[var(--color-border)] p-3">
              <Skeleton className="h-6 w-2/3" />
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
          ))}
        </div>
      </PageContentSurface>
    </PageFrame>
  );
}
