import { CalendarPlus, RefreshCw } from "lucide-react";

import { CreateHeldEventDialog } from "@/features/heldEvents/list/CreateHeldEventDialog";
import { DeleteHeldEventDialog } from "@/features/heldEvents/list/DeleteHeldEventDialog";
import { HeldEventsListCard } from "@/features/heldEvents/list/HeldEventsListCard";
import { useHeldEvents } from "@/features/heldEvents/list/useHeldEvents";
import { UnsavedChangesGuard } from "@/shared/navigation/UnsavedChangesGuard";
import { actionRowClass } from "@/shared/ui/actions/actionGroup";
import { Button } from "@/shared/ui/actions/Button";
import { cn } from "@/shared/ui/cn";
import { Notice } from "@/shared/ui/feedback/Notice";
import { PageContentSurface } from "@/shared/ui/layout/PageContentSurface";
import { PageFrame } from "@/shared/ui/layout/PageFrame";

export function HeldEventsPage() {
  const heldEvents = useHeldEvents();

  return (
    <PageFrame>
      <UnsavedChangesGuard
        model={heldEvents.navigationGuard}
        pending={heldEvents.actionView.dialogPending}
        showPendingDialog={false}
      />
      <PageContentSurface aria-label="開催履歴" className="grid gap-4" role="region">
        <div aria-label="開催履歴の操作" className={cn(actionRowClass, "justify-end")} role="group">
          <Button
            icon={<RefreshCw aria-hidden="true" />}
            disabled={heldEvents.actionView.refreshDisabled}
            pending={heldEvents.actionView.refreshPending}
            pendingLabel="更新中…"
            size="sm"
            variant="quiet"
            onClick={heldEvents.refresh.run}
          >
            更新
          </Button>
          {heldEvents.actionView.showCreate ? (
            <Button
              icon={<CalendarPlus aria-hidden="true" />}
              variant="secondary"
              onClick={heldEvents.openCreate}
            >
              開催を作成
            </Button>
          ) : null}
        </div>

        {heldEvents.actionView.errorMessage ? (
          <Notice tone="danger" title="操作に失敗しました">
            {heldEvents.actionView.errorMessage}
          </Notice>
        ) : null}

        <HeldEventsListCard list={heldEvents.list} onCreate={heldEvents.openCreate} />
      </PageContentSurface>

      <CreateHeldEventDialog form={heldEvents.create} />
      <DeleteHeldEventDialog confirmation={heldEvents.deleteDialog} />
    </PageFrame>
  );
}
