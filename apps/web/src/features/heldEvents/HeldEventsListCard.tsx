import { ArrowRight, CalendarDays, Download, ListFilter, Plus, Trash2 } from "lucide-react";
import { motion } from "motion/react";
import { Link } from "react-router-dom";

import * as heldEventViewModel from "@/features/heldEvents/heldEventViewModel";
import type { HeldEventResponse } from "@/shared/api/heldEvents";
import { withReturnTo } from "@/shared/navigation/returnTo";
import { Button } from "@/shared/ui/actions/Button";
import { LinkButton } from "@/shared/ui/actions/LinkButton";
import { PaginationControls } from "@/shared/ui/data/PaginationControls";
import { EmptyState } from "@/shared/ui/feedback/EmptyState";
import { Notice } from "@/shared/ui/feedback/Notice";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";
import { Card } from "@/shared/ui/layout/Card";
import { momoTransition } from "@/shared/ui/motion/variants";

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
    <Card
      aria-busy={data.refreshing || undefined}
      aria-label="開催履歴"
      className="min-w-0 overflow-hidden p-0"
      role="region"
    >
      {data.loading ? (
        <HeldEventsLoading />
      ) : (
        <motion.div
          animate={{ opacity: data.refreshing ? 0.7 : 1 }}
          className="min-w-0"
          transition={momoTransition}
        >
          {data.loadFailed ? (
            <div className="p-4">
              <Notice tone="danger" title="開催履歴を読み込めません">
                時間をおいて、再読み込みしてください。
              </Notice>
            </div>
          ) : data.rows.length === 0 ? (
            <div className="p-4">
              <EmptyState
                description="開催を作ると、同じ日に行った試合を番号順にまとめられます。"
                icon={<CalendarDays className="size-5" />}
                title="開催履歴はまだありません"
                action={
                  <Button icon={<Plus aria-hidden="true" className="size-4" />} onClick={onCreate}>
                    最初の開催を作成
                  </Button>
                }
              />
            </div>
          ) : (
            <ol>
              {data.rows.map((event, index) => (
                <HeldEventRow
                  key={event.id}
                  deleteDisabled={actions.deletePending}
                  event={event}
                  latest={data.page === 1 && index === 0}
                  returnTo={data.returnTo}
                  onDelete={actions.onRequestDelete}
                />
              ))}
            </ol>
          )}

          {data.pagination && data.pagination.totalItems > 0 && !data.loadFailed ? (
            <PaginationControls
              className="border-t border-[var(--color-border)] px-4 py-3"
              disabled={data.refreshing}
              pageSizeOptions={[...heldEventViewModel.heldEventPageSizeOptions]}
              pagination={data.pagination}
              onPageChange={actions.onPageChange}
              onPageSizeChange={actions.onPageSizeChange}
            />
          ) : null}
        </motion.div>
      )}
    </Card>
  );
}

function HeldEventRow({
  deleteDisabled,
  event,
  latest,
  onDelete,
  returnTo,
}: {
  deleteDisabled: boolean;
  event: HeldEventResponse;
  latest: boolean;
  onDelete: (event: HeldEventResponse) => void;
  returnTo: string;
}) {
  const encodedId = encodeURIComponent(event.id);
  const canDelete = event.matchCount === 0 && event.draftCount === 0;
  return (
    <li className="border-b border-[var(--color-border)] last:border-b-0">
      <article className="grid gap-3 px-4 py-3 lg:grid-cols-[minmax(15rem,1fr)_minmax(12rem,16rem)_auto] lg:items-center">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          {latest ? (
            <span className="rounded-[var(--radius-xs)] border border-[var(--color-border-strong)] px-2 py-0.5 text-xs font-semibold text-[var(--color-text-secondary)]">
              最新
            </span>
          ) : null}
          <h3 className="min-w-0">
            <Link
              aria-label={`${heldEventViewModel.formatDateTime(event.heldAt)}の開催詳細`}
              className="momo-heading inline-flex min-h-11 min-w-0 items-center gap-2 text-base font-semibold text-[var(--color-text-primary)] underline-offset-4 hover:underline"
              to={withReturnTo(`/held-events/${encodedId}`, returnTo)}
            >
              <span className="truncate tabular-nums">
                {heldEventViewModel.formatDateTime(event.heldAt)}
              </span>
              <ArrowRight aria-hidden="true" className="size-4 shrink-0" />
            </Link>
          </h3>
        </div>

        <dl className="grid grid-cols-2 divide-x divide-[var(--color-border)] overflow-hidden rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)]">
          <div className="min-w-0 px-3 py-2">
            <dt className="momo-label text-[var(--color-text-secondary)]">確定済み</dt>
            <dd className="mt-1 text-sm font-semibold tabular-nums">{event.matchCount}試合</dd>
          </div>
          <div className="min-w-0 px-3 py-2">
            <dt className="momo-label text-[var(--color-text-secondary)]">未完了</dt>
            <dd className="mt-1 text-sm font-semibold tabular-nums">{event.draftCount}件</dd>
          </div>
        </dl>

        <div className="flex min-w-0 flex-wrap items-center gap-2 lg:justify-end">
          <LinkButton
            aria-label={`${heldEventViewModel.formatDateTime(event.heldAt)}の試合を検索`}
            icon={<ListFilter aria-hidden="true" className="size-4" />}
            size="sm"
            to={withReturnTo(`/matches?heldEventId=${encodedId}&sort=match_no_asc`, returnTo)}
            variant="quiet"
          >
            試合検索
          </LinkButton>
          <LinkButton
            aria-label={`${heldEventViewModel.formatDateTime(event.heldAt)}をCSV出力`}
            icon={<Download aria-hidden="true" className="size-4" />}
            size="sm"
            to={withReturnTo(`/exports?heldEventId=${encodedId}&format=csv`, returnTo)}
            variant="quiet"
          >
            出力
          </LinkButton>
          {canDelete ? (
            <Button
              aria-label={`${heldEventViewModel.formatDateTime(event.heldAt)}を削除`}
              disabled={deleteDisabled}
              icon={<Trash2 aria-hidden="true" className="size-4" />}
              size="sm"
              variant="quiet"
              onClick={() => onDelete(event)}
            >
              削除
            </Button>
          ) : null}
        </div>
      </article>
    </li>
  );
}

function HeldEventsLoading() {
  return (
    <div aria-label="開催履歴を読み込み中" className="grid gap-0" role="status">
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
