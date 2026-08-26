import { CalendarPlus, RefreshCw } from "lucide-react";

import { CreateHeldEventDialog } from "@/features/heldEvents/CreateHeldEventDialog";
import { DeleteHeldEventDialog } from "@/features/heldEvents/DeleteHeldEventDialog";
import { HeldEventsListCard } from "@/features/heldEvents/HeldEventsListCard";
import { useHeldEventsPageController } from "@/features/heldEvents/useHeldEventsPageController";
import { Button } from "@/shared/ui/actions/Button";
import { Notice } from "@/shared/ui/feedback/Notice";
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

      {page.feedback.errorMessage && !page.create.open && !page.deleteDialog.target ? (
        <Notice tone="danger" title="操作に失敗しました">
          {page.feedback.errorMessage}
        </Notice>
      ) : null}

      {page.feedback.refreshFailed ? (
        <Notice
          tone="warning"
          title="開催履歴を更新できませんでした"
          action={
            <Button
              pending={page.header.refreshing}
              pendingLabel="再取得中"
              size="sm"
              variant="secondary"
              onClick={page.header.refresh}
            >
              開催履歴を再取得
            </Button>
          }
        >
          前回取得した開催履歴を表示しています。開催詳細への移動や出力は利用できますが、削除は最新状態を確認できるまで行えません。
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
