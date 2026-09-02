import { ArrowRight, Camera, Download, ListFilter, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";

import { heldEventOcrCaptureHref } from "@/features/heldEvents/heldEventNavigation";
import type { HeldEventResponse } from "@/shared/api/heldEvents";
import { formatDateTimeLong } from "@/shared/lib/dateTime";
import { useMediaQuery } from "@/shared/lib/useMediaQuery";
import { withReturnTo } from "@/shared/navigation/returnTo";
import { Button } from "@/shared/ui/actions/Button";
import { LinkButton } from "@/shared/ui/actions/LinkButton";
import { DataTable } from "@/shared/ui/data/DataTable";
import type { DataTableColumn } from "@/shared/ui/data/DataTable";

type HeldEventsLedgerProps = {
  actionsDisabled: boolean;
  deleteDisabled: boolean;
  events: HeldEventResponse[];
  firstRowIsLatest: boolean;
  onDelete: (event: HeldEventResponse) => void;
  returnTo: string;
};

export function HeldEventsLedger(props: HeldEventsLedgerProps) {
  const showDesktopTable = useMediaQuery("(min-width: 1024px)");

  return showDesktopTable ? <HeldEventsTable {...props} /> : <HeldEventsMobileList {...props} />;
}

function HeldEventsTable({
  actionsDisabled,
  deleteDisabled,
  events,
  firstRowIsLatest,
  onDelete,
  returnTo,
}: HeldEventsLedgerProps) {
  const latestEventId = firstRowIsLatest ? events[0]?.id : undefined;
  const columns: Array<DataTableColumn<HeldEventResponse>> = [
    {
      header: "開催日時",
      key: "heldAt",
      minWidth: "16rem",
      renderCell: (event) => (
        <HeldEventIdentity
          actionsDisabled={actionsDisabled}
          event={event}
          latest={event.id === latestEventId}
          returnTo={returnTo}
        />
      ),
      rowHeader: true,
    },
    {
      align: "right",
      header: "確定済み",
      key: "matchCount",
      renderCell: (event) => <span className="tabular-nums">{event.matchCount}試合</span>,
      width: "7rem",
    },
    {
      align: "right",
      header: "未確定下書き",
      key: "draftCount",
      renderCell: (event) => <span className="tabular-nums">{event.draftCount}件</span>,
      width: "9rem",
    },
    {
      align: "right",
      header: "操作",
      key: "actions",
      minWidth: "24rem",
      renderCell: (event) => (
        <HeldEventActions
          actionsDisabled={actionsDisabled}
          deleteDisabled={deleteDisabled}
          event={event}
          latest={event.id === latestEventId}
          returnTo={returnTo}
          onDelete={onDelete}
        />
      ),
    },
  ];

  return (
    <DataTable
      caption={{ content: "開催履歴" }}
      columns={columns}
      getRowKey={(event) => event.id}
      minWidth="58rem"
      rows={events}
      verticalAlign="middle"
    />
  );
}

function HeldEventsMobileList({
  actionsDisabled,
  deleteDisabled,
  events,
  firstRowIsLatest,
  onDelete,
  returnTo,
}: HeldEventsLedgerProps) {
  return (
    <ol className="divide-y divide-[var(--color-border)] overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)]">
      {events.map((event, index) => (
        <HeldEventRow
          key={event.id}
          actionsDisabled={actionsDisabled}
          deleteDisabled={deleteDisabled}
          event={event}
          latest={firstRowIsLatest && index === 0}
          returnTo={returnTo}
          onDelete={onDelete}
        />
      ))}
    </ol>
  );
}

function HeldEventRow({
  actionsDisabled,
  deleteDisabled,
  event,
  latest,
  onDelete,
  returnTo,
}: {
  actionsDisabled: boolean;
  deleteDisabled: boolean;
  event: HeldEventResponse;
  latest: boolean;
  onDelete: (event: HeldEventResponse) => void;
  returnTo: string;
}) {
  return (
    <li>
      <article className="grid gap-3 px-4 py-3">
        <HeldEventIdentity
          actionsDisabled={actionsDisabled}
          event={event}
          latest={latest}
          returnTo={returnTo}
        />
        <dl className="grid grid-cols-2 divide-x divide-[var(--color-border)] overflow-hidden rounded-[var(--radius-sm)] border border-[var(--color-border)]">
          <div className="min-w-0 px-3 py-2">
            <dt className="momo-label text-[var(--color-text-secondary)]">確定済み</dt>
            <dd className="mt-1 text-sm font-semibold tabular-nums">{event.matchCount}試合</dd>
          </div>
          <div className="min-w-0 px-3 py-2">
            <dt className="momo-label text-[var(--color-text-secondary)]">未確定下書き</dt>
            <dd className="mt-1 text-sm font-semibold tabular-nums">{event.draftCount}件</dd>
          </div>
        </dl>
        <HeldEventActions
          actionsDisabled={actionsDisabled}
          deleteDisabled={deleteDisabled}
          event={event}
          latest={latest}
          returnTo={returnTo}
          onDelete={onDelete}
        />
      </article>
    </li>
  );
}

function HeldEventIdentity({
  actionsDisabled,
  event,
  latest,
  returnTo,
}: {
  actionsDisabled: boolean;
  event: HeldEventResponse;
  latest: boolean;
  returnTo: string;
}) {
  const detailLabel = `${formatDateTimeLong(event.heldAt)}の開催詳細`;
  const detailContent = (
    <>
      <span className="truncate tabular-nums">{formatDateTimeLong(event.heldAt)}</span>
      <ArrowRight aria-hidden="true" className="size-4 shrink-0" />
    </>
  );
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      {latest ? (
        <span className="rounded-[var(--radius-xs)] border border-[var(--color-border-strong)] px-2 py-0.5 text-xs font-semibold text-[var(--color-text-secondary)]">
          最新
        </span>
      ) : null}
      {actionsDisabled ? (
        <span
          aria-disabled="true"
          aria-label={detailLabel}
          className="momo-heading inline-flex min-h-11 min-w-0 cursor-not-allowed items-center gap-2 text-base font-semibold text-[var(--color-text-primary)] opacity-60"
          role="link"
        >
          {detailContent}
        </span>
      ) : (
        <Link
          aria-label={detailLabel}
          className="momo-heading inline-flex min-h-11 min-w-0 items-center gap-2 text-base font-semibold text-[var(--color-text-primary)] underline-offset-4 hover:underline"
          to={withReturnTo(`/held-events/${encodeURIComponent(event.id)}`, returnTo)}
        >
          {detailContent}
        </Link>
      )}
    </div>
  );
}

