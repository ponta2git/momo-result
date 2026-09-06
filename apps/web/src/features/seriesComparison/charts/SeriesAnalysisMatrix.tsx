import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { cn } from "@/shared/ui/cn";
import { contentText } from "@/shared/ui/typography";

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
      <table className={cn("w-full border-separate border-spacing-1", className)}>
        <caption className="sr-only">{ariaLabel}</caption>
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
      className={cn(contentText.supporting, "px-2 py-1 text-left align-middle", className)}
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
        contentText.supporting,
        "px-2 py-2 text-center align-middle break-words",
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
      className={cn(contentText.body, "px-2 py-2 text-left align-middle break-words", className)}
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

export function MatrixValueLegend({
  ariaLabel,
  items,
}: {
  ariaLabel: string;
  items: ReadonlyArray<{ id: string; label: string; value: string }>;
}) {
  return (
    <dl
      aria-label={ariaLabel}
      className={cn(contentText.supporting, "flex flex-wrap gap-x-4 gap-y-1")}
    >
      {items.map((item) => (
        <div className="inline-flex items-baseline gap-1" key={item.id}>
          <dt className="font-plain">{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
