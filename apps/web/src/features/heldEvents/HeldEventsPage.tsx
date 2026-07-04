import { RefreshCw } from "lucide-react";

import { CreateHeldEventCard } from "@/features/heldEvents/CreateHeldEventCard";
import { DeleteHeldEventDialog } from "@/features/heldEvents/DeleteHeldEventDialog";
import { HeldEventLatestCard } from "@/features/heldEvents/HeldEventLatestCard";
import { HeldEventsTableCard } from "@/features/heldEvents/HeldEventsTableCard";
import { useHeldEventsPageController } from "@/features/heldEvents/useHeldEventsPageController";
import { Button } from "@/shared/ui/actions/Button";
import { LiveRegion } from "@/shared/ui/feedback/LiveRegion";
import { Notice } from "@/shared/ui/feedback/Notice";
import { PageFrame } from "@/shared/ui/layout/PageFrame";
import { PageHeader } from "@/shared/ui/layout/PageHeader";

export function HeldEventsPage() {
  const page = useHeldEventsPageController();

  return (
    <PageFrame className="gap-5">
      <LiveRegion message={page.feedback.liveMessage} />
      <PageHeader
        actions={
          <Button
            icon={<RefreshCw className="size-4" />}
            pending={page.header.refreshing}
            pendingLabel="更新中…"
            variant="quiet"
            onClick={page.header.refresh}
          >
            最新情報に更新
          </Button>
        }
        description="開催回を作り、試合一覧と出力範囲の基準にします。"
        eyebrow="開催"
        title="開催履歴"
      />

      {page.feedback.errorMessage ? (
        <Notice tone="danger" title="操作に失敗しました">
          {page.feedback.errorMessage}
        </Notice>
      ) : null}

      <HeldEventLatestCard event={page.latest.event} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <HeldEventsTableCard actions={page.table.actions} data={page.table.data} />

        <CreateHeldEventCard model={page.create} />
      </div>

      <DeleteHeldEventDialog model={page.deleteDialog} />
    </PageFrame>
  );
}
