import type { HTMLAttributes } from "react";

import { cn } from "@/shared/ui/cn";

export function ActionBar({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-wrap items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-2",
        className,
      )}
      {...props}
    />
  );
}
