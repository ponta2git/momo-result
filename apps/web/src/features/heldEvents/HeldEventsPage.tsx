import { CalendarPlus, RefreshCw } from "lucide-react";

import { CreateHeldEventDialog } from "@/features/heldEvents/CreateHeldEventDialog";
import { DeleteHeldEventDialog } from "@/features/heldEvents/DeleteHeldEventDialog";
import { HeldEventsListCard } from "@/features/heldEvents/HeldEventsListCard";
import { useHeldEventsPageController } from "@/features/heldEvents/useHeldEventsPageController";
import { Button } from "@/shared/ui/actions/Button";
import { LiveRegion } from "@/shared/ui/feedback/LiveRegion";
import { Notice } from "@/shared/ui/feedback/Notice";
import { PageFrame } from "@/shared/ui/layout/PageFrame";
import { PageHeader } from "@/shared/ui/layout/PageHeader";

export function HeldEventsPage() {
  const page = useHeldEventsPageController();

  return (
    <PageFrame>
      <LiveRegion message={page.feedback.liveMessage} />
      <PageHeader
        actions={
          <>
            <Button
              icon={<RefreshCw aria-hidden="true" className="size-4" />}
              pending={page.header.refreshing}
              pendingLabel="更新中…"
              size="sm"
              variant="quiet"
              onClick={page.header.refresh}
            >
              更新
            </Button>
            <Button
              icon={<CalendarPlus aria-hidden="true" className="size-4" />}
              onClick={page.header.openCreate}
            >
              開催を作成
            </Button>
          </>
        }
        title="開催履歴"
      />

      {page.feedback.errorMessage && !page.create.open ? (
        <Notice tone="danger" title="操作に失敗しました">
          {page.feedback.errorMessage}
        </Notice>
      ) : null}

      <HeldEventsListCard
        actions={page.table.actions}
        data={page.table.data}
        onCreate={page.header.openCreate}
      />

      <CreateHeldEventDialog model={page.create} />
      <DeleteHeldEventDialog model={page.deleteDialog} />
    </PageFrame>
  );
}
