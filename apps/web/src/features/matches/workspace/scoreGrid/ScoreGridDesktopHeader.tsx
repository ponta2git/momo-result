import {
  incidentScoreGridColumns,
  incidentScoreGridColumnWidthClass,
  incidentScoreGridHeaderGroupClass,
  incidentScoreGridHeaderLabelsClass,
  incidentScoreGridLayoutClass,
  playerScoreGridColumns,
} from "@/features/matches/workspace/scoreGrid/ScoreGridColumns";
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
        {playerScoreGridColumns.map((column) => (
          <col key={column.column} className={column.widthClass} />
        ))}
        <col className={incidentScoreGridColumnWidthClass} />
      </colgroup>
      <thead className={contentText.supporting}>
        <tr>
          {playerScoreGridColumns.map((column) => (
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
          {/* Folded counts carry their own names, so the header names the group instead. */}
          <th className="px-2 py-2 text-left align-middle">
            <span className={incidentScoreGridHeaderGroupClass}>事件簿</span>
            <span
              aria-hidden="true"
              className={cn(incidentScoreGridLayoutClass, incidentScoreGridHeaderLabelsClass)}
            >
              {incidentScoreGridColumns.map((column) => (
                <span key={column.column} className="text-center">
                  {column.header}
                </span>
              ))}
            </span>
          </th>
        </tr>
      </thead>
    </>
  );
}
