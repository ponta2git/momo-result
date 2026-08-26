import { CalendarPlus, RefreshCw } from "lucide-react";

import { CreateHeldEventDialog } from "@/features/heldEvents/CreateHeldEventDialog";
import { DeleteHeldEventDialog } from "@/features/heldEvents/DeleteHeldEventDialog";
import { HeldEventsListCard } from "@/features/heldEvents/HeldEventsListCard";
import { useHeldEventsPageController } from "@/features/heldEvents/useHeldEventsPageController";
import { Button } from "@/shared/ui/actions/Button";
import { Notice } from "@/shared/ui/feedback/Notice";
import { PageContentSurface } from "@/shared/ui/layout/PageContentSurface";
import { PageFrame } from "@/shared/ui/layout/PageFrame";
import { PageHeader } from "@/shared/ui/layout/PageHeader";

export function HeldEventsPage() {
  const page = useHeldEventsPageController();

  return (
    <PageFrame>
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
            {page.table.data.rows.length > 0 ? (
              <Button
                icon={<CalendarPlus aria-hidden="true" className="size-4" />}
                variant="secondary"
                onClick={page.header.openCreate}
              >
                開催を作成
              </Button>
            ) : null}
          </>
        }
        title="開催履歴"
      />

      <PageContentSurface
        aria-busy={page.table.data.refreshing || undefined}
        aria-label="開催履歴"
        className="grid gap-4"
        role="region"
      >
        {page.feedback.errorMessage && !page.create.open && !page.deleteDialog.target ? (
          <Notice tone="danger" title="操作に失敗しました">
            {page.feedback.errorMessage}
          </Notice>
        ) : null}

        <HeldEventsListCard
          actions={page.table.actions}
          data={page.table.data}
          onCreate={page.header.openCreate}
        />
      </PageContentSurface>

      <CreateHeldEventDialog model={page.create} />
      <DeleteHeldEventDialog model={page.deleteDialog} />
    </PageFrame>
  );
}
