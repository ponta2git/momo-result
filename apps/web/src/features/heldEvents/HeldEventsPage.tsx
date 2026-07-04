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
  const controller = useHeldEventsPageController();
  const {
    createAction,
    createState,
    deleteMutation,
    deleteTarget,
    errorMessage,
    heldAtDraft,
    latestEvent,
    liveMessage,
    loadFailed,
    loading,
    pagination,
    refresh,
    refreshing,
    rows,
    setDeleteTarget,
    setHeldAtDraft,
    totalMatches,
    updatePage,
    updatePageSize,
  } = controller;

  return (
    <PageFrame className="gap-5">
      <LiveRegion message={liveMessage} />
      <PageHeader
        actions={
          <Button
            icon={<RefreshCw className="size-4" />}
            pending={refreshing}
            pendingLabel="更新中…"
            variant="quiet"
            onClick={refresh}
          >
            最新情報に更新
          </Button>
        }
        description="開催回を作り、試合一覧と出力範囲の基準にします。"
        eyebrow="開催"
        title="開催履歴"
      />

      {errorMessage ? (
        <Notice tone="danger" title="操作に失敗しました">
          {errorMessage}
        </Notice>
      ) : null}

      <HeldEventLatestCard latestEvent={latestEvent} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <HeldEventsTableCard
          deleteMutation={deleteMutation}
          loadFailed={loadFailed}
          loading={loading}
          pagination={pagination}
          refreshing={refreshing}
          rows={rows}
          setDeleteTarget={setDeleteTarget}
          totalMatches={totalMatches}
          updatePage={updatePage}
          updatePageSize={updatePageSize}
        />

        <CreateHeldEventCard
          createAction={createAction}
          createState={createState}
          heldAtDraft={heldAtDraft}
          setHeldAtDraft={setHeldAtDraft}
        />
      </div>

      <DeleteHeldEventDialog
        deleteMutation={deleteMutation}
        deleteTarget={deleteTarget}
        setDeleteTarget={setDeleteTarget}
      />
    </PageFrame>
  );
}
