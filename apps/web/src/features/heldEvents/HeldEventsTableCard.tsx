import { CalendarDays, Download, ListFilter, Trash2 } from "lucide-react";
import { useMemo } from "react";

import { formatDateKey, formatDateTime } from "@/features/heldEvents/heldEventViewModel";
import { heldEventPageSizeOptions } from "@/features/heldEvents/useHeldEventsPageController";
import type { HeldEventsPageController } from "@/features/heldEvents/useHeldEventsPageController";
import type { HeldEventResponse } from "@/shared/api/heldEvents";
import { Button } from "@/shared/ui/actions/Button";
import { LinkButton } from "@/shared/ui/actions/LinkButton";
import { DataTable } from "@/shared/ui/data/DataTable";
import type { DataTableColumn } from "@/shared/ui/data/DataTable";
import { PaginationControls } from "@/shared/ui/data/PaginationControls";
import { EmptyState } from "@/shared/ui/feedback/EmptyState";
import { Notice } from "@/shared/ui/feedback/Notice";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";
import { Card } from "@/shared/ui/layout/Card";

type HeldEventsTableCardProps = {
  deleteMutation: HeldEventsPageController["deleteMutation"];
  loadFailed: HeldEventsPageController["loadFailed"];
  loading: HeldEventsPageController["loading"];
  pagination: HeldEventsPageController["pagination"];
  refreshing: HeldEventsPageController["refreshing"];
  rows: HeldEventsPageController["rows"];
  setDeleteTarget: HeldEventsPageController["setDeleteTarget"];
  totalMatches: HeldEventsPageController["totalMatches"];
  updatePage: HeldEventsPageController["updatePage"];
  updatePageSize: HeldEventsPageController["updatePageSize"];
};

export function HeldEventsTableCard({
  deleteMutation,
  loadFailed,
  loading,
  pagination,
  refreshing,
  rows,
  setDeleteTarget,
  totalMatches,
  updatePage,
  updatePageSize,
}: HeldEventsTableCardProps) {
  const columns = useMemo<Array<DataTableColumn<HeldEventResponse>>>(
    () => [
      {
        header: "開催日時",
        key: "heldAt",
        minWidth: "14rem",
        renderCell: (event) => <HeldEventDateCell event={event} />,
      },
      {
        align: "right",
        header: "試合数",
        key: "matchCount",
        minWidth: "7rem",
        renderCell: (event) => (
          <span className="tabular-nums">{event.matchCount.toLocaleString()}試合</span>
        ),
      },
      {
        align: "right",
        header: "操作",
        key: "actions",
        minWidth: "17rem",
        renderCell: (event) => (
          <HeldEventActions
            deleteDisabled={deleteMutation.isPending}
            event={event}
            onDelete={setDeleteTarget}
          />
        ),
      },
    ],
    [deleteMutation.isPending, setDeleteTarget],
  );

  return (
    <Card className="min-w-0">
      <HeldEventsTableHeader
        eventCount={pagination?.totalItems ?? rows.length}
        totalMatches={totalMatches}
      />

      {loading ? (
        <HeldEventsLoading />
      ) : loadFailed ? (
        <Notice tone="danger" title="開催履歴を読み込めません">
          時間をおいて、再読み込みしてください。
        </Notice>
      ) : (
        <DataTable
          columns={columns}
          emptyState={<HeldEventsEmptyState />}
          getRowKey={(event) => event.id}
          rows={rows}
        />
      )}
      {pagination && pagination.totalItems > 0 && !loading && !loadFailed ? (
        <PaginationControls
          className="mt-3"
          disabled={refreshing}
          pageSizeOptions={[...heldEventPageSizeOptions]}
          pagination={pagination}
          onPageChange={updatePage}
          onPageSizeChange={updatePageSize}
        />
      ) : null}
    </Card>
  );
}

function HeldEventDateCell({ event }: { event: HeldEventResponse }) {
  return (
    <div className="grid gap-1">
      <span className="font-semibold">{formatDateTime(event.heldAt)}</span>
      <span className="text-xs text-[var(--color-text-secondary)]">
        {formatDateKey(event.heldAt)}
      </span>
    </div>
  );
}

function HeldEventActions({
  deleteDisabled,
  event,
  onDelete,
}: {
  deleteDisabled: boolean;
  event: HeldEventResponse;
  onDelete: (event: HeldEventResponse) => void;
}) {
  return (
    <div className="flex min-w-0 flex-wrap justify-end gap-2">
      <LinkButton
        icon={<ListFilter className="size-4" />}
        size="sm"
        to={`/matches?heldEventId=${encodeURIComponent(event.id)}`}
        variant="secondary"
      >
        試合
      </LinkButton>
      <LinkButton
        icon={<Download className="size-4" />}
        size="sm"
        to={`/exports?heldEventId=${encodeURIComponent(event.id)}&format=csv`}
        variant="secondary"
      >
        出力
      </LinkButton>
      {event.matchCount === 0 ? (
        <Button
          disabled={deleteDisabled}
          icon={<Trash2 className="size-4" />}
          size="sm"
          variant="quiet"
          onClick={() => onDelete(event)}
        >
          削除
        </Button>
      ) : (
        <span className="inline-flex min-h-9 items-center rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 py-1.5 text-sm font-semibold text-[var(--color-text-secondary)]">
          試合あり
        </span>
      )}
    </div>
  );
}

function HeldEventsTableHeader({
  eventCount,
  totalMatches,
}: {
  eventCount: number;
  totalMatches: number;
}) {
  return (
    <div className="mb-3 flex min-w-0 flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">開催回一覧</h2>
        <p className="momo-copy mt-1 text-sm text-[var(--color-text-secondary)]">
          試合がない開催回は削除できます。
        </p>
      </div>
      <div className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 py-2 text-sm tabular-nums">
        {eventCount.toLocaleString()}開催 / {totalMatches.toLocaleString()}試合
      </div>
    </div>
  );
}

function HeldEventsLoading() {
  return (
    <div className="grid gap-3">
      <Skeleton className="min-h-10" />
      <Skeleton className="min-h-24" />
      <Skeleton className="min-h-24" />
    </div>
  );
}

function HeldEventsEmptyState() {
  return (
    <EmptyState
      className="min-h-56"
      description="最初に開催回を作ります。試合は開催回に紐づけて記録します。"
      icon={<CalendarDays className="size-5" />}
      title="開催履歴はまだありません"
    />
  );
}
