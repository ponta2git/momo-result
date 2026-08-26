import { scoreGridColumns } from "@/features/matches/workspace/scoreGrid/ScoreGridColumns";

export function ScoreGridDesktopHeader() {
  return (
    <>
      <colgroup>
        {scoreGridColumns.map((column) => (
          <col key={column.column} className={column.widthClass} />
        ))}
      </colgroup>
      <thead className="text-xs text-[var(--color-text-secondary)]">
        <tr>
          {scoreGridColumns.map((column) => (
            <th
              key={column.column}
              className={
                column.kind === "member"
                  ? "sticky left-0 z-[var(--z-sticky-raised)] bg-[var(--color-surface)] px-2 py-2 align-middle"
                  : "px-2 py-2 align-middle"
              }
            >
              {column.header}
            </th>
          ))}
        </tr>
      </thead>
    </>
  );
}