function HeldEventActions({
  actionsDisabled,
  deleteDisabled,
  event,
  latest,
  onDelete,
  returnTo,
}: {
  actionsDisabled: boolean;
  deleteDisabled: boolean;
  event: HeldEventResponse;
  latest: boolean;
  onDelete: (event: HeldEventResponse) => void;
  returnTo: string;
}) {
  const encodedId = encodeURIComponent(event.id);
  const canDelete = event.matchCount === 0 && event.draftCount === 0;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2 md:justify-end">
      {latest ? (
        <LinkButton
          aria-label={`${formatDateTimeLong(event.heldAt)}の開催にOCR取り込み`}
          disabled={actionsDisabled}
          icon={<Camera aria-hidden="true" />}
          size="sm"
          to={heldEventOcrCaptureHref(event.id, returnTo)}
          variant="secondary"
        >
          OCR取り込み
        </LinkButton>
      ) : null}
      <LinkButton
        aria-label={`${formatDateTimeLong(event.heldAt)}の試合を検索`}
        disabled={actionsDisabled}
        icon={<ListFilter aria-hidden="true" />}
        size="sm"
        to={withReturnTo(`/matches?heldEventId=${encodedId}&sort=match_no_asc`, returnTo)}
        variant="quiet"
      >
        試合検索
      </LinkButton>
      <LinkButton
        aria-label={`${formatDateTimeLong(event.heldAt)}をCSV出力`}
        disabled={actionsDisabled}
        icon={<Download aria-hidden="true" />}
        size="sm"
        to={withReturnTo(`/exports?heldEventId=${encodedId}&format=csv`, returnTo)}
        variant="quiet"
      >
        出力
      </LinkButton>
      {canDelete ? (
        <Button
          aria-label={`${formatDateTimeLong(event.heldAt)}を削除`}
          disabled={deleteDisabled}
          icon={<Trash2 aria-hidden="true" />}
          size="sm"
          variant="quiet"
          onClick={() => onDelete(event)}
        >
          削除
        </Button>
      ) : null}
    </div>
  );
}
