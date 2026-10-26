import { Download } from "lucide-react";
import { Fragment, memo } from "react";
import { Link } from "react-router-dom";

import { formatCompactDateTime } from "@/features/matches/list/matchListFormat";
import type { MatchListItemView } from "@/features/matches/list/matchListTypes";
import { RankBadge } from "@/shared/matches/RankBadge";
import { IconLink } from "@/shared/ui/actions/IconLink";
import { cn } from "@/shared/ui/cn";
import { DataTable } from "@/shared/ui/data/DataTable";
import { contentText } from "@/shared/ui/typography";

const titleLinkClass =
  "underline decoration-[var(--color-border-strong)] underline-offset-3 hover:decoration-current";

/** Splits on the searched words, ignoring case, so each occurrence can be marked. */
function splitMemoHighlights(text: string, query: string) {
  if (!query) return [{ match: false, text }];
  // Match against the original text: lowercasing can change Unicode string lengths.
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu");
  const parts: Array<{ match: boolean; text: string }> = [];
  let start = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index;
    if (index > start) parts.push({ match: false, text: text.slice(start, index) });
    parts.push({ match: true, text: match[0] });
    start = index + match[0].length;
  }
  if (start < text.length) parts.push({ match: false, text: text.slice(start) });
  return parts;
}

function MemoText({
  compact = false,
  memoQuery,
  text,
}: {
  compact?: boolean;
  memoQuery: string;
  text: string;
}) {
  return (
    <p
      className={cn(
        compact ? contentText.supporting : contentText.body,
        "whitespace-pre-line text-pretty",
        compact ? "line-clamp-2" : "line-clamp-3",
      )}
    >
      {splitMemoHighlights(text, memoQuery).map((part, index) => (
        // Parts never reorder for one text; the index is stable.
        // oxlint-disable-next-line react/no-array-index-key
        <Fragment key={index}>
          {part.match ? (
            <mark className="rounded-xs bg-[var(--color-search-match-surface)] px-0.5 text-[var(--color-text-primary)]">
              {part.text}
            </mark>
          ) : (
            part.text
          )}
        </Fragment>
      ))}
    </p>
  );
}

function MatchTitle({ item }: { item: MatchListItemView }) {
  return (
    <Link className={cn(contentText.compactPrimary, titleLinkClass)} to={item.detailHref}>
      {item.matchNoLabel} · {item.mapName}
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
        <li key={rank.memberId} className="inline-flex min-w-0 items-center gap-1.5">
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
                {formatCompactDateTime(item.heldAt)} · {item.gameSeasonLabel}
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
          width: "22rem",
        },
        {
          header: "メモ",
          key: "memo",
          renderCell: (item) =>
            item.noteBody ? (
              <MemoText memoQuery={memoQuery} text={item.noteBody} />
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
      className="border-t border-[var(--color-border)]"
      // oxlint-disable-next-line jsx-a11y/no-redundant-roles -- Safari needs an explicit list role when Preflight removes markers.
      role="list"
    >
      {items.map((item) => (
        <li key={item.id} className="grid gap-2 border-b border-[var(--color-border)] py-3">
          <div className="flex min-w-0 items-baseline justify-between gap-2">
            <MatchTitle item={item} />
            <span className={cn(contentText.supporting, "shrink-0 tabular-nums")}>
              {formatCompactDateTime(item.heldAt)}
            </span>
          </div>
          <span className={contentText.supporting}>{item.gameSeasonLabel}</span>
          <RankList compact item={item} />
          <div className="flex min-w-0 items-end justify-between gap-2">
            {item.noteBody ? (
              <MemoText compact memoQuery={memoQuery} text={item.noteBody} />
            ) : (
              <span />
            )}
            <ExportLink disabled={disabled} item={item} />
          </div>
        </li>
      ))}
    </ol>
  );
});
