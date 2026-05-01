import type { HTMLAttributes, ReactNode, TableHTMLAttributes } from "react";

type DataTableProps = TableHTMLAttributes<HTMLTableElement> & {
  children: ReactNode;
};

type DataTableShellProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
};

function classNames(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function DataTableShell({ children, className, ...props }: DataTableShellProps) {
  return (
    <div className={classNames("overflow-x-auto", className)} {...props}>
      {children}
    </div>
  );
}

export function DataTable({ children, className, ...props }: DataTableProps) {
  return (
    <table className={classNames("w-full text-sm", className)} {...props}>
      {children}
    </table>
  );
}

export const dataTableHeadClass = "text-ink-300 text-left";
export const dataTableRowClass = "border-line-soft border-t";
export const dataTableNumberCellClass = "text-right tabular-nums";
