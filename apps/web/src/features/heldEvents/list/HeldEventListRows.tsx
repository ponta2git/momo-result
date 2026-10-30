import { Camera, Download, Trash2 } from "lucide-react";
import { memo } from "react";

import type {
  HeldEventListRowView,
  HeldEventStanding,
} from "@/features/heldEvents/list/heldEventsListPresentation";
import { MatchNoteExcerpt } from "@/shared/matches/MatchNoteExcerpt";
import { MemberSequenceLabel } from "@/shared/matches/MemberSequenceLabel";
import { RankBadge } from "@/shared/matches/RankBadge";
import { ActionLink } from "@/shared/ui/actions/ActionLink";
import { IconButton } from "@/shared/ui/actions/IconButton";
import { IconLink } from "@/shared/ui/actions/IconLink";
import { cn } from "@/shared/ui/cn";
import { DataTable } from "@/shared/ui/data/DataTable";
import { contentText } from "@/shared/ui/typography";

const titleLinkClass =
  "underline decoration-[var(--color-border-strong)] underline-offset-3 hover:decoration-current";

type HeldEventListRowsProps = {
  /** Links lead away from rows that may belong to a previous search. */
  actionsDisabled: boolean;
  deleteDisabled: boolean;
  emphasizedMemberId: string;
  memoQuery: string;
  rows: readonly HeldEventListRowView[];
  showNoteMatch: boolean;
  onDelete: (row: HeldEventListRowView) => void;
};

function LatestBadge() {
  return (
    <span
      className={cn(
        contentText.supporting,
        "shrink-0 rounded-xs border border-[var(--color-border-strong)] px-1.5 py-0.5",
      )}
    >
      最新
    </span>
  );
}

function HeldEventTitle({ disabled, row }: { disabled: boolean; row: HeldEventListRowView }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      {row.latest ? <LatestBadge /> : null}
      <ActionLink
        aria-label={`${row.heldAtLabel}の開催詳細`}
        className={cn(contentText.compactPrimary, titleLinkClass, "tabular-nums")}
        disabled={disabled}
        to={row.detailHref}
      >
        <time dateTime={row.heldAt}>{row.heldAtLabel}</time>
      </ActionLink>
    </div>
  );
}

function HeldEventScopes({ row }: { row: HeldEventListRowView }) {
  if (row.scopes.length === 0) return null;
  return (
    <ul
      aria-label="開催のシリーズ・シーズン"
      className={cn(contentText.supporting, "grid gap-0.5")}
    >
      {row.scopes.map((scope) => (
        <li key={scope.key}>{scope.label}</li>
      ))}
    </ul>
  );
}

function MatchCounts({ row }: { row: HeldEventListRowView }) {
  if (row.matchCount === 0 && row.draftCount === 0) {
    return <span className={contentText.supporting}>試合なし</span>;
  }
  return (
    <span className="grid gap-0.5 tabular-nums">
      <span className={contentText.body}>{row.matchCount.toLocaleString()}試合</span>
      {row.draftCount > 0 ? (
        <span className={contentText.supporting}>下書き {row.draftCount.toLocaleString()}件</span>
      ) : null}
    </span>
  );
}

function StandingItem({
  emphasized,
  standing,
}: {
  emphasized: boolean;
  standing: HeldEventStanding;
}) {
  return (
    <li className="inline-flex min-w-0 items-center gap-1.5">
      <RankBadge rank={standing.standing} />
      <span className={cn(contentText.body, "flex min-w-0 items-center whitespace-nowrap")}>
        <MemberSequenceLabel memberId={standing.memberId}>
          {standing.displayName}
        </MemberSequenceLabel>
      </span>
      {emphasized ? (
        <strong className={cn(contentText.compactPrimary, "ms-auto tabular-nums")}>
          {standing.averageLabel}
        </strong>
      ) : (
        <span className={cn(contentText.body, "ms-auto tabular-nums")}>
          {standing.averageLabel}
        </span>
      )}
    </li>
  );
}

function Standings({
  compact = false,
  emphasizedMemberId,
  row,
}: {
  compact?: boolean;
  emphasizedMemberId: string;
  row: HeldEventListRowView;
}) {
  if (row.standings.length === 0) {
    return <span className={contentText.supporting}>確定した試合はまだありません</span>;
  }
  return (
    <ol
      aria-label="開催平均順位"
      className={cn(
        "grid min-w-0 gap-y-1",
        compact ? "grid-cols-2 gap-x-4" : "grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-x-5",
      )}
      // oxlint-disable-next-line jsx-a11y/no-redundant-roles -- Safari needs an explicit list role when Preflight removes markers.
      role="list"
    >
      {row.standings.map((standing) => (
        <StandingItem
          key={standing.memberId}
          emphasized={emphasizedMemberId !== "" && standing.memberId === emphasizedMemberId}
          standing={standing}
        />
      ))}
    </ol>
  );
}

