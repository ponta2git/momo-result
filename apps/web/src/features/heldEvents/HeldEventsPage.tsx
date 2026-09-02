import { CalendarPlus, RefreshCw } from "lucide-react";

import { CreateHeldEventDialog } from "@/features/heldEvents/CreateHeldEventDialog";
import { DeleteHeldEventDialog } from "@/features/heldEvents/DeleteHeldEventDialog";
import { HeldEventsListCard } from "@/features/heldEvents/HeldEventsListCard";
import { useHeldEventsPageModel } from "@/features/heldEvents/useHeldEventsPageModel";
import { Button } from "@/shared/ui/actions/Button";
import { Notice } from "@/shared/ui/feedback/Notice";
import { PageContentSurface } from "@/shared/ui/layout/PageContentSurface";
import { PageFrame } from "@/shared/ui/layout/PageFrame";
import { PageHeader } from "@/shared/ui/layout/PageHeader";

export function HeldEventsPage() {
  const page = useHeldEventsPageModel();

  return (
    <PageFrame>
      <PageHeader
        actions={
          <>
            <Button
              icon={<RefreshCw aria-hidden="true" />}
              pending={page.refresh.pending}
              pendingLabel="更新中…"
              size="sm"
              variant="quiet"
              onClick={page.refresh.run}
            >
              更新
            </Button>
            {page.list.kind === "ready" && page.list.rows.length > 0 ? (
              <Button
                icon={<CalendarPlus aria-hidden="true" />}
                variant="secondary"
                onClick={page.openCreate}
              >
                開催を作成
              </Button>
            ) : null}
          </>
        }
        title="開催履歴"
      />

      <PageContentSurface
        aria-busy={page.refresh.pending || undefined}
        aria-label="開催履歴"
        className="grid gap-4"
        role="region"
      >
        {page.feedback.errorMessage && !page.create.open && !page.deleteDialog.target ? (
          <Notice tone="danger" title="操作に失敗しました">
            {page.feedback.errorMessage}
          </Notice>
        ) : null}

        <HeldEventsListCard model={page.list} onCreate={page.openCreate} />
      </PageContentSurface>

      <CreateHeldEventDialog model={page.create} />
      <DeleteHeldEventDialog model={page.deleteDialog} />
    </PageFrame>
  );
}
