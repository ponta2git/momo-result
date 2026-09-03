import { CalendarDays, Plus } from "lucide-react";

import { HeldEventsLedger } from "@/features/heldEvents/HeldEventsLedger";
import * as heldEventViewModel from "@/features/heldEvents/heldEventViewModel";
import { Button } from "@/shared/ui/actions/Button";
import { PaginationControls } from "@/shared/ui/data/PaginationControls";
import { EmptyState } from "@/shared/ui/feedback/EmptyState";
import { Notice } from "@/shared/ui/feedback/Notice";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";
import { StaleShield } from "@/shared/ui/motion/StaleShield";

export function HeldEventsListCard({
  model,
  onCreate,
}: {
  model: heldEventViewModel.HeldEventsListModel;
  onCreate: () => void;
}) {
  if (model.kind === "loading") {
    return <HeldEventsLoading />;
  }

  if (model.kind === "loadFailed") {
    return (
      <Notice
        action={
          <Button
            pending={model.refresh.pending}
            pendingLabel="再読み込み中"
            size="sm"
            onClick={model.refresh.run}
          >
            開催履歴を再読み込み
          </Button>
        }
        tone="danger"
        title="開催履歴を読み込めません"
      >
        <p>通信状態を確認して、もう一度お試しください。</p>
      </Notice>
    );
  }

  return (
    <StaleShield
      active={model.refresh.pending}
      busyLabel="開催履歴を更新中"
      fallback={<HeldEventsLoading />}
      strategy={model.scopeChanging ? "preserve-inert" : "preserve-interactive"}
    >
      <div className="grid min-w-0 gap-4">
        {model.freshness === "stale" ? (
          <Notice
            action={
              <Button
                pending={model.refresh.pending}
                pendingLabel="再取得中"
                size="sm"
                variant="secondary"
                onClick={model.refresh.run}
              >
                開催履歴を再取得
              </Button>
            }
            tone="warning"
            title="開催履歴を更新できませんでした"
          >
            前回取得した開催履歴を表示しています。開催詳細への移動や出力は利用できますが、削除は最新状態を確認できるまで行えません。
          </Notice>
        ) : null}
        {model.rows.length === 0 ? (
          <EmptyState
            action={
              <Button icon={<Plus aria-hidden="true" />} onClick={onCreate}>
                最初の開催を作成
              </Button>
            }
            description="開催を作ると、同じ日に行った試合を番号順にまとめられます。"
            icon={<CalendarDays />}
            placement="embedded"
            title="開催履歴はまだありません"
          />
        ) : (
          <HeldEventsLedger
            actionsDisabled={model.scopeChanging}
            deleteDisabled={
              model.deletePending || model.freshness === "stale" || model.scopeChanging
            }
            events={model.rows}
            firstRowIsLatest={model.page === 1}
            returnTo={model.returnTo}
            onDelete={model.onRequestDelete}
          />
        )}

        {model.pagination && model.pagination.totalItems > 0 ? (
          <PaginationControls
            disabled={model.scopeChanging}
            pageSizeOptions={[...heldEventViewModel.heldEventPageSizeOptions]}
            pagination={model.pagination}
            placement="embedded"
            onPageChange={model.onPageChange}
            onPageSizeChange={model.onPageSizeChange}
          />
        ) : null}
      </div>
    </StaleShield>
  );
}

function HeldEventsLoading() {
  return (
    <div
      aria-label="開催履歴を読み込み中"
      className="grid divide-y divide-[var(--color-border)] overflow-hidden rounded-md border border-[var(--color-border)]"
      role="status"
    >
      {["first", "second", "third"].map((id) => (
        <div
          key={id}
          className="grid gap-4 p-4 lg:grid-cols-[minmax(15rem,1fr)_minmax(12rem,16rem)_auto]"
        >
          <Skeleton className="h-11" />
          <Skeleton className="h-13" />
          <Skeleton className="h-10" />
        </div>
      ))}
    </div>
  );
}
