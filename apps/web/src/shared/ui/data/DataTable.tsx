import { ArrowDown, ArrowUp } from "lucide-react";
import { useMemo } from "react";
import type { ComponentPropsWithoutRef, CSSProperties, ReactNode } from "react";

import { cn } from "@/shared/ui/cn";

type DataTableAlign = "center" | "left" | "right";
type DataTableDensity = "comfortable" | "compact";
type DataTableVerticalAlign = "middle" | "top";

export type DataTableCaption = {
  content: ReactNode;
  visibility?: "screen-reader" | "visible" | undefined;
};

type DataTableColumnBase<Row> = {
  align?: DataTableAlign;
  header: ReactNode;
  key: string;
  minWidth?: string;
  width?: string;
  renderCell: (row: Row) => ReactNode;
  rowHeader?: boolean;
};

type StaticDataTableColumn = {
  onSort?: never;
  sortDirection?: never;
  sortDisabled?: never;
  sortable?: false | undefined;
};

type SortableDataTableColumn = {
  onSort: () => void;
  sortDirection?: "asc" | "desc" | undefined;
  sortDisabled?: boolean | undefined;
  sortable: true;
};

/** Sortable columns require an action; static columns cannot accidentally expose sort state. */
export type DataTableColumn<Row> = DataTableColumnBase<Row> &
  (StaticDataTableColumn | SortableDataTableColumn);

export type DataTableProps<Row> = {
  caption: DataTableCaption;
  className?: string;
  columns: Array<DataTableColumn<Row>>;
  density?: DataTableDensity;
  emptyState?: ReactNode;
  getRowKey: (row: Row, index: number) => string;
  layout?: "auto" | "fixed";
  minWidth?: string;
  rows: Row[];
  isRowBusy?: ((row: Row) => boolean) | undefined;
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

const densityClass = {
  comfortable: "px-3 py-3",
  compact: "px-3 py-2",
} as const satisfies Record<DataTableDensity, string>;

export const dataTableHeaderCellClassName =
  "border-y border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 align-middle text-xs leading-5 font-semibold text-[var(--color-text-secondary)]";

export const dataTableBodyCellClassName = "px-3 py-2 align-middle";

export const dataTableScrollAreaClassName = "min-w-0 overflow-x-auto bg-[var(--color-surface)]";

export function DataTableBodyRow({ className, ...props }: ComponentPropsWithoutRef<"tr">) {
  return (
    <tr
      className={cn(
        "group transition-colors duration-[var(--motion-fast)] hover:bg-[var(--color-surface-hover)] motion-reduce:transition-none last:[&>td]:border-b last:[&>td]:border-[var(--color-border-strong)] last:[&>th]:border-b last:[&>th]:border-[var(--color-border-strong)]",
        className,
      )}
      {...props}
    />
  );
}

export function DataTable<Row>({
  caption,
  className,
  columns,
  density = "comfortable",
  emptyState,
  getRowKey,
  layout = "auto",
  minWidth,
  rows,
  isRowBusy,
  verticalAlign = "middle",
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
    <div className={cn(dataTableScrollAreaClassName, className)}>
      <table
        className={cn(
          "w-full min-w-full border-separate border-spacing-0 text-sm leading-6",
          layout === "fixed" ? "table-fixed" : "",
        )}
        style={minWidth ? { minWidth } : undefined}
      >
        <caption
          className={cn(
            caption.visibility === "visible"
              ? "border-b border-[var(--color-border)] px-3 py-2 text-left text-sm font-semibold text-[var(--color-text-primary)]"
              : "sr-only",
          )}
        >
          {caption.content}
        </caption>
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
                  dataTableHeaderCellClassName,
                  "sticky top-0 z-[var(--z-base)]",
                  alignClass[column.align ?? "left"],
                )}
                style={columnStyleByKey.get(column.key)}
              >
                {column.sortable ? (
                  <button
                    className={cn(
                      "momo-pressable inline-flex min-h-11 items-center gap-1 rounded-[var(--radius-xs)] px-1 py-1 text-left text-inherit sm:min-h-9",
                      "hover:bg-[var(--color-surface-hover)] disabled:cursor-not-allowed disabled:opacity-60",
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
            <DataTableBodyRow
              key={getRowKey(row, rowIndex)}
              aria-busy={isRowBusy?.(row) || undefined}
            >
              {columns.map((column) => {
                const Cell = column.rowHeader ? "th" : "td";
                return (
                  <Cell
                    key={column.key}
                    className={cn(
                      "text-[var(--color-text-primary)]",
                      densityClass[density],
                      alignClass[column.align ?? "left"],
                      verticalAlignClass[verticalAlign],
                      column.rowHeader ? "font-semibold" : "",
                    )}
                    scope={column.rowHeader ? "row" : undefined}
                    style={columnStyleByKey.get(column.key)}
                  >
                    <div className="min-w-0">{column.renderCell(row)}</div>
                  </Cell>
                );
              })}
            </DataTableBodyRow>
          ))}
          {rows.length === 0 && emptyState ? (
            <tr>
              <td
                className="border-b border-[var(--color-border-strong)] p-3 align-middle"
                colSpan={columns.length}
              >
                {emptyState}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
