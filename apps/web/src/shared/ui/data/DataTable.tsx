import { ArrowDown, ArrowUp } from "lucide-react";
import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ComponentPropsWithoutRef, CSSProperties, ReactNode } from "react";

import { cn } from "@/shared/ui/cn";
import { useSurfaceFeedback } from "@/shared/ui/motion/useSurfaceFeedback";
import { contentText } from "@/shared/ui/typography";

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
  tabular?: boolean;
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
  columns: Array<DataTableColumn<Row>>;
  density?: DataTableDensity;
  emptyState?: ReactNode;
  getRowKey: (row: Row, index: number) => string;
  layout?: "auto" | "fixed";
  minWidth?: string;
  rows: Row[];
  isRowBusy?: ((row: Row) => boolean) | undefined;
  verticalAlign?: DataTableVerticalAlign;
  /** Opt in for wide comparisons; row headers stay visible within the named scroll region. */
  stickyRowHeader?: boolean;
  scrollArea?: { label: string; maxHeight?: string };
};

const alignClass = {
  center: "text-center",
  left: "text-left",
  right: "text-right",
} as const satisfies Record<DataTableAlign, string>;

const actionAlignClass = {
  center: "justify-center text-center",
  left: "justify-start text-left",
  right: "justify-end text-right",
} as const satisfies Record<DataTableAlign, string>;

const verticalAlignClass = {
  middle: "align-middle",
  top: "align-top",
} as const satisfies Record<DataTableVerticalAlign, string>;

const densityClass = {
  comfortable: "px-3 py-3",
  compact: "px-3 py-2",
} as const satisfies Record<DataTableDensity, string>;

export const dataTableHeaderCellClassName = cn(
  contentText.supporting,
  "border-y border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 align-middle",
);

export const dataTableBodyCellClassName = "px-3 py-2 align-middle";

export const dataTableScrollAreaClassName = "min-w-0 overflow-x-auto bg-[var(--color-surface)]";

export function DataTableBodyRow({
  ...props
}: Omit<ComponentPropsWithoutRef<"tr">, "className" | "style">) {
  const surfaceRef = useSurfaceFeedback<HTMLTableRowElement>();
  // Keep the row opaque so sticky cells can inherit its complete hover paint.
  return (
    <tr
      ref={surfaceRef}
      className="momo-surface momo-surface-neutral momo-surface-row group last:[&>td]:border-b last:[&>td]:border-[var(--color-border-strong)] last:[&>th]:border-b last:[&>th]:border-[var(--color-border-strong)]"
      {...props}
    />
  );
}

export function DataTable<Row>({
  caption,
  columns,
  density = "comfortable",
  emptyState,
  getRowKey,
  layout = "auto",
  minWidth,
  rows,
  isRowBusy,
  verticalAlign = "middle",
  stickyRowHeader = false,
  scrollArea,
}: DataTableProps<Row>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const hintId = useId();
  const [overflow, setOverflow] = useState({ horizontal: false, vertical: false });
  const namedScroll = scrollArea !== undefined;
  useLayoutEffect(() => {
    const area = scrollRef.current;
    if (!namedScroll || !area) return;
    const measure = () => {
      const horizontal = area.scrollWidth > area.clientWidth;
      const vertical = area.scrollHeight > area.clientHeight;
      setOverflow((previous) =>
        previous.horizontal === horizontal && previous.vertical === vertical
          ? previous
          : { horizontal, vertical },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(area);
    if (area.firstElementChild) observer.observe(area.firstElementChild);
    return () => observer.disconnect();
  }, [namedScroll]);
  const scrollable = overflow.horizontal || overflow.vertical;
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
    <div className="min-w-0">
      {namedScroll && scrollable ? (
        <p className={cn(contentText.supporting, "mb-2")} id={hintId}>
          {overflow.horizontal && overflow.vertical
            ? "表は上下左右にスクロールできます。"
            : overflow.horizontal
              ? "表は左右にスクロールできます。"
              : "表は上下にスクロールできます。"}
        </p>
      ) : null}
      <div
        className={cn(
          dataTableScrollAreaClassName,
          namedScroll && "relative isolate focus-visible:-outline-offset-2",
        )}
        ref={scrollRef}
        role={namedScroll ? "region" : undefined}
        aria-label={scrollArea?.label}
        aria-describedby={namedScroll && scrollable ? hintId : undefined}
        tabIndex={namedScroll && scrollable ? 0 : undefined}
        style={scrollArea?.maxHeight ? { maxHeight: scrollArea.maxHeight } : undefined}
      >
        <table
          className={cn(
            contentText.body,
            "w-full min-w-full border-separate border-spacing-0",
            layout === "fixed" ? "table-fixed" : "",
          )}
          style={minWidth ? { minWidth } : undefined}
        >
          <caption
            className={cn(
              caption.visibility === "visible"
                ? cn(
                    contentText.heading,
                    "border-t border-[var(--color-border-strong)] px-3 py-2 text-left",
                  )
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
                    column.sortable ? "p-0" : "",
                    caption.visibility === "visible" ? "border-t-0" : "",
                    "sticky top-0 z-[var(--z-base)]",
                    stickyRowHeader && "z-[var(--z-sticky)]",
                    stickyRowHeader && column.rowHeader && "left-0 z-[var(--z-sticky-raised)]",
                    alignClass[column.align ?? "left"],
                  )}
                  scope="col"
                  style={columnStyleByKey.get(column.key)}
                >
                  {column.sortable ? (
                    <DataTableSortButton
                      align={column.align ?? "left"}
                      disabled={column.sortDisabled}
                      direction={column.sortDirection}
                      onSort={column.onSort}
                    >
                      {column.header}
                    </DataTableSortButton>
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
                        "font-plain",
                        column.tabular ? "tabular-nums" : "",
                        stickyRowHeader &&
                          column.rowHeader &&
                          "sticky left-0 z-[var(--z-base)] bg-inherit",
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
    </div>
  );
}

function DataTableSortButton({
  align,
  children,
  direction,
  disabled,
  onSort,
}: {
  align: DataTableAlign;
  children: ReactNode;
  direction: "asc" | "desc" | undefined;
  disabled: boolean | undefined;
  onSort: () => void;
}) {
  const surfaceRef = useSurfaceFeedback<HTMLButtonElement>();
  return (
    <button
      ref={surfaceRef}
      className={cn(
        "momo-surface momo-surface-press inline-flex min-h-11 w-full items-center gap-1 rounded-xs px-3 py-2 text-inherit focus-visible:-outline-offset-3 pointer-fine:min-h-9 pointer-fine:py-1",
        actionAlignClass[align],
        "disabled:cursor-not-allowed disabled:opacity-60",
        direction ? "momo-surface-sorted text-[var(--color-text-primary)]" : "",
      )}
      disabled={disabled}
      onClick={onSort}
      type="button"
    >
      <span>{children}</span>
      {direction === "asc" ? (
        <ArrowUp aria-hidden="true" className="size-3.5" />
      ) : direction === "desc" ? (
        <ArrowDown aria-hidden="true" className="size-3.5" />
      ) : null}
    </button>
  );
}
