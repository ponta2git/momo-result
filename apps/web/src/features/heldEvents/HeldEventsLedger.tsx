import { Camera, ClipboardList, Download, Trash2 } from "lucide-react";

import { heldEventOcrCaptureHref } from "@/features/heldEvents/heldEventNavigation";
import type { HeldEventResponse } from "@/shared/api/heldEvents";
import { formatDateTimeLong } from "@/shared/lib/dateTime";
import { useMediaQuery } from "@/shared/lib/useMediaQuery";
import { withReturnTo } from "@/shared/navigation/returnTo";
import { IconButton } from "@/shared/ui/actions/IconButton";
import { IconLink } from "@/shared/ui/actions/IconLink";
import { cn } from "@/shared/ui/cn";
import { DataTable } from "@/shared/ui/data/DataTable";
import type { DataTableColumn } from "@/shared/ui/data/DataTable";
import { FactList } from "@/shared/ui/data/FactList";
import { contentText } from "@/shared/ui/typography";

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
        <HeldEventIdentity event={event} latest={event.id === latestEventId} />
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
    ...(latestEventId
      ? [
          {
            align: "center" as const,
            header: "OCR",
            key: "capture",
            width: "4.5rem",
            renderCell: (event: HeldEventResponse) =>
              event.id === latestEventId ? (
                <HeldEventCaptureLink
                  disabled={actionsDisabled}
                  event={event}
                  returnTo={returnTo}
                />
              ) : null,
          },
        ]
      : []),
    {
      align: "center",
      header: "結果",
      key: "detail",
      width: "4.5rem",
      renderCell: (event) => (
        <HeldEventResultLink disabled={actionsDisabled} event={event} returnTo={returnTo} />
      ),
    },
    {
      align: "center",
      header: "出力",
      key: "export",
      width: "4.5rem",
      renderCell: (event) => (
        <HeldEventExportLink disabled={actionsDisabled} event={event} returnTo={returnTo} />
      ),
    },
    ...(events.some(canDeleteHeldEvent)
      ? [
          {
            align: "center" as const,
            header: "削除",
            key: "delete",
            width: "4.5rem",
            renderCell: (event: HeldEventResponse) => (
              <HeldEventDeleteButton disabled={deleteDisabled} event={event} onDelete={onDelete} />
            ),
          },
        ]
      : []),
  ];

  return (
    <DataTable
      caption={{ content: "開催履歴" }}
      columns={columns}
      getRowKey={(event) => event.id}
      minWidth="50rem"
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
    <ol className="divide-y divide-[var(--color-border)] overflow-hidden rounded-md border border-[var(--color-border)]">
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
      <article className="grid gap-4 p-4">
        <HeldEventIdentity event={event} latest={latest} />
        <FactList
          ariaLabel="開催の記録件数"
          columns={2}
          layout="plain"
          items={[
            { id: "matches", label: "確定済み", value: `${event.matchCount}試合` },
            { id: "drafts", label: "未確定下書き", value: `${event.draftCount}件` },
          ]}
        />
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

function HeldEventIdentity({ event, latest }: { event: HeldEventResponse; latest: boolean }) {
  return (
    <div className="grid min-w-0 gap-1">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        {latest ? (
          <span
            className={cn(
              contentText.supporting,
              "rounded-xs border border-[var(--color-border-strong)] px-2 py-0.5",
            )}
          >
            最新
          </span>
        ) : null}
        <time className={cn(contentText.body, "truncate tabular-nums")} dateTime={event.heldAt}>
          {formatDateTimeLong(event.heldAt)}
        </time>
      </div>
      {(event.scopes?.length ?? 0) > 0 ? (
        <ul
          aria-label="開催のシリーズ・シーズン"
          className={cn(contentText.supporting, "grid gap-1")}
        >
          {event.scopes?.map((scope) => (
            <li key={`${scope.gameTitleId ?? ""}:${scope.seasonMasterId ?? ""}`}>
              {scope.gameTitleName ?? (scope.gameTitleId ? "作品名未取得" : "作品未設定")}・
              {scope.seasonName ?? (scope.seasonMasterId ? "シーズン名未取得" : "シーズン未設定")}
            </li>
          ))}
        </ul>
      ) : null}
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
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2 md:justify-end">
      {latest ? (
        <HeldEventCaptureLink disabled={actionsDisabled} event={event} returnTo={returnTo} />
      ) : null}
      <HeldEventResultLink disabled={actionsDisabled} event={event} returnTo={returnTo} />
      <HeldEventExportLink disabled={actionsDisabled} event={event} returnTo={returnTo} />
      <HeldEventDeleteButton disabled={deleteDisabled} event={event} onDelete={onDelete} />
    </div>
  );
}

type HeldEventLinkProps = {
  disabled: boolean;
  event: HeldEventResponse;
  returnTo: string;
};

function HeldEventCaptureLink({ disabled, event, returnTo }: HeldEventLinkProps) {
  return (
    <IconLink
      aria-label={`${formatDateTimeLong(event.heldAt)}の開催にOCR取り込み`}
      disabled={disabled}
      icon={<Camera />}
      to={heldEventOcrCaptureHref(event.id, returnTo)}
      tooltip="この開催にOCR取り込み"
      variant="quiet"
    />
  );
}

function HeldEventResultLink({ disabled, event, returnTo }: HeldEventLinkProps) {
  return (
    <IconLink
      aria-label={`${formatDateTimeLong(event.heldAt)}の開催詳細`}
      disabled={disabled}
      icon={<ClipboardList />}
      to={withReturnTo(`/held-events/${encodeURIComponent(event.id)}`, returnTo)}
      tooltip="開催結果を見る"
      variant="quiet"
    />
  );
}

function HeldEventExportLink({ disabled, event, returnTo }: HeldEventLinkProps) {
  return (
    <IconLink
      aria-label={`${formatDateTimeLong(event.heldAt)}をCSV出力`}
      disabled={disabled}
      icon={<Download />}
      to={withReturnTo(`/exports?heldEventId=${encodeURIComponent(event.id)}&format=csv`, returnTo)}
      tooltip="CSV/TSV出力へ"
      variant="quiet"
    />
  );
}

function canDeleteHeldEvent(event: HeldEventResponse) {
  return event.matchCount === 0 && event.draftCount === 0;
}

function HeldEventDeleteButton({
  disabled,
  event,
  onDelete,
}: {
  disabled: boolean;
  event: HeldEventResponse;
  onDelete: (event: HeldEventResponse) => void;
}) {
  if (!canDeleteHeldEvent(event)) return null;
  return (
    <IconButton
      aria-label={`${formatDateTimeLong(event.heldAt)}を削除`}
      disabled={disabled}
      icon={<Trash2 />}
      tooltip="空の開催を削除"
      variant="quiet"
      onClick={() => onDelete(event)}
    />
  );
}
