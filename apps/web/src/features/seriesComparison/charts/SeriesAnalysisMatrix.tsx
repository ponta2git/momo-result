import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { cn } from "@/shared/ui/cn";
import { DataTableBodyRow, dataTableHeaderCellClassName } from "@/shared/ui/data/DataTable";

export const SERIES_RANKS = [1, 2, 3, 4] as const;

export function AnalysisMatrix({
  ariaLabel,
  children,
  className,
}: {
  ariaLabel: string;
  children: ReactNode;
  className?: string | undefined;
}) {
  return (
    <div className="overflow-x-auto pb-1">
      <table
        aria-label={ariaLabel}
        className={cn("w-full border-separate border-spacing-1", className)}
      >
        {children}
      </table>
    </div>
  );
}

export function MatrixAxisHeader({
  className,
  columnLabel,
  rowLabel,
  ...props
}: Omit<ComponentPropsWithoutRef<"th">, "children" | "scope"> & {
  columnLabel: string;
  rowLabel: string;
}) {
  return (
    <th
      className={cn(
        "rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-2 py-1 text-left text-[11px] font-semibold text-[var(--color-text-secondary)]",
        className,
      )}
      {...props}
      scope="col"
    >
      <span className="block">行: {rowLabel}</span>
      <span className="block">列: {columnLabel}</span>
    </th>
  );
}

export function MatrixColumnHeader({
  children,
  className,
  ...props
}: Omit<ComponentPropsWithoutRef<"th">, "scope">) {
  return (
    <th
      className={cn(
        "rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-2 py-2 text-center text-xs font-semibold break-words",
        className,
      )}
      {...props}
      scope="col"
    >
      {children}
    </th>
  );
}

export function MatrixRowHeader({
  children,
  className,
  ...props
}: Omit<ComponentPropsWithoutRef<"th">, "scope">) {
  return (
    <th
      className={cn(
        "rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-2 py-2 text-left text-sm font-semibold break-words",
        className,
      )}
      {...props}
      scope="row"
    >
      {children}
    </th>
  );
}

export function MatrixCell({ children, className, ...props }: ComponentPropsWithoutRef<"td">) {
  return (
    <td className={cn("align-middle", className)} {...props}>
      {children}
    </td>
  );
}

export function AnalysisTableHead({
  children,
  className,
  ...props
}: Omit<ComponentPropsWithoutRef<"th">, "scope">) {
  return (
    <th className={cn(dataTableHeaderCellClassName, className)} {...props} scope="col">
      {children}
    </th>
  );
}

export function AnalysisTableCell({
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<"td">) {
  return (
    <td className={cn("px-3 py-2 tabular-nums", className)} {...props}>
      {children}
    </td>
  );
}

export function AnalysisTableRow({
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<"tr">) {
  return (
    <DataTableBodyRow className={className} {...props}>
      {children}
    </DataTableBodyRow>
  );
}

export function MatrixValueLegend({
  ariaLabel,
  className,
  items,
}: {
  ariaLabel: string;
  className?: string | undefined;
  items: ReadonlyArray<{ id: string; label: string; value: string }>;
}) {
  return (
    <dl
      aria-label={ariaLabel}
      className={cn(
        "flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--color-text-secondary)]",
        className,
      )}
    >
      {items.map((item) => (
        <div className="inline-flex gap-1" key={item.id}>
          <dt className="font-semibold">{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
