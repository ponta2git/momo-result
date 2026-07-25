import { ArrowDown, ArrowUp } from "lucide-react";
import { useMemo } from "react";
import type { CSSProperties, ReactNode } from "react";

import { cn } from "@/shared/ui/cn";

type DataTableAlign = "center" | "left" | "right";
type DataTableVerticalAlign = "middle" | "top";

export type DataTableColumn<Row> = {
  align?: DataTableAlign;
  header: ReactNode;
  key: string;
  minWidth?: string;
  width?: string;
  renderCell: (row: Row) => ReactNode;
  sortDisabled?: boolean;
  sortDirection?: "asc" | "desc" | undefined;
  sortable?: boolean;
  onSort?: () => void;
};

export type DataTableProps<Row> = {
  className?: string;
  columns: Array<DataTableColumn<Row>>;
  emptyState?: ReactNode;
  getRowKey: (row: Row, index: number) => string;
  layout?: "auto" | "fixed";
  minWidth?: string;
  rows: Row[];
  verticalAlign?: DataTableVerticalAlign;
};

const alignClass = {
  center: "text-center",
  left: "text-left",
  right: "text-right",
} as const satisfies Record<DataTableAlign, string>;

const verticalAlignClass = {
  middle: "align-middle",
  top: "align-top",
} as const satisfies Record<DataTableVerticalAlign, string>;

export function DataTable<Row>({
  className,
  columns,
  emptyState,
  getRowKey,
  layout = "auto",
  minWidth,
  rows,
  verticalAlign = "top",
}: DataTableProps<Row>) {
  const columnStyleByKey = useMemo(() => {
    return new Map<string, CSSProperties | undefined>(
      columns.map((column) => [
        column.key,
        column.minWidth || column.width
          ? { minWidth: column.minWidth, width: column.width }
          : undefined,
      ]),
    );
  }, [columns]);

  return (
    <div
      className={cn(
        "min-w-0 overflow-x-auto rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]",
        className,
      )}
    >
      <table
        className={cn(
          "w-full min-w-full border-separate border-spacing-0 text-sm leading-6",
          layout === "fixed" ? "table-fixed" : "",
        )}
        style={minWidth ? { minWidth } : undefined}
      >
        <colgroup>
          {columns.map((column) => (
            <col key={column.key} style={columnStyleByKey.get(column.key)} />
          ))}
        </colgroup>
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
                  "sticky top-0 z-[var(--z-base)] border-b border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 text-xs leading-5 font-semibold text-[var(--color-text-secondary)]",
                  alignClass[column.align ?? "left"],
                )}
                style={columnStyleByKey.get(column.key)}
              >
                {column.sortable ? (
                  <button
                    className={cn(
                      "momo-pressable inline-flex min-h-9 items-center gap-1 rounded-[var(--radius-xs)] px-1 py-1 text-left text-inherit",
                      "hover:bg-[var(--color-surface-subtle)] disabled:cursor-not-allowed disabled:opacity-60",
                      column.sortDirection
                        ? "bg-[var(--color-action)]/10 text-[var(--color-text-primary)]"
                        : "",
                    )}
                    disabled={column.sortDisabled}
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
            <tr
              key={getRowKey(row, rowIndex)}
              className="group transition-colors duration-150 hover:bg-[var(--color-surface-subtle)] last:[&_td]:border-b-0"
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={cn(
                    "border-b border-[var(--color-border)] px-3 py-3 text-[var(--color-text-primary)]",
                    alignClass[column.align ?? "left"],
                    verticalAlignClass[verticalAlign],
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
