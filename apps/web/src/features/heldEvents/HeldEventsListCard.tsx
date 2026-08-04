import { ArrowRight, CalendarDays, Download, ListFilter, Plus, Trash2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Link } from "react-router-dom";

import * as heldEventViewModel from "@/features/heldEvents/heldEventViewModel";
import type { HeldEventResponse } from "@/shared/api/heldEvents";
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
  const eventCount = data.pagination?.totalItems ?? data.rows.length;
  return (
    <Card className="min-w-0 overflow-hidden p-0">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3 border-b border-[var(--color-border)] px-4 py-3">
        <div>
          <h2 className="momo-heading text-lg font-semibold">開催回一覧</h2>
          <p className="momo-copy mt-1 text-sm text-[var(--color-text-secondary)]">
            開催を開くと、試合順の結果・この回の戦績・未完了作業をまとめて確認できます。
          </p>
        </div>
        <p className="shrink-0 rounded-[var(--radius-xs)] bg-[var(--color-surface-subtle)] px-2.5 py-1.5 text-sm font-semibold tabular-nums">
          {eventCount.toLocaleString()}開催 / {data.totalMatches.toLocaleString()}試合
        </p>
      </div>

      {data.loading ? (
        <HeldEventsLoading />
      ) : data.loadFailed ? (
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
          <AnimatePresence initial={false}>
            {data.rows.map((event, index) => (
              <HeldEventRow
                key={event.id}
                deleteDisabled={actions.deletePending}
                event={event}
                latest={data.page === 1 && index === 0}
                onDelete={actions.onRequestDelete}
              />
            ))}
          </AnimatePresence>
        </ol>
      )}

      {data.pagination && data.pagination.totalItems > 0 && !data.loading && !data.loadFailed ? (
        <PaginationControls
          className="border-t border-[var(--color-border)] px-4 py-3"
          disabled={data.refreshing}
          pageSizeOptions={[...heldEventViewModel.heldEventPageSizeOptions]}
          pagination={data.pagination}
          onPageChange={actions.onPageChange}
          onPageSizeChange={actions.onPageSizeChange}
        />
      ) : null}
    </Card>
  );
}

function HeldEventRow({
  deleteDisabled,
  event,
  latest,
  onDelete,
}: {
  deleteDisabled: boolean;
  event: HeldEventResponse;
  latest: boolean;
  onDelete: (event: HeldEventResponse) => void;
}) {
  const encodedId = encodeURIComponent(event.id);
  const canDelete = event.matchCount === 0 && event.draftCount === 0;
  return (
    <motion.li
      layout="position"
      className="border-b border-[var(--color-border)] last:border-b-0"
      exit={{ opacity: 0, y: -4 }}
      transition={momoTransition}
    >
      <article className="grid gap-4 px-4 py-4 lg:grid-cols-[minmax(15rem,1fr)_minmax(18rem,1.2fr)_auto] lg:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {latest ? (
              <span className="rounded-[var(--radius-xs)] border border-[var(--color-border-strong)] px-2 py-0.5 text-xs font-semibold text-[var(--color-text-secondary)]">
                最新
              </span>
            ) : null}
            <span className="text-xs text-[var(--color-text-secondary)] tabular-nums">
              {heldEventViewModel.formatDateKey(event.heldAt)}
            </span>
          </div>
          <h3 className="mt-1 min-w-0">
            <Link
              className="momo-heading text-base font-semibold text-[var(--color-text-primary)] underline-offset-4 hover:underline"
              to={`/held-events/${encodedId}`}
            >
              {heldEventViewModel.formatDateTime(event.heldAt)}
            </Link>
          </h3>
        </div>

        <dl className="grid grid-cols-3 gap-3 rounded-[var(--radius-sm)] bg-[var(--color-surface-subtle)] px-3 py-2.5">
          <div>
            <dt className="momo-label text-[var(--color-text-secondary)]">確定</dt>
            <dd className="mt-1 text-sm font-semibold tabular-nums">{event.matchCount}試合</dd>
          </div>
          <div>
            <dt className="momo-label text-[var(--color-text-secondary)]">未完了</dt>
            <dd className="mt-1 text-sm font-semibold tabular-nums">{event.draftCount}件</dd>
          </div>
          <div>
            <dt className="momo-label text-[var(--color-text-secondary)]">次の番号</dt>
            <dd className="mt-1 text-sm font-semibold tabular-nums">第{event.nextMatchNo}試合</dd>
          </div>
        </dl>

        <div className="flex min-w-0 flex-wrap items-center gap-2 lg:justify-end">
          <LinkButton
            icon={<ArrowRight aria-hidden="true" className="size-4" />}
            size="sm"
            to={`/held-events/${encodedId}`}
          >
            詳細を見る
          </LinkButton>
          <LinkButton
            aria-label={`${heldEventViewModel.formatDateTime(event.heldAt)}の試合を検索`}
            icon={<ListFilter aria-hidden="true" className="size-4" />}
            size="sm"
            to={`/matches?heldEventId=${encodedId}`}
            variant="quiet"
          >
            試合検索
          </LinkButton>
          <LinkButton
            aria-label={`${heldEventViewModel.formatDateTime(event.heldAt)}をCSV出力`}
            icon={<Download aria-hidden="true" className="size-4" />}
            size="sm"
            to={`/exports?heldEventId=${encodedId}&format=csv`}
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
    </motion.li>
  );
}

function HeldEventsLoading() {
  return (
    <div aria-label="開催履歴を読み込み中" className="grid gap-0" role="status">
      {["first", "second", "third"].map((id) => (
        <div
          key={id}
          className="grid gap-3 border-b border-[var(--color-border)] p-4 last:border-b-0 lg:grid-cols-3"
        >
          <Skeleton className="h-12" />
          <Skeleton className="h-14" />
          <Skeleton className="h-10" />
        </div>
      ))}
    </div>
  );
}
