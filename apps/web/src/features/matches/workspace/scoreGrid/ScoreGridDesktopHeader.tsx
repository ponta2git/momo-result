import { scoreGridColumns } from "@/features/matches/workspace/scoreGrid/ScoreGridColumns";
import type { ScoreGridColumnAlign } from "@/features/matches/workspace/scoreGrid/ScoreGridColumns";
import { cn } from "@/shared/ui/cn";
import { contentText } from "@/shared/ui/typography";

const alignClass = {
  start: "text-left",
  center: "text-center",
  end: "text-right",
} as const satisfies Record<ScoreGridColumnAlign, string>;

export function ScoreGridDesktopHeader() {
  return (
    <>
      <colgroup>
        {scoreGridColumns.map((column) => (
          <col key={column.column} className={column.widthClass} />
        ))}
      </colgroup>
      <thead className={contentText.supporting}>
        <tr>
          {scoreGridColumns.map((column) => (
            <th
              key={column.column}
              className={cn(
                "px-2 py-2 align-middle",
                alignClass[column.align],
                column.kind === "member" &&
                  "sticky left-0 z-[var(--z-sticky-raised)] bg-[var(--color-surface)]",
              )}
            >
              {column.header}
            </th>
          ))}
        </tr>
      </thead>
    </>
  );
}