function NoteMatch({
  compact = false,
  memoQuery,
  row,
}: {
  compact?: boolean;
  memoQuery: string;
  row: HeldEventListRowView;
}) {
  if (!row.noteMatch) return null;
  return (
    <div className="grid min-w-0 gap-1">
      <MatchNoteExcerpt
        compact={compact}
        memoQuery={memoQuery}
        prefix={`${row.noteMatch.matchNoLabel} · `}
        text={row.noteMatch.noteBody}
      />
      {row.noteMatch.otherMatchCount > 0 ? (
        <span className={cn(contentText.supporting, "tabular-nums")}>
          ほか{row.noteMatch.otherMatchCount.toLocaleString()}試合のメモにも一致
        </span>
      ) : null}
    </div>
  );
}

function RowActions({
  actionsDisabled,
  deleteDisabled,
  row,
  onDelete,
}: Pick<HeldEventListRowsProps, "actionsDisabled" | "deleteDisabled" | "onDelete"> & {
  row: HeldEventListRowView;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center justify-end gap-1">
      {row.ocrHref ? (
        <IconLink
          aria-label={`${row.heldAtLabel}の開催にOCR取り込み`}
          disabled={actionsDisabled}
          icon={<Camera />}
          to={row.ocrHref}
          tooltip="この開催にOCR取り込み"
          variant="quiet"
        />
      ) : null}
      <IconLink
        aria-label={`${row.heldAtLabel}をCSV出力`}
        disabled={actionsDisabled}
        icon={<Download />}
        to={row.exportHref}
        tooltip="CSV/TSV出力へ"
        variant="quiet"
      />
      {row.deletable ? (
        <IconButton
          aria-label={`${row.heldAtLabel}を削除`}
          disabled={deleteDisabled}
          icon={<Trash2 />}
          tooltip="空の開催を削除"
          variant="quiet"
          onClick={() => onDelete(row)}
        />
      ) : null}
    </div>
  );
}

export const HeldEventsTable = memo(function HeldEventsTable({
  actionsDisabled,
  deleteDisabled,
  emphasizedMemberId,
  memoQuery,
  rows,
  showNoteMatch,
  onDelete,
}: HeldEventListRowsProps) {
  return (
    <DataTable
      caption={{ content: "開催の一覧" }}
      columns={[
        {
          header: "開催",
          key: "event",
          renderCell: (row) => (
            <div className="grid min-w-0 gap-1">
              <HeldEventTitle disabled={actionsDisabled} row={row} />
              <HeldEventScopes row={row} />
            </div>
          ),
          rowHeader: true,
          width: "15rem",
        },
        {
          header: "試合",
          key: "matches",
          renderCell: (row) => <MatchCounts row={row} />,
          width: "7rem",
        },
        {
          header: "開催平均順位",
          key: "standings",
          // Beside the note column the four players fold into a 2×2 grid instead of one stack.
          renderCell: (row) => (
            <Standings compact={showNoteMatch} emphasizedMemberId={emphasizedMemberId} row={row} />
          ),
          ...(showNoteMatch ? { width: "24rem" } : {}),
        },
        ...(showNoteMatch
          ? [
              {
                header: "メモの一致",
                key: "note",
                renderCell: (row: HeldEventListRowView) => (
                  <NoteMatch memoQuery={memoQuery} row={row} />
                ),
              },
            ]
          : []),
        {
          align: "right",
          header: "操作",
          key: "actions",
          renderCell: (row) => (
            <RowActions
              actionsDisabled={actionsDisabled}
              deleteDisabled={deleteDisabled}
              row={row}
              onDelete={onDelete}
            />
          ),
          width: "9rem",
        },
      ]}
      getRowKey={(row) => row.id}
      layout="fixed"
      minWidth={showNoteMatch ? "62rem" : "52rem"}
      rows={rows}
      verticalAlign="top"
    />
  );
});

/** Compact rows retain the same identity, results, memo, and actions as the table. */
export const HeldEventListCompactRows = memo(function HeldEventListCompactRows({
  actionsDisabled,
  deleteDisabled,
  emphasizedMemberId,
  memoQuery,
  rows,
  onDelete,
}: HeldEventListRowsProps) {
  return (
    <ol
      aria-label="開催の一覧"
      className="border-t border-[var(--color-border)]"
      // oxlint-disable-next-line jsx-a11y/no-redundant-roles -- Safari needs an explicit list role when Preflight removes markers.
      role="list"
    >
      {rows.map((row) => (
        <li key={row.id} className="grid gap-2 border-b border-[var(--color-border)] py-3">
          <div className="flex min-w-0 items-start justify-between gap-2">
            <div className="grid min-w-0 gap-1">
              <HeldEventTitle disabled={actionsDisabled} row={row} />
              <HeldEventScopes row={row} />
            </div>
            <span className="shrink-0 text-end">
              <MatchCounts row={row} />
            </span>
          </div>
          <Standings compact emphasizedMemberId={emphasizedMemberId} row={row} />
          <NoteMatch compact memoQuery={memoQuery} row={row} />
          <RowActions
            actionsDisabled={actionsDisabled}
            deleteDisabled={deleteDisabled}
            row={row}
            onDelete={onDelete}
          />
        </li>
      ))}
    </ol>
  );
});
