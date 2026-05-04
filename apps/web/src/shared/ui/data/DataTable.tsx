import { ArrowDown, ArrowUp } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/shared/ui/cn";

type DataTableAlign = "center" | "left" | "right";

export type DataTableColumn<Row> = {
  align?: DataTableAlign;
  header: ReactNode;
  key: string;
  minWidth?: string;
  renderCell: (row: Row) => ReactNode;
  sortDirection?: "asc" | "desc";
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

const alignClass: Record<DataTableAlign, string> = {
  center: "text-center",
  left: "text-left",
  right: "text-right",
};

export function DataTable<Row>({
  className,
  columns,
  emptyState,
  getRowKey,
  rows,
}: DataTableProps<Row>) {
  return (
    <div className={cn("min-w-0 overflow-x-auto", className)}>
      <table className="w-full min-w-full border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                className={cn(
                  "border-b border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 text-xs font-semibold text-[var(--color-text-secondary)]",
                  alignClass[column.align ?? "left"],
                )}
                style={column.minWidth ? { minWidth: column.minWidth } : undefined}
              >
                {column.sortable ? (
                  <button
                    className={cn(
                      "inline-flex min-h-9 items-center gap-1 rounded-[var(--radius-xs)] px-1 py-1 text-left text-inherit",
                      "hover:bg-[var(--color-surface-subtle)]",
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
                  style={column.minWidth ? { minWidth: column.minWidth } : undefined}
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
