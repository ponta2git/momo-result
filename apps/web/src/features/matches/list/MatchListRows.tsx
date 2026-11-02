import { Download } from "lucide-react";
import { memo } from "react";
import { Link } from "react-router-dom";

import { formatCompactDateTime } from "@/features/matches/list/matchListFormat";
import type { MatchListItemView } from "@/features/matches/list/matchListTypes";
import { MatchNoteExcerpt } from "@/shared/matches/MatchNoteExcerpt";
import { RankBadge } from "@/shared/matches/RankBadge";
import { IconLink } from "@/shared/ui/actions/IconLink";
import { cn } from "@/shared/ui/cn";
import { DataTable } from "@/shared/ui/data/DataTable";
import { ContentWithActions } from "@/shared/ui/layout/ContentWithActions";
import { contentText } from "@/shared/ui/typography";

// A coarse pointer gets the 44px hit target; a fine pointer keeps the row's text density.
const titleLinkClass =
  "inline-flex min-h-11 items-center underline decoration-[var(--color-border-strong)] underline-offset-3 hover:decoration-current pointer-fine:min-h-0";

// The list owns the dividers between records; its outer rules match the table's top and bottom.
const compactListClass =
  "divide-y divide-[var(--color-border)] border-y border-[var(--color-border-strong)]";

function MatchTitle({ item }: { item: MatchListItemView }) {
  return (
    <Link className={cn(contentText.compactPrimary, titleLinkClass)} to={item.detailHref}>
      {item.matchNoLabel}・{item.mapName}
    </Link>
  );
}

function RankList({ compact = false, item }: { compact?: boolean; item: MatchListItemView }) {
  return (
    <ol
      aria-label="順位"
      className={cn("flex min-w-0 flex-wrap gap-y-1", compact ? "gap-x-3" : "gap-x-4")}
      // oxlint-disable-next-line jsx-a11y/no-redundant-roles -- Safari needs an explicit list role when Preflight removes markers.
      role="list"
    >
      {item.ranks.map((rank) => (
        <li key={rank.memberId} className="inline-flex min-w-0 items-center gap-2">
          <RankBadge rank={rank.rank} />
          <span className={contentText.body}>{rank.displayName}</span>
        </li>
      ))}
    </ol>
  );
}

function ExportLink({ disabled, item }: { disabled: boolean; item: MatchListItemView }) {
  return (
    <IconLink
      aria-label={`${item.matchNoLabel}をCSV/TSV出力`}
      disabled={disabled}
      icon={<Download />}
      to={item.exportHref}
      tooltip="CSV/TSV出力へ"
      variant="quiet"
    />
  );
}

type MatchListRowsProps = {
  disabled: boolean;
  items: MatchListItemView[];
  memoQuery: string;
};

export const MatchesTable = memo(function MatchesTable({
  disabled,
  items,
  memoQuery,
}: MatchListRowsProps) {
  return (
    <DataTable
      caption={{ content: "確定済みの試合" }}
      columns={[
        {
          header: "試合",
          key: "match",
          renderCell: (item) => (
            <div className="grid gap-1">
              <MatchTitle item={item} />
              <span className={cn(contentText.supporting, "tabular-nums")}>
                {formatCompactDateTime(item.heldAt)}・{item.gameSeasonLabel}
              </span>
            </div>
          ),
          rowHeader: true,
          width: "16rem",
        },
        {
          header: "順位",
          key: "ranks",
          renderCell: (item) => <RankList item={item} />,
          width: "40%",
        },
        {
          header: "メモ",
          key: "memo",
          renderCell: (item) =>
            item.noteBody ? (
              <MatchNoteExcerpt memoQuery={memoQuery} text={item.noteBody} />
            ) : (
              <span className={contentText.supporting}>
                <span aria-hidden="true">—</span>
                <span className="sr-only">メモなし</span>
              </span>
            ),
        },
        {
          align: "center",
          header: "出力",
          key: "export",
          renderCell: (item) => <ExportLink disabled={disabled} item={item} />,
          width: "4.5rem",
        },
      ]}
      getRowKey={(item) => item.id}
      layout="fixed"
      minWidth="52rem"
      rows={items}
      verticalAlign="top"
    />
  );
});

/** Compact rows retain the same identity, memo, and export actions as the table. */
export const MatchListCompactRows = memo(function MatchListCompactRows({
  disabled,
  items,
  memoQuery,
}: MatchListRowsProps) {
  return (
    <ol
      aria-label="確定済みの試合"
      className={compactListClass}
      // oxlint-disable-next-line jsx-a11y/no-redundant-roles -- Safari needs an explicit list role when Preflight removes markers.
      role="list"
    >
      {items.map((item) => (
        <li key={item.id} className="grid gap-2 py-3">
          <div className="grid gap-1">
            <div className="flex min-w-0 items-baseline justify-between gap-2">
              <MatchTitle item={item} />
              <span className={cn(contentText.supporting, "shrink-0 tabular-nums")}>
                {formatCompactDateTime(item.heldAt)}
              </span>
            </div>
            <span className={contentText.supporting}>{item.gameSeasonLabel}</span>
          </div>
          <RankList compact item={item} />
          <ContentWithActions actions={<ExportLink disabled={disabled} item={item} />}>
            {item.noteBody ? <MatchNoteExcerpt memoQuery={memoQuery} text={item.noteBody} /> : null}
          </ContentWithActions>
        </li>
      ))}
    </ol>
  );
});
