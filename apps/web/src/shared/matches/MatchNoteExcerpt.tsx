import { Fragment } from "react";

import { cn } from "@/shared/ui/cn";
import { contentText } from "@/shared/ui/typography";

/** Splits on the searched words, ignoring case, so each occurrence can be marked. */
export function splitMemoHighlights(text: string, query: string) {
  if (!query) return [{ match: false, text }];
  // Match against the original text: lowercasing can change Unicode string lengths.
  const pattern = new RegExp(query.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "giu");
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

/** A match note clamped to two lines, with the searched words marked. */
export function MatchNoteExcerpt({
  compact = false,
  memoQuery,
  prefix,
  text,
}: {
  compact?: boolean;
  memoQuery: string;
  prefix?: string | undefined;
  text: string;
}) {
  return (
    <p
      className={cn(
        compact ? contentText.supporting : contentText.body,
        "line-clamp-2 whitespace-pre-line text-pretty",
      )}
    >
      {prefix ? <span className="tabular-nums">{prefix}</span> : null}
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
