import { CalendarDays, Plus } from "lucide-react";

import { HeldEventsLedger } from "@/features/heldEvents/HeldEventsLedger";
import * as heldEventViewModel from "@/features/heldEvents/heldEventViewModel";
import { Button } from "@/shared/ui/actions/Button";
import { cn } from "@/shared/ui/cn";
import { PaginationControls } from "@/shared/ui/data/PaginationControls";
import { EmptyState } from "@/shared/ui/feedback/EmptyState";
import { Notice } from "@/shared/ui/feedback/Notice";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";

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
      <Notice tone="danger" title="開催履歴を読み込めません">
        <p>通信状態を確認して、もう一度お試しください。</p>
        <div className="mt-3">
          <Button
            pending={model.refresh.pending}
            pendingLabel="再読み込み中"
            size="sm"
            onClick={model.refresh.run}
          >
            開催履歴を再読み込み
          </Button>
        </div>
      </Notice>
    );
  }

  return (
    <div className="grid min-w-0 gap-4">
      <div
        className={cn("grid min-w-0 gap-4", model.refresh.pending ? "opacity-70" : "opacity-100")}
      >
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
        {model.scopeChanging ? (
          <p className="text-xs text-[var(--color-text-secondary)]" role="status">
            現在は{model.page}ページ目（{model.pageSize}件表示）です。{model.requestedPage}
            ページ目（{model.requestedPageSize}件表示）を読み込んでいます。
          </p>
        ) : null}
        {model.rows.length === 0 ? (
          <EmptyState
            action={
              <Button icon={<Plus aria-hidden="true" className="size-4" />} onClick={onCreate}>
                最初の開催を作成
              </Button>
            }
            description="開催を作ると、同じ日に行った試合を番号順にまとめられます。"
            icon={<CalendarDays className="size-5" />}
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
            disabled={model.refresh.pending}
            pageSizeOptions={[...heldEventViewModel.heldEventPageSizeOptions]}
            pagination={model.pagination}
            placement="embedded"
            onPageChange={model.onPageChange}
            onPageSizeChange={model.onPageSizeChange}
          />
        ) : null}
      </div>
    </div>
  );
}

function HeldEventsLoading() {
  return (
    <div
      aria-label="開催履歴を読み込み中"
      className="grid gap-0 overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)]"
      role="status"
    >
      {["first", "second", "third"].map((id) => (
        <div
          key={id}
          className="grid gap-3 border-b border-[var(--color-border)] p-4 last:border-b-0 lg:grid-cols-[minmax(15rem,1fr)_minmax(12rem,16rem)_auto]"
        >
          <Skeleton className="h-11" />
          <Skeleton className="h-13" />
          <Skeleton className="h-10" />
        </div>
      ))}
    </div>
  );
}
