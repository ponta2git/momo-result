import { Skeleton } from "@/shared/ui/feedback/Skeleton";
import { PageContentSurface } from "@/shared/ui/layout/PageContentSurface";
import { PageFrame } from "@/shared/ui/layout/PageFrame";
import { PageHeader } from "@/shared/ui/layout/PageHeader";
import { workspaceSampleHeaderStatus } from "@/shared/workflows/matchWorkspacePresentation";

export function MatchWorkspaceLoading({
  description,
  sample = false,
  title = "試合フォームを読み込み中",
}: {
  description: string;
  sample?: boolean;
  title?: string;
}) {
  return (
    <PageFrame aria-busy="true" aria-label={title} width="workspace">
      <PageHeader
        actions={<Skeleton className="h-11 w-32 max-w-full rounded-sm pointer-fine:h-9" />}
        description={description}
        descriptionStatus={sample ? workspaceSampleHeaderStatus : undefined}
        title={title}
      />

      <PageContentSurface aria-label="試合内容" className="grid gap-6" role="region">
        <div className="grid gap-4 md:grid-cols-4">
          <Skeleton className="h-11 pointer-fine:h-10" />
          <Skeleton className="h-11 pointer-fine:h-10" />
          <Skeleton className="h-11 pointer-fine:h-10" />
          <Skeleton className="h-11 pointer-fine:h-10" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {["player-a", "player-b", "player-c", "player-d"].map((id) => (
            <div key={id} className="grid gap-4 rounded-sm border border-[var(--color-border)] p-4">
              <Skeleton className="h-6 w-2/3" />
              <Skeleton className="h-11 pointer-fine:h-10" />
              <Skeleton className="h-11 pointer-fine:h-10" />
              <Skeleton className="h-11 pointer-fine:h-10" />
            </div>
          ))}
        </div>
      </PageContentSurface>
    </PageFrame>
  );
}
