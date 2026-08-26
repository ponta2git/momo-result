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
  actions,
  data,
  onCreate,
}: {
  actions: heldEventViewModel.HeldEventsListActions;
  data: heldEventViewModel.HeldEventsListModel;
  onCreate: () => void;
}) {
  return (
    <div className="grid min-w-0 gap-4">
      {data.loading ? (
        <HeldEventsLoading />
      ) : (
        <div
          className={cn(
            "grid min-w-0 gap-4 transition-opacity duration-[var(--motion-base)] motion-reduce:transition-none",
            data.refreshing ? "opacity-70" : "opacity-100",
          )}
        >
          {data.stale ? (
            <Notice
              action={
                <Button
                  pending={data.refreshing}
                  pendingLabel="再取得中"
                  size="sm"
                  variant="secondary"
                  onClick={actions.onRetry}
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
          {data.scopeChanging ? (
            <p className="text-xs text-[var(--color-text-secondary)]" role="status">
              現在は{data.page}ページ目（{data.pageSize}件表示）です。{data.requestedPage}
              ページ目（{data.requestedPageSize}件表示）を読み込んでいます。
            </p>
          ) : null}
          {data.loadFailed ? (
            <Notice tone="danger" title="開催履歴を読み込めません">
              <p>通信状態を確認して、もう一度お試しください。</p>
              <div className="mt-3">
                <Button
                  pending={data.refreshing}
                  pendingLabel="再読み込み中"
                  size="sm"
                  onClick={actions.onRetry}
                >
                  開催履歴を再読み込み
                </Button>
              </div>
            </Notice>
          ) : data.rows.length === 0 ? (
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
              actionsDisabled={data.scopeChanging}
              deleteDisabled={actions.deletePending || data.stale || data.scopeChanging}
              events={data.rows}
              firstRowIsLatest={data.page === 1}
              returnTo={data.returnTo}
              onDelete={actions.onRequestDelete}
            />
          )}

          {data.pagination && data.pagination.totalItems > 0 && !data.loadFailed ? (
            <PaginationControls
              className="p-0"
              disabled={data.refreshing}
              pageSizeOptions={[...heldEventViewModel.heldEventPageSizeOptions]}
              pagination={data.pagination}
              placement="embedded"
              onPageChange={actions.onPageChange}
              onPageSizeChange={actions.onPageSizeChange}
            />
          ) : null}
        </div>
      )}
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
