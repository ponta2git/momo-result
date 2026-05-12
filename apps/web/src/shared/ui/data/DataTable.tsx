import { ArrowDown, ArrowUp } from "lucide-react";
import { useMemo } from "react";
import type { CSSProperties, ReactNode } from "react";

import { cn } from "@/shared/ui/cn";

type DataTableAlign = "center" | "left" | "right";

export type DataTableColumn<Row> = {
  align?: DataTableAlign;
  header: ReactNode;
  key: string;
  minWidth?: string;
  renderCell: (row: Row) => ReactNode;
  sortDirection?: "asc" | "desc" | undefined;
  sortable?: boolean;
  onSort?: () => void;
};

export type DataTableProps<Row> = {
  className?: string;
  columns: Array<DataTableColumn<Row>>;
  emptyState?: ReactNode;
  getRowKey: (row: Row, index: number) => string;
  rows: Row[];
};

const alignClass = {
  center: "text-center",
  left: "text-left",
  right: "text-right",
} as const satisfies Record<DataTableAlign, string>;

export function DataTable<Row>({
  className,
  columns,
  emptyState,
  getRowKey,
  rows,
}: DataTableProps<Row>) {
  const columnStyleByKey = useMemo(() => {
    return new Map<string, CSSProperties | undefined>(
      columns.map((column) => [
        column.key,
        column.minWidth ? { minWidth: column.minWidth } : undefined,
      ]),
    );
  }, [columns]);

  return (
    <div className={cn("min-w-0 overflow-x-auto", className)}>
      <table className="w-full min-w-full border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                aria-sort={
                  column.sortable
                    ? column.sortDirection === "asc"
                      ? "ascending"
                      : column.sortDirection === "desc"
                        ? "descending"
                        : "none"
                    : undefined
                }
                className={cn(
                  "border-b border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 text-xs font-semibold text-[var(--color-text-secondary)]",
                  alignClass[column.align ?? "left"],
                )}
                style={columnStyleByKey.get(column.key)}
              >
                {column.sortable ? (
                  <button
                    className={cn(
                      "inline-flex min-h-9 items-center gap-1 rounded-[var(--radius-xs)] px-1 py-1 text-left text-inherit",
                      "hover:bg-[var(--color-surface-subtle)]",
                      column.sortDirection
                        ? "bg-[var(--color-action)]/10 text-[var(--color-text-primary)]"
                        : "",
                    )}
                    onClick={column.onSort}
                    type="button"
                  >
                    <span>{column.header}</span>
                    {column.sortDirection === "asc" ? (
                      <ArrowUp aria-hidden="true" className="size-3.5" />
                    ) : column.sortDirection === "desc" ? (
                      <ArrowDown aria-hidden="true" className="size-3.5" />
                    ) : null}
                  </button>
                ) : (
                  column.header
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={getRowKey(row, rowIndex)} className="border-b border-[var(--color-border)]">
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={cn(
                    "px-3 py-2 align-top text-[var(--color-text-primary)]",
                    alignClass[column.align ?? "left"],
                  )}
                  style={columnStyleByKey.get(column.key)}
                >
                  <div className="min-w-0">{column.renderCell(row)}</div>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && emptyState ? <div className="mt-3">{emptyState}</div> : null}
    </div>
  );
}
